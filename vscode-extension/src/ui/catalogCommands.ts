import * as path from 'path';
import * as vscode from 'vscode';
import {
    addChangelogEntry, Bump, bumpVersion, catalogFolder, catalogTemplateFiles, compareSemver, LATEST_REF, parseSemver, RepoFile, suggestBump, templateTag, withTemplateVersion
} from '../core/catalogAuthoring';
import { CONFIG_FILE, slugId, TEMPLATE_TOGGLE_KINDS, TemplateManifest, TemplateValues } from '../core/config';
import { DependencyGraph } from '../core/deps';
import { ghLogin } from '../core/github';
import { emptyLock, readLock, writeLock } from '../core/lock';
import { manifestFromInput, placeholderValues, SeedFile, seedFromProject } from '../core/newTemplate';
import { componentOf, KIND_LABELS } from '../core/paths';
import { deliverChanges, DeliveryMode, githubSlug, isLocalPath, PublishResult, pushTag, RepoChange } from '../core/publish';
import { ComponentState } from '../core/status';
import { TemplateEntry, TemplateRepo, TemplateSourceSpec } from '../core/templateRepo';
import { sameRepo, sameSource } from '../core/util';
import { TemplateContentProvider } from './diagnostics';
import { ProjectState, saveSettingsSources, settingsSources, SourceInfo, UPSTREAM_URL } from './projectState';
import { ComponentsNode, isRepoNode } from './trees';

export interface CatalogCommandContext {
    state: ProjectState;
    log: vscode.OutputChannel;
    reg: (id: string, fn: (...args: any[]) => unknown) => void;
    graph: () => DependencyGraph;
    done: (msg?: string) => Promise<void>;
    content: TemplateContentProvider;
}

const ICONS = ['rocket', 'arrow-up', 'tools', 'beaker', 'book', 'package', 'shield', 'zap', 'organization', 'symbol-namespace'];

/** A repository that can hold templates (its root and `.templates/<id>/` folders). */
interface CatalogRepo { url: string; name: string; ref?: string }

const progress = <T>(title: string, fn: () => Promise<T>): Thenable<T> =>
    vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, fn);

export function registerCatalogCommands(cx: CatalogCommandContext): void {
    const { state, log, reg, graph, done, content } = cx;
    const workRoot = () => path.join(state.storageRoot, 'work');

    const isSource = (a: unknown): a is SourceInfo => !!a && typeof a === 'object' && 'url' in a && 'inProject' in a;
    const isNode = (a: unknown): a is ComponentsNode => !!a && typeof a === 'object' && 'type' in a;

    /** Distinct repositories of the configured sources (plus the upstream BC ALM repository). */
    const knownRepos = (): CatalogRepo[] => {
        const out: CatalogRepo[] = [];
        for (const s of [...state.sources, ...settingsSources()]) {
            if (out.some(r => sameRepo(r.url, s.url))) { continue; }
            const slug = githubSlug(s.url);
            out.push({ url: s.url, name: slug ? `${slug.owner}/${slug.repo}` : isLocalPath(s.url) ? path.basename(s.url) : s.url, ref: s.ref });
        }
        if (!out.some(r => sameRepo(r.url, UPSTREAM_URL))) { out.push({ url: UPSTREAM_URL, name: 'AlexanderErdelyi/bc-alm-template (BC ALM)' }); }
        return out;
    };

    const askRepoUrl = async (): Promise<CatalogRepo | undefined> => {
        const url = (await vscode.window.showInputBox({
            prompt: 'Git URL of the template repository', placeHolder: 'https://github.com/my-org/bc-templates.git',
            validateInput: v => /^(https?:\/\/|git@|ssh:\/\/|file:\/\/)/.test(v.trim()) ? undefined : 'Enter an https/ssh git URL'
        }))?.trim();
        if (!url) { return undefined; }
        const slug = githubSlug(url);
        return { url, name: slug ? `${slug.owner}/${slug.repo}` : url };
    };

    const pickRepo = async (placeHolder: string, filter: (r: CatalogRepo) => boolean = () => true): Promise<CatalogRepo | undefined> => {
        const repos = knownRepos().filter(filter);
        const items: (vscode.QuickPickItem & { r?: CatalogRepo })[] = repos.map(r => ({ label: `$(library) ${r.name}`, detail: r.url, r }));
        items.push({ label: '$(add) Another repository…', detail: 'Enter a git URL' });
        const p = await vscode.window.showQuickPick(items, { placeHolder });
        if (!p) { return undefined; }
        return p.r ?? askRepoUrl();
    };

    /** The repository root as a template source, following the configured branch (or the default branch when pinned to a tag). */
    const openRepo = async (r: CatalogRepo): Promise<{ root: TemplateRepo; branch: string; sha: string }> => {
        return progress(`Reading ${r.name}…`, async () => {
            const mirror = state.registry.mirror(r.url);
            await mirror.ensure(0);
            const branches = await mirror.branches();
            const branch = r.ref && r.ref !== LATEST_REF && branches.includes(r.ref) ? r.ref : await mirror.defaultBranch();
            const root = state.repo({ name: r.name, url: r.url, ref: branch });
            return { root, branch, sha: await root.resolve() };
        });
    };

    const listing = async (root: TemplateRepo, sha: string): Promise<TemplateEntry[]> => {
        const l = await root.listTemplates(sha);
        l.warnings.forEach(w => log.appendLine(`[catalog] ${root.spec.url}: ${w}`));
        return l.templates;
    };

    const specOf = (r: CatalogRepo, branch: string, t: TemplateEntry): TemplateSourceSpec =>
        ({ name: t.manifest.name, url: r.url, ref: branch, ...(t.path ? { path: t.path } : {}) });

    const sourceOf = (spec: { url: string; path?: string }) => state.sources.find(s => sameSource(s, spec));

    const addToSettings = async (spec: TemplateSourceSpec): Promise<SourceInfo | undefined> => {
        const list = settingsSources();
        if (!list.some(x => sameSource(x, spec))) { await saveSettingsSources([...list, spec]); }
        await state.refresh(false, true);
        return sourceOf(spec);
    };

    /** Components (agents, skills, …) of a template at a commit: id -> template-relative files. */
    const componentsOf = async (repo: TemplateRepo, sha: string): Promise<Map<string, string[]>> => {
        const out = new Map<string, string[]>();
        for (const rel of (await repo.layout(sha)).files.keys()) {
            const ref = componentOf(rel);
            if (!TEMPLATE_TOGGLE_KINDS.includes(ref.kind)) { continue; }
            out.set(ref.id, [...(out.get(ref.id) ?? []), rel]);
        }
        return out;
    };

    const componentLabel = (id: string) => {
        const [kind, ...rest] = id.split(':');
        return { label: rest.join(':'), description: KIND_LABELS[kind as keyof typeof KIND_LABELS] ?? kind };
    };

    // ------------------------------------------------------------ browse (#68)

    reg('bcAlm.browseTemplates', async (arg?: unknown) => {
        let r: CatalogRepo | undefined;
        if (isRepoNode(arg)) { r = { url: arg.url, name: arg.name, ref: arg.sources[0]?.ref }; }
        else if (isSource(arg)) { r = knownRepos().find(x => sameRepo(x.url, arg.url)); }
        else {
            const repos = knownRepos();
            r = repos.length === 1 ? repos[0] : await pickRepo('Browse the templates of which repository?');
        }
        if (!r) { return; }
        const { root, branch, sha } = await openRepo(r);
        const templates = await listing(root, sha);
        if (!templates.length) { vscode.window.showInformationMessage(`${r.name} has no templates.`); return; }
        type Item = vscode.QuickPickItem & { t: TemplateEntry };
        const items: Item[] = templates.map(t => {
            const s = sourceOf(specOf(r!, branch, t));
            const d = [t.id, t.manifest.version ? `v${t.manifest.version}` : '', t.manifest.extends ? `variant of ${t.manifest.extends}` : '',
                s?.inProject ? '✓ in this project' : s ? '✓ in your sources' : ''].filter(Boolean).join(' · ');
            return { label: `$(${t.manifest.icon ?? 'repo'}) ${t.manifest.name}`, description: d, detail: t.manifest.description ?? (t.path || 'repository root'), t };
        });
        const pick = await vscode.window.showQuickPick(items, { placeHolder: `Templates in ${r.name} (${branch})`, matchOnDescription: true, matchOnDetail: true });
        if (!pick) { return; }
        const t = pick.t;
        const spec = specOf(r, branch, t);
        const repo = state.repo(spec);
        const actions: (vscode.QuickPickItem & { a: string })[] = [];
        if (state.root) { actions.push({ label: '$(arrow-circle-right) Use in This Project', detail: 'Add it as a project source and choose its components.', a: 'use' }); }
        actions.push({ label: '$(plug) Add to My Sources', detail: 'Show it under Template Sources for all your projects.', a: 'add' });
        actions.push({ label: '$(list-tree) Preview Components', a: 'preview' });
        actions.push({ label: '$(book) Open README', a: 'readme' });
        const act = await vscode.window.showQuickPick(actions, { placeHolder: t.manifest.name });
        if (!act) { return; }
        if (act.a === 'use' || act.a === 'add') {
            const info = await addToSettings(spec);
            if (act.a === 'use' && info) { await vscode.commands.executeCommand('bcAlm.useSourceInProject', info); }
            else { vscode.window.showInformationMessage(`Added "${t.manifest.name}" to your template sources.`); }
        } else if (act.a === 'preview') {
            const comps = await componentsOf(repo, sha);
            const removed = (await repo.layout(sha)).removed;
            await vscode.window.showQuickPick([...comps.keys()].sort().map(id => ({ ...componentLabel(id), detail: comps.get(id)!.join(', ') })),
                { placeHolder: `${t.manifest.name}: ${comps.size} component(s)${removed.size ? `, ${removed.size} removed from its base` : ''}`, canPickMany: false });
        } else {
            const text = await repo.readFile(sha, 'README.md');
            if (text === undefined) { vscode.window.showInformationMessage(`${t.manifest.name} has no README.md.`); return; }
            const doc = await vscode.workspace.openTextDocument({ content: text, language: 'markdown' });
            await vscode.commands.executeCommand('markdown.showPreview', doc.uri);
        }
    });

    // ------------------------------------------------------------ create in a catalog repository (#69) and variants (#71)

    const askIdentity = async (taken: Set<string>, defaults?: { icon?: string; description?: string }): Promise<TemplateManifest | undefined> => {
        const name = (await vscode.window.showInputBox({
            prompt: 'Template name (shown in the Components view)', placeHolder: 'BC Upgrade',
            validateInput: v => !v.trim() ? 'Enter a name' : taken.has(slugId(v)) ? `Template id "${slugId(v)}" already exists in this repository` : undefined
        }))?.trim();
        if (!name) { return undefined; }
        const description = await vscode.window.showInputBox({ prompt: 'Short description (optional)', value: defaults?.description ?? '' });
        if (description === undefined) { return undefined; }
        const icons = defaults?.icon && !ICONS.includes(defaults.icon) ? [defaults.icon, ...ICONS] : ICONS;
        const icon = await vscode.window.showQuickPick(icons.map(i => ({ label: `$(${i}) ${i}`, i, picked: i === defaults?.icon })), { placeHolder: 'Icon' });
        if (!icon) { return undefined; }
        const me = await ghLogin().catch(() => '');
        const maint = await vscode.window.showInputBox({ prompt: 'Maintainers - GitHub handles, comma separated (reviewers of changes; optional)', value: me });
        if (maint === undefined) { return undefined; }
        const maintainers = maint.split(/[,\s]+/).map(m => m.replace(/^@/, '').trim()).filter(Boolean);
        return { ...manifestFromInput(name, description || undefined, icon.i), ...(maintainers.length ? { maintainers } : {}) };
    };

    const pickSeed = async (): Promise<ComponentState[] | undefined> => {
        const ownable = (state.status?.components ?? []).filter(c => c.installed && !c.disabled && TEMPLATE_TOGGLE_KINDS.includes(c.ref.kind));
        const sel = await vscode.window.showQuickPick(ownable.map(c => ({ label: c.ref.name, description: KIND_LABELS[c.ref.kind] ?? c.ref.kind, c })), { canPickMany: true, placeHolder: 'Components to put into the new template' });
        if (!sel?.length) { return undefined; }
        let picked = sel.map(x => x.c);
        const gr = graph();
        const deps = [...new Set(picked.flatMap(c => gr.closure(c.ref.id)))].map(id => state.component(id))
            .filter((x): x is ComponentState => !!x && x.installed && !picked.includes(x) && TEMPLATE_TOGGLE_KINDS.includes(x.ref.kind));
        if (deps.length) {
            const a = await vscode.window.showInformationMessage(`The selection uses ${deps.map(d => `${d.ref.kind} ${d.ref.name}`).join(', ')}.`, 'Include Them', 'Skip');
            if (!a) { return undefined; }
            if (a === 'Include Them') { picked = [...picked, ...deps]; }
        }
        return picked;
    };

    const askDelivery = async (repoName: string, branch: string): Promise<DeliveryMode | undefined> => (await vscode.window.showQuickPick([
        { label: '$(git-pull-request) Open a pull request', detail: 'Recommended - maintainers review the template before others can use it.', d: 'pullRequest' as DeliveryMode },
        { label: `$(git-commit) Commit directly to ${branch}`, detail: `Needs push access to ${repoName}.`, d: 'direct' as DeliveryMode }
    ], { placeHolder: 'How should the new template be delivered?' }))?.d;

    /** Deliver new template files to a catalog repository, then offer to use it. */
    const deliverTemplate = async (r: CatalogRepo, root: TemplateRepo, branch: string, manifest: TemplateManifest, files: RepoFile[], what: string) => {
        log.appendLine(`\n=== ${what}: ${manifest.name} (${catalogFolder(manifest.id)}) → ${r.name} ===`);
        files.forEach(f => log.appendLine(`  add ${f.path}`));
        log.show(true);
        const delivery = await askDelivery(r.name, branch);
        if (!delivery) { return; }
        const res: PublishResult = await progress(`Adding ${manifest.name} to ${r.name}…`, () => deliverChanges(root, files.map(f => ({ path: f.path, text: f.text })), {
            workRoot: workRoot(), delivery, branchName: `add-${manifest.id}`, reviewers: manifest.maintainers,
            message: `feat(${manifest.id}): add template ${manifest.name}`,
            body: `Adds the template **${manifest.name}** in \`${catalogFolder(manifest.id)}/\`${manifest.extends ? ` as a variant of \`${manifest.extends}\`` : ''}, created with the BC ALM VS Code extension.\n\n${files.map(f => `- \`${f.path}\``).join('\n')}`,
            log: l => log.appendLine(l)
        }));
        log.appendLine(`Delivered ${res.commit.slice(0, 7)} → ${res.pushedTo} (${res.branch})${res.prUrl ? ` PR: ${res.prUrl}` : ''}`);
        const spec: TemplateSourceSpec = { name: manifest.name, url: r.url, ref: branch, path: catalogFolder(manifest.id) };
        if (delivery === 'direct') {
            await addToSettings(spec);
            const a = await vscode.window.showInformationMessage(`Added template "${manifest.name}" to ${r.name} and to your template sources.`, ...(state.root ? ['Use in This Project'] : []));
            const info = sourceOf(spec);
            if (a && info) { await vscode.commands.executeCommand('bcAlm.useSourceInProject', info); }
            return;
        }
        const url = res.prUrl ?? res.compareUrl;
        const actions = [...(url ? ['Open Pull Request'] : []), ...(!res.forked ? ['Try It Now'] : []), 'Add After Merge'];
        const a = await vscode.window.showInformationMessage(
            `${res.prUrl ? 'Pull request opened' : `Pushed branch ${res.branch}`}${res.forked ? ' from your fork' : ''} for "${manifest.name}". ` +
            `${!res.forked ? '"Try It Now" follows the pull request branch until it is merged. ' : ''}"Add After Merge" adds the source on ${branch} (it shows an error until the pull request is merged).`, ...actions);
        if (a === 'Open Pull Request' && url) { await vscode.env.openExternal(vscode.Uri.parse(url)); }
        if (a === 'Try It Now') { await addToSettings({ ...spec, ref: res.branch }); vscode.window.showInformationMessage(`"${manifest.name}" follows ${res.branch}. Use "Change Version / Branch" to switch to ${branch} after the merge.`); }
        if (a === 'Add After Merge') { await addToSettings(spec); }
    };

    reg('bcAlm.createCatalogTemplate', async (arg?: unknown) => {
        const r = isRepoNode(arg) ? { url: arg.url, name: arg.name, ref: arg.sources[0]?.ref } : (arg && typeof arg === 'object' && 'url' in arg ? arg as CatalogRepo : undefined)
            ?? await pickRepo('Add the new template to which repository?');
        if (!r) { return; }
        const { root, branch, sha } = await openRepo(r);
        const existing = await listing(root, sha);
        type Start = vscode.QuickPickItem & { v: 'blank' | 'seed' | 'variant' };
        const starts: Start[] = [{ label: '$(new-file) Blank template', detail: 'Empty folders, a README, CHANGELOG and template.config.json.', v: 'blank' }];
        if (state.root && state.status?.components.some(c => c.installed && TEMPLATE_TOGGLE_KINDS.includes(c.ref.kind))) {
            starts.push({ label: '$(checklist) From components in this project', detail: 'Project values are turned back into the repository\'s placeholders.', v: 'seed' });
        }
        if (existing.length) { starts.push({ label: '$(git-branch) Variant of a template in this repository', detail: 'Reuse an existing template, replace or remove some of its components.', v: 'variant' }); }
        const start = await vscode.window.showQuickPick(starts, { placeHolder: `How should the new template in ${r.name} start?` });
        if (!start) { return; }
        if (start.v === 'variant') { await vscode.commands.executeCommand('bcAlm.createVariant', r); return; }
        const picked = start.v === 'seed' ? await pickSeed() : [];
        if (!picked) { return; }
        const manifest = await askIdentity(new Set(existing.map(t => t.id)));
        if (!manifest) { return; }
        const slug = githubSlug(r.url);
        const values: TemplateValues = existing.find(t => !t.path)?.config?.values ?? placeholderValues(state.project, slug ? `${slug.owner}/${slug.repo}` : 'my-org/my-repo');
        const seeded = picked.length && state.root && state.project ? seedFromProject(state.root, state.project, picked.flatMap(c => c.files.map(f => f.destRel)), values) : [];
        seeded.forEach(f => f.changes.length && log.appendLine(`  ${f.srcRel}: ${f.changes.join('; ')}`));
        await deliverTemplate(r, root, branch, manifest, catalogTemplateFiles(manifest, seeded, values), 'New catalog template');
    });

    reg('bcAlm.createVariant', async (arg?: unknown) => {
        let r: CatalogRepo | undefined;
        let baseKey: string | undefined;
        if (isSource(arg)) { r = { url: arg.url, name: arg.name ?? arg.url, ref: arg.ref }; baseKey = arg.path ?? ''; }
        else if (isRepoNode(arg)) { r = { url: arg.url, name: arg.name, ref: arg.sources[0]?.ref }; }
        else if (arg && typeof arg === 'object' && 'url' in arg) { r = arg as CatalogRepo; }
        else { r = await pickRepo('Create a variant of a template in which repository?'); }
        if (!r) { return; }
        const slug = githubSlug(r.url);
        if (slug) { r = { ...r, name: `${slug.owner}/${slug.repo}` }; }
        const { root, branch, sha } = await openRepo(r);
        const templates = await listing(root, sha);
        let base = baseKey !== undefined ? templates.find(t => t.path === baseKey) : undefined;
        if (!base) {
            const p = await vscode.window.showQuickPick(templates.map(t => ({ label: `$(${t.manifest.icon ?? 'repo'}) ${t.manifest.name}`, description: t.id, detail: t.manifest.description, t })), { placeHolder: 'Variant of which template?' });
            if (!p) { return; }
            base = p.t;
        }
        const baseRepo = state.repo({ name: base.manifest.name, url: r.url, ref: branch, ...(base.path ? { path: base.path } : {}) });
        const comps = await progress(`Reading ${base.manifest.name}…`, () => componentsOf(baseRepo, sha));
        const ids = [...comps.keys()].sort();

        const over = await vscode.window.showQuickPick(ids.map(id => ({ ...componentLabel(id), id })), {
            canPickMany: true, placeHolder: `Components the variant replaces (it gets its own copy to change) - none is fine`
        });
        if (!over) { return; }
        const overIds = over.map(o => o.id);
        const localIds = overIds.filter(id => state.component(id)?.files.some(f => f.status === 'modified' || f.status === 'custom' || f.status === 'conflict'));
        let fromProject: string[] = [];
        if (localIds.length && state.root) {
            const sel = await vscode.window.showQuickPick(localIds.map(id => ({ ...componentLabel(id), id, picked: true })), {
                canPickMany: true, placeHolder: 'Start these from your project version instead of the base version?'
            });
            if (!sel) { return; }
            fromProject = sel.map(s => s.id);
        }
        const rest = ids.filter(id => !overIds.includes(id));
        const rem = rest.length ? await vscode.window.showQuickPick(rest.map(id => ({ ...componentLabel(id), id })), { canPickMany: true, placeHolder: 'Components the variant removes - none is fine' }) : [];
        if (!rem) { return; }

        const manifest0 = await askIdentity(new Set(templates.map(t => t.id)), { icon: base.manifest.icon, description: base.manifest.description });
        if (!manifest0) { return; }
        const manifest: TemplateManifest = { ...manifest0, extends: base.id, ...(rem.length ? { remove: rem.map(x => x.id) } : {}) };

        const baseLayout = await baseRepo.layout(sha);
        const seeded: SeedFile[] = [];
        const fromBase = overIds.filter(id => !fromProject.includes(id)).flatMap(id => comps.get(id) ?? []);
        const texts = await baseRepo.readFiles(sha, fromBase);
        for (const rel of fromBase) {
            const t = texts.get(rel);
            if (t !== undefined) { seeded.push({ srcRel: rel, text: t, changes: [] }); }
        }
        if (fromProject.length && state.root && state.project) {
            const values = (await baseRepo.readConfig(sha))?.values ?? placeholderValues(state.project, slug ? `${slug.owner}/${slug.repo}` : 'my-org/my-repo');
            const dest = fromProject.flatMap(id => state.component(id)?.files.map(f => f.destRel) ?? []);
            seeded.push(...seedFromProject(state.root, state.project, dest, values));
        }
        log.appendLine(`Variant of ${base.id}: overrides ${overIds.join(', ') || '-'}; removes ${manifest.remove?.join(', ') || '-'} (base has ${baseLayout.files.size} files).`);
        await deliverTemplate(r, root, branch, manifest, catalogTemplateFiles(manifest, seeded), 'New variant');
    });

    reg('bcAlm.compareWithBase', async (arg?: unknown) => {
        const c = isNode(arg) && (arg.type === 'component' || arg.type === 'file') ? state.component(arg.comp.ref.id) : undefined;
        if (!c?.source) { throw new Error('Select a component of a variant template.'); }
        const cat = state.catalogs.find(k => k.repo.key === c.source);
        if (!cat?.variant?.overridden.has(c.ref.id)) { throw new Error(`"${c.ref.name}" is not replaced by a variant template.`); }
        const base = await cat.repo.baseRepo(cat.sha);
        if (!base) { return; }
        const mine = [...(await cat.repo.layout(cat.sha)).files.keys()].filter(rel => componentOf(rel).id === c.ref.id);
        const theirs = [...(await base.layout(cat.sha)).files.keys()].filter(rel => componentOf(rel).id === c.ref.id);
        const rels = [...new Set([...theirs, ...mine])].sort();
        const a = await base.readFiles(cat.sha, theirs);
        const b = await cat.repo.readFiles(cat.sha, mine);
        for (const rel of rels.slice(0, 8)) {
            const name = path.posix.basename(rel);
            await vscode.commands.executeCommand('vscode.diff', content.uri(a.get(rel) ?? '', name, 'base'), content.uri(b.get(rel) ?? '', name, 'variant'),
                `${rel}: ${base.label} ↔ ${cat.manifest.name}`, { preview: false });
        }
    });

    // ------------------------------------------------------------ versions (#72)

    /** Point a source at another ref in the settings and, when used in this project, in the lock file. */
    const setRef = async (s: SourceInfo, ref: string) => {
        await progress(`Checking ${ref}…`, async () => {
            const repo = state.repo({ ...s, ref });
            await repo.ensure(0);
            await repo.resolve();
        });
        const list = settingsSources();
        if (list.some(x => sameSource(x, s))) { await saveSettingsSources(list.map(x => sameSource(x, s) ? { ...x, ref } : x)); }
        if (s.inProject && state.root) {
            const lock = readLock(state.root) ?? emptyLock();
            const ls = lock.sources.find(x => sameSource(x, s));
            if (ls) { ls.ref = ref; writeLock(state.root, lock); }
        }
        await state.refresh(true);
    };

    reg('bcAlm.changeSourceRef', async (s: SourceInfo) => {
        if (!isSource(s)) { return; }
        const repo = state.repo(s);
        const { versions, branches } = await progress(`Reading ${s.name ?? s.url}…`, async () => {
            await repo.ensure(60_000);
            return { versions: await repo.versions(), branches: await repo.mirror.branches() };
        });
        type Item = vscode.QuickPickItem & { ref?: string };
        const cur = (r: string) => r === s.ref ? ' $(check)' : '';
        const items: Item[] = [];
        if (versions.length) {
            items.push({ label: 'Released versions', kind: vscode.QuickPickItemKind.Separator });
            items.push({ label: `$(sparkle) latest${cur(LATEST_REF)}`, description: `currently v${versions[0].version}`, detail: 'Follow the newest released version - updates arrive only when a new version is tagged.', ref: LATEST_REF });
            versions.forEach(v => items.push({ label: `$(tag) v${v.version}${cur(v.tag)}`, description: v.tag, ref: v.tag }));
        }
        items.push({ label: 'Branches', kind: vscode.QuickPickItemKind.Separator });
        branches.forEach(b => items.push({ label: `$(git-branch) ${b}${cur(b)}`, description: b === s.ref ? 'current' : undefined, ref: b }));
        items.push({ label: '$(edit) Other branch, tag or commit…' });
        const p = await vscode.window.showQuickPick(items, { placeHolder: `What should ${s.name ?? s.url} follow? (now: ${s.ref})` });
        if (!p) { return; }
        const ref = p.ref ?? (await vscode.window.showInputBox({ prompt: 'Branch, tag or commit to follow', value: s.ref, validateInput: v => v.trim() ? undefined : 'Enter a ref' }))?.trim();
        if (!ref || ref === s.ref) { return; }
        await setRef(s, ref);
        const a = await vscode.window.showInformationMessage(`${s.name ?? s.url} now follows ${ref}.${s.inProject ? ' Commit .bc-alm/template.lock.json so your team follows it too.' : ''}`, ...(s.inProject ? ['Update Components…'] : []));
        if (a) { await vscode.commands.executeCommand('bcAlm.updateAll'); }
    });

    reg('bcAlm.upgradeSourceVersion', async (s: SourceInfo) => {
        if (!isSource(s)) { return; }
        if (!s.upgrade) { vscode.window.showInformationMessage(`${s.name ?? s.url} is on the newest version.`); return; }
        const a = await vscode.window.showInformationMessage(`Move ${s.name ?? s.url} from ${s.ref} to v${s.upgrade.version}?${s.upgrade.notes ? `\n\n${s.upgrade.notes}` : ''}`, { modal: true }, 'Upgrade', 'Follow Latest');
        if (!a) { return; }
        await setRef(s, a === 'Follow Latest' ? LATEST_REF : s.upgrade.tag);
        const b = await vscode.window.showInformationMessage(`${s.name ?? s.url} now follows ${a === 'Follow Latest' ? 'latest' : `v${s.upgrade.version}`}.`, ...(s.inProject ? ['Update Components…'] : []));
        if (b) { await vscode.commands.executeCommand('bcAlm.updateAll'); }
    });

    reg('bcAlm.releaseTemplateVersion', async (s: SourceInfo) => {
        if (!isSource(s)) { return; }
        const repo = state.repo(s);
        const info = await progress(`Reading ${repo.label}…`, async () => {
            await repo.ensure(0);
            const branch = await repo.branchForWrites();
            const sha = await repo.resolve(branch);
            const id = await repo.templateId();
            const versions = await repo.versions();
            const cfgPath = repo.writePath(CONFIG_FILE);
            const cfgText = await repo.mirror.readFile(sha, cfgPath);
            const since = versions[0] ? await repo.mirror.resolve(`refs/tags/${versions[0].tag}`) : undefined;
            const scope = repo.root ? [repo.root] : ['.', ':(exclude).templates'];
            const commits = (await repo.mirror.log(sha, scope, 200, since)).filter(c => !/^Merge (pull request|branch)/.test(c.subject));
            return { branch, sha, id, versions, cfgPath, cfgText, commits };
        });
        const { branch, sha, id, versions, cfgPath, cfgText, commits } = info;
        if (!cfgText) { throw new Error(`${repo.label} has no ${CONFIG_FILE} - it cannot be versioned.`); }
        const raw = JSON.parse(cfgText.replace(/^\uFEFF/, ''));
        if (!raw.template) { throw new Error(`${cfgPath} has no "template" block. Set the template identity first (template.id, template.name).`); }
        const cur: string | undefined = parseSemver(raw.template.version) ? String(raw.template.version) : undefined;
        const last = versions[0];
        const maintainers: string[] = Array.isArray(raw.template.maintainers) ? raw.template.maintainers : [];

        if (cur && !versions.some(v => v.version === cur) && (!last || compareSemver(cur, last.version) > 0)) {
            const [cfgCommit] = await repo.mirror.log(sha, [cfgPath], 1);
            const a = await vscode.window.showInformationMessage(`${CONFIG_FILE} already says v${cur}, but there is no tag ${templateTag(id, cur)} yet (e.g. the release was merged via pull request).`, 'Tag It', 'Release a New Version');
            if (!a) { return; }
            if (a === 'Tag It' && cfgCommit) {
                await progress(`Tagging ${templateTag(id, cur)}…`, () => pushTag(repo, cfgCommit.sha, templateTag(id, cur)));
                await state.refresh(true);
                vscode.window.showInformationMessage(`Released ${repo.label} v${cur} (${cfgCommit.sha.slice(0, 7)}).`);
                return;
            }
        }
        if (last && !commits.length) {
            vscode.window.showInformationMessage(`${repo.label} has no changes since v${last.version}.`);
            return;
        }
        const subjects = commits.map(c => c.subject);
        const suggested: Bump = last ? suggestBump(subjects) : 'minor';
        const from = cur ?? last?.version;
        const bumps: Bump[] = ['patch', 'minor', 'major'];
        const pick = await vscode.window.showQuickPick(bumps.map(b => ({
            label: `${b === suggested ? '$(star-full) ' : ''}v${bumpVersion(from, b)}`, description: `${b}${b === suggested ? ' (suggested)' : ''}`,
            detail: b === 'major' ? 'Breaking changes' : b === 'minor' ? 'New components or features' : 'Fixes and small improvements', b
        })).sort((x, y) => Number(y.b === suggested) - Number(x.b === suggested)), {
            placeHolder: `${commits.length} change(s) since ${last ? `v${last.version}` : 'the beginning'}${from ? ` (current v${from})` : ''} - choose the new version`
        });
        if (!pick) { return; }
        const next = bumpVersion(from, pick.b);
        const tag = templateTag(id, next);
        const lines = subjects.length ? subjects.slice(0, 50) : ['Initial release.'];
        log.appendLine(`\n=== Release ${repo.label} v${next} (${tag}) ===`);
        lines.forEach(l => log.appendLine(`  - ${l}`));
        log.show(true);
        const d = await vscode.window.showQuickPick([
            { label: `$(tag) Commit and tag on ${branch}`, detail: `Pushes the version bump and the tag ${tag} now (needs push access).`, d: 'direct' as DeliveryMode },
            { label: '$(git-pull-request) Open a pull request', detail: 'Maintainers review the release. After the merge, run "Release Version" again to tag it.', d: 'pullRequest' as DeliveryMode }
        ], { placeHolder: `Release ${repo.label} v${next}` });
        if (!d) { return; }
        const changelogPath = repo.writePath('CHANGELOG.md');
        const changes: RepoChange[] = [
            { path: cfgPath, text: withTemplateVersion(cfgText, next) },
            { path: changelogPath, text: addChangelogEntry(await repo.mirror.readFile(sha, changelogPath), next, lines) }
        ];
        const res = await progress(`Releasing ${repo.label} v${next}…`, () => deliverChanges(repo, changes, {
            workRoot: workRoot(), delivery: d.d, branchName: `release-${id}-${next}`, reviewers: maintainers,
            message: `chore(${id}): release v${next}`, body: `Release ${tag}.\n\n${lines.map(l => `- ${l}`).join('\n')}`,
            tag: d.d === 'direct' ? tag : undefined, log: l => log.appendLine(l)
        }));
        await state.refresh(true);
        const url = res.prUrl ?? res.compareUrl;
        const a = await vscode.window.showInformationMessage(res.tag ? `Released ${repo.label} v${next} (${res.tag}).` : `Release pull request for v${next} opened. Run "Release Version" again after the merge to tag it.`, ...(url ? ['Open'] : []));
        if (a && url) { await vscode.env.openExternal(vscode.Uri.parse(url)); }
    });
}
