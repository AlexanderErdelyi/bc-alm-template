import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProjectConfig, TemplateValues } from './config';
import { commandExists, git, run } from './exec';
import { findFork, forkBlocker, ghLogin, ghRepoInfo, requireGh } from './github';
import { componentOf, srcFromDest } from './paths';
import { setFrontmatterScalar } from './frontmatter';
import { TemplateRepo } from './templateRepo';
import { generalize } from './transform';
import { normalizeText, readTextIfExists, safeRemove, timestamp } from './util';

export type PublishMode = 'overwrite' | 'saveAs';
export type DeliveryMode = 'direct' | 'pullRequest';

export interface PublishFilePlan {
    destRel: string;      // local path in the project
    srcRel: string;       // path in the target template
    text: string;         // generalized content to write
    existing?: string;    // current content in the target template (for diff preview)
    changes: string[];    // human-readable generalization notes
}

export interface PublishPlan {
    repo: TemplateRepo;
    baseSha: string;
    componentId: string;
    newName?: string;
    files: PublishFilePlan[];
}

export interface PublishResult {
    commit: string;
    branch: string;
    /** Branch the change targets (pull request base or pushed branch). */
    base?: string;
    pushedTo: string;
    prUrl?: string;
    compareUrl?: string;
    forked?: boolean;
    tag?: string;
}

export function githubSlug(url: string): { owner: string; repo: string } | undefined {
    const m = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(url.trim());
    return m ? { owner: m[1], repo: m[2] } : undefined;
}

export function isLocalPath(url: string): boolean {
    return /^[a-zA-Z]:[\\/]/.test(url) || url.startsWith('/') || url.startsWith('\\\\') || url.startsWith('file://');
}

/** Rename a component's template path for "save as new". Only the four customization kinds support it. */
export function renamePath(srcRel: string, oldName: string, newName: string): string {
    const ref = componentOf(srcRel);
    switch (ref.kind) {
        case 'agent': return `.github/agents/${newName}.agent.md`;
        case 'prompt': return `.github/prompts/${newName}.prompt.md`;
        case 'instruction': return `.github/instructions/${newName}.instructions.md`;
        case 'skill': return srcRel.replace(`.github/skills/${oldName}/`, `.github/skills/${newName}/`);
        default: throw new Error(`"Save as new" is not supported for ${ref.kind} components.`);
    }
}

/**
 * Prepare the generalized files for publishing a component into a template.
 * The local, project-specific values (prefix, ranges, org, tools, models) are mapped back to
 * the target template's own values so the template stays project-neutral.
 */
export async function preparePublish(opts: {
    root: string;
    project: ProjectConfig;
    componentId: string;
    destFiles: string[];
    repo: TemplateRepo;
    mode: PublishMode;
    newName?: string;
}): Promise<PublishPlan> {
    const { root, project, repo } = opts;
    await repo.ensure(0);
    const baseSha = await repo.resolve();
    const targetCfg = await repo.readConfig(baseSha);
    const targetValues: TemplateValues = targetCfg?.values ?? project.values;
    const files: PublishFilePlan[] = [];
    const oldName = componentOf(srcFromDest(opts.destFiles[0], project.sync)).name;
    for (const destRel of opts.destFiles) {
        const local = readTextIfExists(path.join(root, destRel));
        if (local === undefined) { continue; }
        let srcRel = srcFromDest(destRel, project.sync);
        let text = normalizeText(local);
        if (opts.mode === 'saveAs') {
            if (!opts.newName) { throw new Error('A new name is required.'); }
            srcRel = renamePath(srcRel, oldName, opts.newName);
            if (/\/SKILL\.md$/.test(srcRel)) { text = setFrontmatterScalar(text, 'name', opts.newName); }
        }
        const existing = await repo.readFile(baseSha, srcRel);
        const g = generalize(srcRel, text, project, targetValues, existing);
        files.push({ destRel, srcRel, text: g.text, existing, changes: g.changes });
    }
    if (opts.mode === 'saveAs') {
        const clash = files.find(f => f.existing !== undefined);
        if (clash) { throw new Error(`${clash.srcRel} already exists in the template. Choose another name or overwrite.`); }
    }
    return { repo, baseSha, componentId: opts.componentId, newName: opts.newName, files };
}

async function cloneWork(repo: TemplateRepo, branch: string, workRoot: string): Promise<string> {
    fs.mkdirSync(workRoot, { recursive: true });
    const dir = fs.mkdtempSync(path.join(workRoot, 'pub-'));
    await git(['clone', '--quiet', '--reference-if-able', repo.gitDir, '--dissociate', '--branch', branch, '--single-branch', repo.spec.url, dir]);
    return dir;
}

async function tryPush(cwd: string, remote: string, refspec: string): Promise<{ ok: boolean; err: string }> {
    const r = await git(['push', '--quiet', remote, refspec], cwd, { allowFailure: true });
    return { ok: r.code === 0, err: r.stderr.trim() };
}

/** A change to a template repository: write `text` to the repository path, or delete it when `text` is undefined. */
export interface RepoChange { path: string; text?: string }

export interface DeliverOptions {
    workRoot: string;
    delivery: DeliveryMode;
    message: string;
    body?: string;
    /** Short slug used for the pull request branch (bc-alm/<slug>-<timestamp>). */
    branchName: string;
    /** GitHub handles requested as pull request reviewers (failures are only logged). */
    reviewers?: string[];
    /** Tag created on the commit when it is pushed directly (release). */
    tag?: string;
    log?: (line: string) => void;
}

/**
 * Commit changes to a template repository and deliver them: push directly to the branch the source follows
 * (the default branch when it is pinned to a tag), or push a branch and open a pull request. Without push
 * access the branch goes to the user's fork; when the user owns the repository no fork is attempted.
 */
export async function deliverChanges(repo: TemplateRepo, changes: RepoChange[], opts: DeliverOptions): Promise<PublishResult> {
    const log = opts.log ?? (() => undefined);
    const spec = repo.spec;
    const base = await repo.branchForWrites();
    const dir = await cloneWork(repo, base, opts.workRoot);
    try {
        for (const c of changes) {
            if (c.path.split('/').some(s => s === '..')) { throw new Error(`Invalid path "${c.path}".`); }
            const abs = path.join(dir, ...c.path.split('/'));
            if (c.text === undefined) {
                if (fs.existsSync(abs)) { await git(['rm', '--quiet', '-r', '--', c.path], dir); }
                continue;
            }
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            const crlf = fs.existsSync(abs) && /\r\n/.test(fs.readFileSync(abs, 'utf8'));
            fs.writeFileSync(abs, crlf ? c.text.replace(/\r?\n/g, '\r\n') : c.text, 'utf8');
            await git(['add', '--', c.path], dir);
        }
        const st = await git(['status', '--porcelain'], dir);
        if (!st.stdout.trim()) { throw new Error('Nothing to publish: the template already has this content.'); }
        const ident = await git(['config', 'user.email'], dir, { allowFailure: true });
        const commitArgs = ident.stdout.trim() ? [] : ['-c', 'user.name=BC ALM', '-c', 'user.email=bc-alm@users.noreply.github.com'];
        await git([...commitArgs, 'commit', '--quiet', '-m', opts.message, ...(opts.body ? ['-m', opts.body] : [])], dir);
        const commit = (await git(['rev-parse', 'HEAD'], dir)).stdout.trim();

        if (opts.delivery === 'direct') {
            log(`Pushing to ${spec.url} (${base})…`);
            const p = await tryPush(dir, 'origin', `HEAD:refs/heads/${base}`);
            if (!p.ok) { throw new Error(`Push to ${base} was rejected. Try "Pull request" instead.\n${p.err}`); }
            if (opts.tag) {
                log(`Tagging ${opts.tag}…`);
                const t = await tryPush(dir, 'origin', `HEAD:refs/tags/${opts.tag}`);
                if (!t.ok) { throw new Error(`Committed, but the tag ${opts.tag} was rejected.\n${t.err}`); }
            }
            return { commit, branch: base, pushedTo: spec.url, ...(opts.tag ? { tag: opts.tag } : {}) };
        }

        const name = opts.branchName.replace(/[^A-Za-z0-9._-]+/g, '-');
        const branch = `bc-alm/${name}-${timestamp()}`;
        const slug = githubSlug(spec.url);
        log(`Pushing branch ${branch}…`);
        let p = await tryPush(dir, 'origin', `HEAD:refs/heads/${branch}`);
        let headRef = branch;
        let forked = false;
        if (!p.ok) {
            if (!slug || !(await commandExists('gh'))) {
                throw new Error(`Push was rejected and no fork could be created (GitHub CLI "gh" required).\n${p.err}`);
            }
            const login = await ghLogin();
            if (login.toLowerCase() === slug.owner.toLowerCase()) {
                throw new Error(`Push to ${slug.owner}/${slug.repo} was rejected although you own it, so there is no fork to fall back to. Check your git credentials ("gh auth setup-git") and branch rules.\n${p.err}`);
            }
            let fork = await findFork(slug, login);
            if (fork) {
                log(`No push access - using your fork ${fork}…`);
            } else {
                log('No push access - forking the template with gh…');
                await run('gh', ['repo', 'fork', `${slug.owner}/${slug.repo}`, '--clone=false', '--default-branch-only'], { cwd: dir });
                fork = (await findFork(slug, login)) ?? `${login}/${slug.repo}`;
            }
            const forkUrl = `https://github.com/${fork}.git`;
            await git(['remote', 'add', 'fork', forkUrl], dir);
            // A freshly created fork can take a moment to become pushable.
            for (let i = 0; i < 5; i++) {
                p = await tryPush(dir, 'fork', `HEAD:refs/heads/${branch}`);
                if (p.ok) { break; }
                await new Promise(r => setTimeout(r, 3000));
            }
            if (!p.ok) { throw new Error(`Could not push to fork ${forkUrl}.\n${p.err}`); }
            headRef = `${fork.split('/')[0]}:${branch}`;
            forked = true;
        }

        const result: PublishResult = { commit, branch, base, pushedTo: forked ? 'fork' : spec.url, forked };
        if (slug) {
            result.compareUrl = `https://github.com/${slug.owner}/${slug.repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(headRef)}?expand=1`;
            if (await commandExists('gh')) {
                const pr = await run('gh', ['pr', 'create', '--repo', `${slug.owner}/${slug.repo}`, '--base', base, '--head', headRef,
                    '--title', opts.message, '--body', opts.body ?? 'Published from the BC ALM VS Code extension.'], { cwd: dir, allowFailure: true });
                const url = /https:\/\/\S+\/pull\/\d+/.exec(pr.stdout + pr.stderr)?.[0];
                if (url) { result.prUrl = url; } else { log(`gh pr create failed: ${pr.stderr.trim()}`); }
                if (url && opts.reviewers?.length) {
                    const me = (await ghLogin().catch(() => '')).toLowerCase();
                    const who = opts.reviewers.filter(r => r.toLowerCase() !== me);
                    if (who.length) {
                        const r = await run('gh', ['pr', 'edit', url, '--add-reviewer', who.join(',')], { cwd: dir, allowFailure: true });
                        log(r.code === 0 ? `Requested review from ${who.join(', ')}.` : `Could not request reviewers (${who.join(', ')}): ${r.stderr.trim()}`);
                    }
                }
            }
        }
        return result;
    } finally {
        safeRemove(dir, log);
    }
}

/** Commit the plan into the target template and deliver it directly or as a pull request (forking when needed). */
export async function executePublish(plan: PublishPlan, opts: {
    workRoot: string;
    delivery: DeliveryMode;
    message: string;
    body?: string;
    /** Extra repository changes in the same commit (version bump, changelog, removal from another template). */
    extra?: RepoChange[];
    reviewers?: string[];
    log?: (line: string) => void;
}): Promise<PublishResult> {
    const changes: RepoChange[] = [...plan.files.map(f => ({ path: plan.repo.writePath(f.srcRel), text: f.text })), ...(opts.extra ?? [])];
    return deliverChanges(plan.repo, changes, { ...opts, branchName: plan.newName ?? plan.componentId.replace(/^[a-z]+:/, '') });
}

/** Push an existing commit of the template's mirror as a tag (releasing a version that was merged via pull request). */
export async function pushTag(repo: TemplateRepo, sha: string, tag: string): Promise<void> {
    const r = await git(['--git-dir', repo.gitDir, 'push', '--quiet', repo.spec.url, `${sha}:refs/tags/${tag}`], undefined, { allowFailure: true });
    if (r.code !== 0) { throw new Error(`Could not push tag ${tag} to ${repo.spec.url}. Releasing needs push access.\n${r.stderr.trim()}`); }
    await repo.ensure(0);
}
export type CreateTemplateHow = 'fork' | 'duplicate' | 'template';

export interface CreatedTemplate {
    /** Browser URL of the new repository. */
    url: string;
    /** Git URL of the template it was created from, when it should keep receiving its updates. */
    upstream?: string;
}

/**
 * Create a team's own template repository from an existing GitHub template.
 * - fork: GitHub fork (not possible into the account that owns the upstream or already has a fork)
 * - duplicate: new repository with the upstream's full history, so later upstream changes merge cleanly
 * - template: independent copy ("Use this template"); falls back to a duplicate when the upstream is not a template repository
 */
export async function createOwnTemplate(opts: {
    upstreamUrl: string;
    upstreamRef: string;
    owner: string;
    name: string;
    how: CreateTemplateHow;
    visibility: 'private' | 'public' | 'internal';
    workRoot: string;
    log?: (line: string) => void;
}): Promise<CreatedTemplate> {
    const log = opts.log ?? (() => undefined);
    const up = githubSlug(opts.upstreamUrl);
    if (!up) { throw new Error('Creating a template repository requires a GitHub upstream URL.'); }
    await requireGh();
    const info = await ghRepoInfo(up);
    if (!info) { throw new Error(`Cannot read ${up.owner}/${up.repo} with the GitHub CLI. Check the URL and that you have access ("gh auth status").`); }
    const login = await ghLogin();
    const full = `${opts.owner}/${opts.name}`;
    const url = `https://github.com/${full}`;
    const cwd = os.tmpdir();

    if (opts.how === 'fork') {
        const blocker = forkBlocker(info.fullName, info.owner, opts.owner, await findFork(up, opts.owner));
        if (blocker) { throw new Error(`${blocker.message} Choose "Duplicate" instead.`); }
        const args = ['repo', 'fork', info.fullName, '--clone=false', '--fork-name', opts.name, '--default-branch-only'];
        if (opts.owner.toLowerCase() !== login.toLowerCase()) { args.push('--org', opts.owner); }
        log(`gh ${args.join(' ')}`);
        await run('gh', args, { cwd });
        return { url, upstream: opts.upstreamUrl };
    }

    if (opts.how === 'template' && info.isTemplate) {
        log(`gh repo create ${full} --${opts.visibility} --template ${info.fullName}`);
        await run('gh', ['repo', 'create', full, `--${opts.visibility}`, '--template', info.fullName], { cwd });
        return { url };
    }

    if (opts.how === 'template') { log(`${info.fullName} is not marked as a template repository - copying it with its history instead.`); }
    log(`gh repo create ${full} --${opts.visibility}`);
    await run('gh', ['repo', 'create', full, `--${opts.visibility}`, '--description', `Copilot template (from ${info.fullName})`], { cwd });
    await pushHistory(opts.upstreamUrl, opts.upstreamRef, `${url}.git`, opts.workRoot, log);
    return { url, upstream: opts.how === 'duplicate' ? opts.upstreamUrl : undefined };
}

/** Push branch `ref` of `fromUrl` (with full history) to the empty repository `toUrl`. */
export async function pushHistory(fromUrl: string, ref: string, toUrl: string, workRoot: string, log: (line: string) => void = () => undefined): Promise<void> {
    fs.mkdirSync(workRoot, { recursive: true });
    const dir = fs.mkdtempSync(path.join(workRoot, 'dup-'));
    try {
        log(`Copying ${ref} of ${fromUrl} with its history…`);
        await git(['clone', '--quiet', '--single-branch', '--branch', ref, fromUrl, dir]);
        // A freshly created GitHub repository can take a moment to accept pushes.
        let p = await tryPush(dir, toUrl, `HEAD:refs/heads/${ref}`);
        for (let i = 0; !p.ok && i < 4; i++) {
            await new Promise(r => setTimeout(r, 2000));
            p = await tryPush(dir, toUrl, `HEAD:refs/heads/${ref}`);
        }
        if (!p.ok) { throw new Error(`The repository was created but pushing the template content to ${toUrl} failed. Check your git credentials ("gh auth setup-git").\n${p.err}`); }
    } finally {
        safeRemove(dir, log);
    }
}

export interface SyncResult {
    status: 'upToDate' | 'fastForward' | 'merged' | 'branch';
    message: string;
    branch?: string;
    prUrl?: string;
    compareUrl?: string;
}

/**
 * Bring a template copy up to date with the template it was created from, using plain git
 * (works for duplicates and for forks that `gh repo sync` cannot fast-forward).
 * Clean results are pushed to `ref`; conflicts or protected branches end up as a branch / pull request.
 */
export async function syncFromUpstream(opts: {
    url: string;
    ref: string;
    upstream: string;
    upstreamRef?: string;
    workRoot: string;
    log?: (line: string) => void;
}): Promise<SyncResult> {
    const log = opts.log ?? (() => undefined);
    fs.mkdirSync(opts.workRoot, { recursive: true });
    const dir = fs.mkdtempSync(path.join(opts.workRoot, 'sync-'));
    try {
        await git(['clone', '--quiet', '--single-branch', '--branch', opts.ref, opts.url, dir]);
        const upRef = opts.upstreamRef ?? opts.ref;
        log(`Fetching ${opts.upstream} (${upRef})…`);
        const f = await git(['fetch', '--quiet', opts.upstream, upRef], dir, { allowFailure: true });
        if (f.code !== 0) { throw new Error(`Could not fetch ${upRef} from ${opts.upstream}.\n${f.stderr.trim()}`); }
        const up = (await git(['rev-parse', 'FETCH_HEAD'], dir)).stdout.trim();
        const head = (await git(['rev-parse', 'HEAD'], dir)).stdout.trim();
        const mb = await git(['merge-base', 'HEAD', up], dir, { allowFailure: true });
        if (mb.code !== 0) {
            throw new Error(`${opts.url} shares no history with ${opts.upstream} (it was probably created with "Use this template"), so upstream changes cannot be merged automatically. Pull individual components instead, or recreate it with "Duplicate".`);
        }
        const base = mb.stdout.trim();
        if (base === up) { return { status: 'upToDate', message: `Already up to date with ${opts.upstream}.` }; }

        let candidate = up;
        let status: SyncResult['status'] = 'fastForward';
        if (base !== head) {
            const ident = await git(['config', 'user.email'], dir, { allowFailure: true });
            const idArgs = ident.stdout.trim() ? [] : ['-c', 'user.name=BC ALM', '-c', 'user.email=bc-alm@users.noreply.github.com'];
            const m = await git([...idArgs, 'merge', '--no-edit', '-m', `Merge upstream ${upRef} from ${opts.upstream}`, up], dir, { allowFailure: true });
            if (m.code === 0) {
                candidate = (await git(['rev-parse', 'HEAD'], dir)).stdout.trim();
                status = 'merged';
            } else {
                await git(['merge', '--abort'], dir, { allowFailure: true });
                log('Upstream changes conflict with changes in your template - opening a pull request to resolve them.');
                return await pushSyncBranch(dir, opts, up, 'Upstream changes conflict with your template; resolve them in the pull request.');
            }
        }
        const p = await tryPush(dir, 'origin', `${candidate}:refs/heads/${opts.ref}`);
        if (p.ok) {
            return { status, message: status === 'merged' ? `Merged upstream changes into ${opts.ref}.` : `Fast-forwarded ${opts.ref} to ${up.slice(0, 7)}.` };
        }
        log(`Direct push to ${opts.ref} was rejected (${p.err.split('\n')[0]}) - opening a pull request instead.`);
        return await pushSyncBranch(dir, opts, candidate, `Direct push to ${opts.ref} was rejected.`);
    } finally {
        safeRemove(dir, log);
    }
}

async function pushSyncBranch(dir: string, opts: { url: string; ref: string; upstream: string }, sha: string, reason: string): Promise<SyncResult> {
    const branch = `bc-alm/upstream-sync-${timestamp()}`;
    const p = await tryPush(dir, 'origin', `${sha}:refs/heads/${branch}`);
    if (!p.ok) { throw new Error(`${reason} Pushing branch ${branch} failed too.\n${p.err}`); }
    const res: SyncResult = { status: 'branch', branch, message: `${reason} Pushed ${branch}.` };
    const slug = githubSlug(opts.url);
    if (slug) {
        res.compareUrl = `https://github.com/${slug.owner}/${slug.repo}/compare/${encodeURIComponent(opts.ref)}...${encodeURIComponent(branch)}?expand=1`;
        if (await commandExists('gh')) {
            const pr = await run('gh', ['pr', 'create', '--repo', `${slug.owner}/${slug.repo}`, '--base', opts.ref, '--head', branch,
                '--title', `Sync with upstream template`, '--body', `Brings in the latest changes from ${opts.upstream}.\n\n${reason}`], { cwd: dir, allowFailure: true });
            res.prUrl = /https:\/\/\S+\/pull\/\d+/.exec(pr.stdout + pr.stderr)?.[0];
        }
    }
    return res;
}

/** Bring a GitHub fork up to date with its parent (gh repo sync). Throws when the branches diverged. */
export async function syncForkFromUpstream(forkUrl: string, branch?: string): Promise<string> {
    const s = githubSlug(forkUrl);
    if (!s) { throw new Error('Only GitHub forks can be synced.'); }
    const args = ['repo', 'sync', `${s.owner}/${s.repo}`];
    if (branch) { args.push('--branch', branch); }
    const r = await run('gh', args, { cwd: os.tmpdir() });
    return (r.stdout + r.stderr).trim();
}
