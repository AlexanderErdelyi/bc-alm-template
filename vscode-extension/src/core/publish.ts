import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProjectConfig, TemplateValues } from './config';
import { commandExists, git, run } from './exec';
import { componentOf, srcFromDest } from './paths';
import { setFrontmatterScalar } from './frontmatter';
import { TemplateRepo } from './templateRepo';
import { generalize } from './transform';
import { normalizeText, readTextIfExists, timestamp } from './util';

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
    pushedTo: string;
    prUrl?: string;
    compareUrl?: string;
    forked?: boolean;
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

async function cloneWork(repo: TemplateRepo, workRoot: string): Promise<string> {
    fs.mkdirSync(workRoot, { recursive: true });
    const dir = fs.mkdtempSync(path.join(workRoot, 'pub-'));
    await git(['clone', '--quiet', '--reference-if-able', repo.gitDir, '--dissociate', '--branch', repo.spec.ref, '--single-branch', repo.spec.url, dir]);
    return dir;
}

async function tryPush(cwd: string, remote: string, refspec: string): Promise<{ ok: boolean; err: string }> {
    const r = await git(['push', '--quiet', remote, refspec], cwd, { allowFailure: true });
    return { ok: r.code === 0, err: r.stderr.trim() };
}

/** Commit the plan into the target template and deliver it directly or as a pull request (forking when needed). */
export async function executePublish(plan: PublishPlan, opts: {
    workRoot: string;
    delivery: DeliveryMode;
    message: string;
    body?: string;
    log?: (line: string) => void;
}): Promise<PublishResult> {
    const log = opts.log ?? (() => undefined);
    const spec = plan.repo.spec;
    const dir = await cloneWork(plan.repo, opts.workRoot);
    try {
        for (const f of plan.files) {
            const abs = path.join(dir, ...f.srcRel.split('/'));
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            const crlf = fs.existsSync(abs) && /\r\n/.test(fs.readFileSync(abs, 'utf8'));
            fs.writeFileSync(abs, crlf ? f.text.replace(/\n/g, '\r\n') : f.text, 'utf8');
            await git(['add', '--', f.srcRel], dir);
        }
        const st = await git(['status', '--porcelain'], dir);
        if (!st.stdout.trim()) { throw new Error('Nothing to publish: the template already has this content.'); }
        const ident = await git(['config', 'user.email'], dir, { allowFailure: true });
        const commitArgs = ident.stdout.trim() ? [] : ['-c', 'user.name=BC ALM', '-c', 'user.email=bc-alm@users.noreply.github.com'];
        await git([...commitArgs, 'commit', '--quiet', '-m', opts.message, ...(opts.body ? ['-m', opts.body] : [])], dir);
        const commit = (await git(['rev-parse', 'HEAD'], dir)).stdout.trim();

        if (opts.delivery === 'direct') {
            log(`Pushing to ${spec.url} (${spec.ref})…`);
            const p = await tryPush(dir, 'origin', `HEAD:refs/heads/${spec.ref}`);
            if (!p.ok) { throw new Error(`Push to ${spec.ref} was rejected. Try "Pull request" instead.\n${p.err}`); }
            return { commit, branch: spec.ref, pushedTo: spec.url };
        }

        const name = (plan.newName ?? plan.componentId.replace(/^[a-z]+:/, '')).replace(/[^A-Za-z0-9._-]+/g, '-');
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
            log('No push access - forking the template with gh…');
            await run('gh', ['repo', 'fork', `${slug.owner}/${slug.repo}`, '--clone=false'], { cwd: dir, allowFailure: true });
            const login = (await run('gh', ['api', 'user', '--jq', '.login'], { cwd: dir })).stdout.trim();
            const forkUrl = `https://github.com/${login}/${slug.repo}.git`;
            await git(['remote', 'add', 'fork', forkUrl], dir);
            // A freshly created fork can take a moment to become pushable.
            for (let i = 0; i < 5; i++) {
                p = await tryPush(dir, 'fork', `HEAD:refs/heads/${branch}`);
                if (p.ok) { break; }
                await new Promise(r => setTimeout(r, 3000));
            }
            if (!p.ok) { throw new Error(`Could not push to fork ${forkUrl}.\n${p.err}`); }
            headRef = `${login}:${branch}`;
            forked = true;
        }

        const result: PublishResult = { commit, branch, pushedTo: forked ? 'fork' : spec.url, forked };
        if (slug) {
            result.compareUrl = `https://github.com/${slug.owner}/${slug.repo}/compare/${encodeURIComponent(spec.ref)}...${encodeURIComponent(headRef)}?expand=1`;
            if (await commandExists('gh')) {
                const pr = await run('gh', ['pr', 'create', '--repo', `${slug.owner}/${slug.repo}`, '--base', spec.ref, '--head', headRef,
                    '--title', opts.message, '--body', opts.body ?? 'Published from the BC ALM VS Code extension.'], { cwd: dir, allowFailure: true });
                const url = /https:\/\/\S+\/pull\/\d+/.exec(pr.stdout + pr.stderr)?.[0];
                if (url) { result.prUrl = url; } else { log(`gh pr create failed: ${pr.stderr.trim()}`); }
            }
        }
        return result;
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

/** Create the team's own template repo from the upstream template (fork keeps the upstream link for syncing). */
export async function createOwnTemplate(opts: {
    upstreamUrl: string;
    newRepo: string;          // owner/name or name
    how: 'fork' | 'template';
    visibility: 'private' | 'public' | 'internal';
}): Promise<string> {
    const up = githubSlug(opts.upstreamUrl);
    if (!up) { throw new Error('Creating a template repo requires a GitHub upstream URL.'); }
    if (!(await commandExists('gh'))) { throw new Error('The GitHub CLI (gh) is required. Install it and run "gh auth login".'); }
    const cwd = os.tmpdir();
    let out: string;
    if (opts.how === 'fork') {
        const [owner, name] = opts.newRepo.includes('/') ? opts.newRepo.split('/') : [undefined, opts.newRepo];
        const args = ['repo', 'fork', `${up.owner}/${up.repo}`, '--clone=false', '--fork-name', name, '--default-branch-only'];
        if (owner) { args.push('--org', owner); }
        out = (await run('gh', args, { cwd })).stdout + '';
        const login = owner ?? (await run('gh', ['api', 'user', '--jq', '.login'], { cwd })).stdout.trim();
        return /https:\/\/github\.com\/\S+/.exec(out)?.[0] ?? `https://github.com/${login}/${name}`;
    }
    out = (await run('gh', ['repo', 'create', opts.newRepo, `--${opts.visibility}`, '--template', `${up.owner}/${up.repo}`], { cwd })).stdout;
    const url = /https:\/\/github\.com\/\S+/.exec(out)?.[0];
    if (url) { return url; }
    const login = opts.newRepo.includes('/') ? '' : (await run('gh', ['api', 'user', '--jq', '.login'], { cwd })).stdout.trim() + '/';
    return `https://github.com/${login}${opts.newRepo}`;
}

/** Bring a forked team template up to date with its upstream (gh repo sync). */
export async function syncForkFromUpstream(forkUrl: string, branch?: string): Promise<string> {
    const s = githubSlug(forkUrl);
    if (!s) { throw new Error('Only GitHub forks can be synced.'); }
    const args = ['repo', 'sync', `${s.owner}/${s.repo}`];
    if (branch) { args.push('--branch', branch); }
    const r = await run('gh', args, { cwd: os.tmpdir() });
    return (r.stdout + r.stderr).trim();
}
