import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { buildCatalog, Catalog } from '../core/catalog';
import { readProjectConfig, writeComponentPolicy } from '../core/config';
import { git } from '../core/exec';
import { detectRepoValues, DetectedValues } from '../core/detect';
import { ExistingRepoOptions, findPowerShell, initializeArgs, installArgs, InitValues, NewProjectOptions, runScript } from '../core/init';
import { STATE_DIR, stateDirOf } from '../core/layout';
import { emptyLock, ensureSource, readLock } from '../core/lock';
import { ProjectOps } from '../core/operations';
import { KIND_LABELS } from '../core/paths';
import { ComponentState, computeStatus, STATUS_LABEL } from '../core/status';
import { TemplateRepo, TemplateSourceSpec } from '../core/templateRepo';
import { removeEmptyParents } from '../core/util';
import { ProjectState, settingsSources } from './projectState';

class Cancelled extends Error { constructor() { super('cancelled'); } }

function need<T>(v: T | undefined): T {
    if (v === undefined) { throw new Cancelled(); }
    return v;
}

export function isCancelled(e: unknown): boolean { return e instanceof Cancelled; }

async function pickSource(placeHolder: string): Promise<TemplateSourceSpec> {
    const list = settingsSources();
    if (list.length === 1) { return list[0]; }
    const pick = await vscode.window.showQuickPick(list.map(s => ({ label: s.name || s.url, description: `${s.url} @ ${s.ref}`, s })), { placeHolder, ignoreFocusOut: true });
    return need(pick).s;
}

async function input(prompt: string, value: string, validate?: (v: string) => string | undefined, placeHolder?: string): Promise<string> {
    return need(await vscode.window.showInputBox({ prompt, value, placeHolder, ignoreFocusOut: true, validateInput: validate }));
}

const PREFIX_RE = /^[A-Za-z][A-Za-z0-9]{1,9}$/;

type ValueDefaults = Partial<Omit<InitValues, 'workItemSystem' | 'extraTools'>>;

async function askValues(defaults: ValueDefaults, folderName: string, detected?: DetectedValues): Promise<InitValues> {
    const from = (hit: unknown, src: string) => hit ? ` — suggested from ${src}` : '';
    const appJsonRel = detected?.appJson ? path.basename(path.dirname(detected.appJson)) + '/app.json' : 'app.json';
    const appPrefix = await input(`App prefix used in AL object names (e.g. CON, ACME)${from(detected?.appPrefix, detected?.prefixSource ?? '')}`, defaults.appPrefix ?? '',
        v => PREFIX_RE.test(v.trim()) ? undefined : '2-10 letters/digits, starting with a letter');
    const ticketPrefix = await input('Work-item key used in branch names / commits (PREFIX-123). Leave empty for bare IDs.', defaults.ticketPrefix ?? appPrefix.trim());
    const appName = await input(`App display name (app.json "name")${from(detected?.appName, appJsonRel)}`, defaults.appName ?? `${appPrefix.trim()} ${folderName}`);
    const publisher = await input(`Publisher (app.json "publisher")${from(detected?.publisher, appJsonRel)}`, defaults.publisher ?? '');
    const range = await input(`Assigned AL object ID range (from-to)${from(detected?.objectIdFrom, `${appJsonRel} idRanges`)}`, `${defaults.objectIdFrom ?? 50100}-${defaults.objectIdTo ?? 50199}`, v => {
        const m = /^\s*(\d+)\s*[-–]\s*(\d+)\s*$/.exec(v);
        if (!m) { return 'Use the form 50100-50199'; }
        return +m[1] < +m[2] ? undefined : '"from" must be lower than "to"';
    });
    const [objectIdFrom, objectIdTo] = range.split(/[-–]/).map(s => parseInt(s.trim(), 10));
    const wisItems = [
        { label: 'Azure DevOps', description: 'Work items, AB#123 commit links, ADO MCP tools', v: 'ADO' as const },
        { label: 'GitHub Issues', description: '#123 links; ADO tools are removed from agents', v: 'GitHub' as const }
    ];
    if (detected?.workItemSystem) {
        wisItems.sort((a, b) => (a.v === detected.workItemSystem ? -1 : 0) - (b.v === detected.workItemSystem ? -1 : 0));
        wisItems[0].description = `(detected from the git remote) ${wisItems[0].description}`;
    }
    const wis = need(await vscode.window.showQuickPick(wisItems, { placeHolder: 'Where are your work items?', ignoreFocusOut: true })).v;
    let adoOrg: string | undefined, adoProject: string | undefined;
    if (wis === 'ADO') {
        adoOrg = await input('Azure DevOps organization', defaults.adoOrg && defaults.adoOrg !== 'your-organization' ? defaults.adoOrg : '');
        adoProject = await input('Azure DevOps project (optional)', defaults.adoProject ?? '');
    }
    const repoSlug = await input('GitHub owner/repo (optional; used in links and the sync workflow)', defaults.repoSlug && !/bc-alm-template$/i.test(defaults.repoSlug) ? defaults.repoSlug : '',
        v => !v.trim() || /^[\w.-]+\/[\w.-]+$/.test(v.trim()) ? undefined : 'Use owner/repo');
    const defaultBranch = await input('Default branch', defaults.defaultBranch ?? 'main', v => v.trim() ? undefined : 'Required');
    const tools = await input('Extra MCP tool IDs to add to every agent/prompt (comma separated, optional)', '', undefined, 'e.g. al/*, mycompany-mcp/*');
    return {
        appPrefix: appPrefix.trim(), ticketPrefix: ticketPrefix.trim(), appName: appName.trim(), publisher: publisher.trim() || undefined,
        objectIdFrom, objectIdTo, workItemSystem: wis, adoOrg: adoOrg?.trim() || undefined, adoProject: adoProject?.trim() || undefined,
        repoSlug: repoSlug.trim() || undefined, defaultBranch: defaultBranch.trim(),
        extraTools: tools.split(',').map(s => s.trim()).filter(Boolean)
    };
}

interface ContentChoice { key: string; label: string; detail: string; on: boolean }

async function pickContent(choices: ContentChoice[], title: string): Promise<Set<string>> {
    const picks = need(await vscode.window.showQuickPick(choices.map(c => ({ label: c.label, detail: c.detail, picked: c.on, key: c.key })),
        { canPickMany: true, title, placeHolder: 'Space toggles, Enter confirms. Core agents/skills/prompts/instructions are chosen next.', ignoreFocusOut: true }));
    return new Set(picks.map(p => p.key));
}

/** Choose which agents / skills / prompts / instructions to keep. Returns the component ids to drop. */
async function pickComponents(catalog: Catalog, title: string): Promise<string[]> {
    const comps = new Map<string, { kind: string; name: string; files: number }>();
    for (const f of catalog.files.values()) {
        const r = f.component;
        if (!['agent', 'skill', 'prompt', 'instruction'].includes(r.kind)) { continue; }
        const e = comps.get(r.id) ?? { kind: r.kind, name: r.name, files: 0 };
        e.files++;
        comps.set(r.id, e);
    }
    const items: (vscode.QuickPickItem & { id?: string })[] = [];
    for (const kind of ['agent', 'skill', 'prompt', 'instruction']) {
        const list = [...comps.entries()].filter(([, c]) => c.kind === kind).sort((a, b) => a[1].name.localeCompare(b[1].name));
        if (!list.length) { continue; }
        items.push({ label: KIND_LABELS[kind as keyof typeof KIND_LABELS], kind: vscode.QuickPickItemKind.Separator });
        for (const [id, c] of list) { items.push({ label: c.name, description: c.files > 1 ? `${c.files} files` : undefined, picked: true, id }); }
    }
    const picked = need(await vscode.window.showQuickPick(items, { canPickMany: true, title, placeHolder: 'Untick what you do not want. You can enable it later from the BC ALM view.', ignoreFocusOut: true }));
    const keep = new Set(picked.map(p => p.id).filter(Boolean));
    return [...comps.keys()].filter(id => !keep.has(id));
}

/** After the scripts ran: drop deselected components, install ticked ones the scripts did not copy, then record the lock baseline. */
async function finishProject(root: string, repo: TemplateRepo, sha: string, dropped: string[], log: vscode.OutputChannel): Promise<{ tracked: number; differing: number; installed: number }> {
    const project = readProjectConfig(root);
    if (!project) { throw new Error('template.config.json was not written by the initializer.'); }
    let catalog = await buildCatalog(repo, sha, project);
    if (dropped.length) {
        const drop = new Set(dropped);
        for (const f of catalog.files.values()) {
            if (!drop.has(f.component.id)) { continue; }
            const p = path.join(root, ...f.destRel.split('/'));
            if (fs.existsSync(p)) { fs.rmSync(p, { force: true }); removeEmptyParents(p, root); }
        }
        const policy = { disabled: [...new Set([...project.sync.components.disabled, ...dropped])], keepLocal: project.sync.components.keepLocal };
        writeComponentPolicy(root, policy);
        project.sync.components = policy;
        catalog = await buildCatalog(repo, sha, project);
        log.appendLine(`Left out ${dropped.length} component(s): ${dropped.join(', ')}`);
    }
    const status = await computeStatus({ root, project, lock: readLock(root), catalogs: [catalog] });
    const lock = readLock(root) ?? emptyLock();
    ensureSource(lock, { name: repo.spec.name, url: repo.spec.url, ref: repo.spec.ref }, true);
    const ops = new ProjectOps(root, project, lock, [catalog]);
    let tracked = 0, differing = 0, installed = 0;
    const taken = new Set<string>();
    for (const c of status.components) {
        if (c.disabled || !SELECTABLE_KINDS.includes(c.ref.kind)) { continue; }
        for (const f of c.files) {
            if (f.template && (f.status === 'available' || f.status === 'missing' || f.status === 'new')) {
                ops.take(f);
                taken.add(f.destRel);
                installed++;
                log.appendLine(`  installed ${f.destRel}`);
            }
        }
    }
    tracked += installed;
    for (const f of status.files) {
        if (taken.has(f.destRel) || !f.template || f.status === 'available' || f.status === 'disabled' || f.status === 'new') { continue; }
        if (ops.adoptLocal(f)) {
            tracked++;
            if (f.status !== 'current') { differing++; log.appendLine(`  baseline differs from template transform: ${f.destRel}`); }
        }
    }
    ops.save();
    return { tracked, differing, installed };
}

const SELECTABLE_KINDS: string[] = ['agent', 'skill', 'prompt', 'instruction'];

/** '*.template' side files the installer wrote next to existing files (for manual merge). */
function findTemplateSideFiles(root: string): string[] {
    const out: string[] = [];
    const walk = (dir: string, depth: number) => {
        if (depth > 4) { return; }
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            if (e.isDirectory()) {
                if (!['.git', 'node_modules', '.alpackages', '.alcache', '.snapshots'].includes(e.name)) { walk(path.join(dir, e.name), depth + 1); }
            } else if (e.name.endsWith('.template')) {
                out.push(path.relative(root, path.join(dir, e.name)).split(path.sep).join('/'));
            }
        }
    };
    walk(root, 0);
    return out;
}

/** The template script to run, preferring the .bc-alm/scripts location. */
function projectScript(root: string, name: string): string {
    const p = path.join(root, STATE_DIR, 'scripts', name);
    return fs.existsSync(p) ? p : path.join(root, 'scripts', name);
}

function pwshPath(): string | undefined {
    return vscode.workspace.getConfiguration('bcAlm').get<string>('powershellPath') || undefined;
}

export async function newProjectWizard(state: ProjectState, log: vscode.OutputChannel): Promise<void> {
    const spec = await pickSource('Template to start from');
    const parent = need(await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: 'Create project here', title: 'Parent folder for the new project' }))[0];
    const name = await input('Project folder name', '', v => {
        if (!/^[\w.-]+$/.test(v.trim())) { return 'Letters, digits, dot, dash, underscore'; }
        const p = path.join(parent.fsPath, v.trim());
        return fs.existsSync(p) && fs.readdirSync(p).length ? 'Folder exists and is not empty' : undefined;
    });
    const dest = path.join(parent.fsPath, name.trim());

    const repo = state.repo(spec);
    const { sha, cfg, catalogPreview } = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Loading ${repo.label}…` }, async () => {
        await repo.ensure(5 * 60_000);
        const s = await repo.resolve();
        const c = await repo.readConfig(s);
        if (!c) { throw new Error(`${repo.label} has no template.config.json at ${spec.ref}; it is not a BC ALM template.`); }
        return { sha: s, cfg: c, catalogPreview: await buildCatalog(repo, s, c) };
    });

    const values = await askValues({ ...cfg.values, appPrefix: '', ticketPrefix: undefined, appName: undefined, publisher: '' }, name.trim());
    const content = await pickContent([
        { key: 'cleanup', label: 'Clean up template-only files', detail: 'Removes CONTRIBUTING, installers, bootstrap and the extension sources; writes a project README', on: true },
        { key: 'sampleApp', label: 'Sample AL app (app/ + test/)', detail: 'A small working app that shows the conventions; renamed to your prefix and range', on: true },
        { key: 'specs', label: 'Spec scaffold (specs/_TEMPLATE)', detail: 'Spec-driven development folder used by bc-spec / bc-dev', on: true },
        { key: 'prTemplate', label: 'Pull request template', detail: '.github/PULL_REQUEST_TEMPLATE.md with the AL quality checklist', on: true },
        { key: 'issueOps', label: 'GitHub issue orchestration', detail: 'issue-*.yml workflows + issue forms (turn off when you work from Azure DevOps)', on: values.workItemSystem === 'GitHub' },
        { key: 'referenceDocs', label: 'Reference docs (docs/)', detail: 'Branching strategy, workflow, AL agent tools, BCQuality …', on: true },
        { key: 'metaDocs', label: 'Agent architecture docs', detail: 'AGENT-ARCHITECTURE.md, WHEN-TO-USE.md, SKILLS.md', on: false }
    ], 'Optional content');
    const dropped = await pickComponents(catalogPreview, 'Agents, skills, prompts and instructions to include');
    const commit = need(await vscode.window.showQuickPick(['Create an initial commit', 'Leave changes uncommitted'], { placeHolder: 'Git', ignoreFocusOut: true })) === 'Create an initial commit';

    const opts: NewProjectOptions = {
        cleanup: content.has('cleanup'), includeMetaDocs: content.has('metaDocs'), noReferenceDocs: !content.has('referenceDocs'),
        noIssueOps: !content.has('issueOps'), noSpecs: !content.has('specs'), noPrTemplate: !content.has('prTemplate'), noSampleApp: !content.has('sampleApp')
    };

    log.show(true);
    log.appendLine(`\n=== New BC ALM project: ${dest} (from ${repo.label} @ ${sha.slice(0, 7)}) ===`);
    const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Creating BC ALM project', cancellable: false }, async progress => {
        const pwsh = await findPowerShell(pwshPath());
        progress.report({ message: 'exporting template…' });
        await repo.exportTo(sha, dest);
        await git(['init', '--quiet', '-b', values.defaultBranch || 'main'], dest);
        progress.report({ message: 'applying your values…' });
        await runScript(pwsh, path.join(dest, 'scripts', 'Initialize-Template.ps1'), initializeArgs(values, opts), dest, s => log.append(s));
        progress.report({ message: 'recording template baseline…' });
        const r = await finishProject(dest, repo, sha, dropped, log);
        if (commit) {
            progress.report({ message: 'committing…' });
            await git(['add', '-A'], dest);
            const who = await git(['config', 'user.email'], dest, { allowFailure: true });
            const ident = who.stdout.trim() ? [] : ['-c', 'user.name=BC ALM', '-c', 'user.email=bc-alm@users.noreply.github.com'];
            await git([...ident, 'commit', '--quiet', '-m', `chore: initialize from BC ALM template ${sha.slice(0, 7)}`], dest, { allowFailure: true });
        }
        return r;
    });
    log.appendLine(`Tracked ${result.tracked} template file(s) in template.lock.json.`);
    const open = await vscode.window.showInformationMessage(`BC ALM project "${name}" is ready (${result.tracked} template files tracked).`, 'Open', 'Open in New Window');
    if (open) { await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(dest), { forceNewWindow: open === 'Open in New Window' }); }
}

export async function addToExistingRepoWizard(state: ProjectState, log: vscode.OutputChannel): Promise<void> {
    const folders = (vscode.workspace.workspaceFolders ?? []).filter(f => f.uri.scheme === 'file');
    let picked: string;
    const browse = 'Browse…';
    const pick = await vscode.window.showQuickPick([...folders.map(f => ({ label: f.name, description: f.uri.fsPath, p: f.uri.fsPath })), { label: browse, description: '', p: '' }],
        { placeHolder: 'Repository to add the BC ALM setup to', ignoreFocusOut: true });
    if (need(pick).label === browse) {
        picked = need(await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: 'Add BC ALM here' }))[0].fsPath;
    } else { picked = pick!.p; }
    picked = realPath(picked);

    // Install at the git repository root, even when an app subfolder (multi-root workspace) was picked.
    let target = picked;
    let custDefault = '.';
    const top = (await git(['rev-parse', '--show-toplevel'], picked, { allowFailure: true })).stdout.trim();
    if (top) {
        const repoRoot = realPath(path.resolve(top));
        const rel = path.relative(repoRoot, picked);
        if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
            const relFwd = rel.split(path.sep).join('/');
            const where = need(await vscode.window.showQuickPick([
                { label: `Repository root (${path.basename(repoRoot)})`, description: 'Recommended', detail: `BC ALM goes into ${repoRoot}; agents/skills can still live under ${relFwd}/`, root: true },
                { label: `Only ${relFwd}/`, description: '', detail: `Treat ${picked} as its own project (not recommended inside a git repo)`, root: false }
            ], { placeHolder: `${relFwd} is inside the git repository ${repoRoot}`, ignoreFocusOut: true }));
            if (where.root) {
                target = repoRoot;
                const wsRoot = folders.some(f => realPath(f.uri.fsPath).toLowerCase() === repoRoot.toLowerCase());
                if (!wsRoot) { custDefault = relFwd; }
            }
        }
    }
    if (stateDirOf(target) || fs.existsSync(path.join(target, 'template.config.json'))) {
        const go = await vscode.window.showWarningMessage('This repository already has a BC ALM setup (template.config.json). Use the BC ALM view to update it instead. Re-run the setup anyway? Your existing files are kept; only missing template files are added.', { modal: true }, 'Re-run setup');
        need(go);
    }
    const spec = await pickSource('Template to install from');
    const repo = state.repo(spec);
    const { sha, cfg, catalogPreview } = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Loading ${repo.label}…` }, async () => {
        await repo.ensure(5 * 60_000);
        const s = await repo.resolve();
        const c = await repo.readConfig(s);
        if (!c) { throw new Error(`${repo.label} is not a BC ALM template (no template.config.json).`); }
        return { sha: s, cfg: c, catalogPreview: await buildCatalog(repo, s, c) };
    });

    const appFolders = fs.readdirSync(target, { withFileTypes: true }).filter(d => d.isDirectory() && fs.existsSync(path.join(target, d.name, 'app.json'))).map(d => d.name);
    const custItems = [
        { label: '.', description: 'Repository root' },
        ...appFolders.map(f => ({ label: f, description: `Put .github customizations under ${f}/ (for opening that folder directly)` }))
    ];
    if (custDefault !== '.' && !custItems.some(i => i.label === custDefault)) { custItems.push({ label: custDefault, description: '' }); }
    const first = custItems.find(i => i.label === custDefault)!;
    first.description = `${first.description ? first.description + ' — ' : ''}recommended${custDefault !== '.' ? ' (the repo root is not a workspace folder)' : ''}`;
    custItems.sort((a, b) => (a === first ? -1 : 0) - (b === first ? -1 : 0));
    const custPick = need(await vscode.window.showQuickPick(custItems, { placeHolder: 'Where should agents / skills / prompts live?', ignoreFocusOut: true }));

    const detected = await detectRepoValues(target, picked !== target ? picked : undefined);
    if (detected.appJson) { log.appendLine(`Suggesting values from ${detected.appJson}${detected.adoOrg || detected.repoSlug ? ' and the git remote' : ''}.`); }
    const values = await askValues({
        ...cfg.values,
        appPrefix: detected.appPrefix ?? '', publisher: detected.publisher ?? '', ticketPrefix: undefined, appName: detected.appName,
        objectIdFrom: detected.objectIdFrom ?? cfg.values?.objectIdFrom, objectIdTo: detected.objectIdTo ?? cfg.values?.objectIdTo,
        adoOrg: detected.adoOrg ?? '', adoProject: detected.adoProject ?? '', repoSlug: detected.repoSlug ?? '',
        defaultBranch: detected.defaultBranch ?? cfg.values?.defaultBranch
    }, path.basename(target), detected);
    const content = await pickContent([
        { key: 'specs', label: 'Spec scaffold (specs/_TEMPLATE)', detail: 'Used by bc-spec / bc-dev', on: true },
        { key: 'prTemplate', label: 'Pull request template', detail: 'Skipped automatically if you already have one', on: true },
        { key: 'syncWorkflow', label: 'Template sync GitHub Action', detail: 'Weekly PR with template updates (off for Azure DevOps-only repos)', on: values.workItemSystem === 'GitHub' },
        { key: 'issueOps', label: 'GitHub issue orchestration', detail: 'issue-*.yml workflows + issue forms', on: false },
        { key: 'referenceDocs', label: 'Reference docs (docs/)', detail: 'Branching strategy, workflow, AL agent tools …', on: false },
        { key: 'metaDocs', label: 'Agent architecture docs', detail: 'AGENT-ARCHITECTURE.md, WHEN-TO-USE.md, SKILLS.md', on: false },
        { key: 'sampleApp', label: 'Sample AL app', detail: 'Usually off for an existing app', on: false }
    ], 'Optional content');
    const dropped = await pickComponents(catalogPreview, 'Agents, skills, prompts and instructions to include');

    const opts: ExistingRepoOptions = {
        customizationsPath: custPick.label, includeMetaDocs: content.has('metaDocs'), includeReferenceDocs: content.has('referenceDocs'),
        includeIssueOps: content.has('issueOps'), includeSampleApp: content.has('sampleApp'), noSpecs: !content.has('specs'),
        noPrTemplate: !content.has('prTemplate'), noSyncWorkflow: !content.has('syncWorkflow')
    };

    log.show(true);
    log.appendLine(`\n=== Add BC ALM to ${target} (from ${repo.label} @ ${sha.slice(0, 7)}) ===`);
    const tmp = realPath(fs.mkdtempSync(path.join(os.tmpdir(), 'bc-alm-src-')));
    try {
        const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Adding BC ALM setup' }, async progress => {
            const pwsh = await findPowerShell(pwshPath());
            progress.report({ message: 'exporting template…' });
            await repo.exportTo(sha, tmp);
            progress.report({ message: 'copying files…' });
            await runScript(pwsh, path.join(tmp, 'scripts', 'Install-IntoExistingRepo.ps1'), installArgs(target, tmp, opts), target, s => log.append(s));
            progress.report({ message: 'applying your values…' });
            await runScript(pwsh, projectScript(target, 'Initialize-Template.ps1'), initializeArgs(values, undefined, true), target, s => log.append(s));
            progress.report({ message: 'recording template baseline…' });
            return finishProject(target, repo, sha, dropped, log);
        });
        log.appendLine(`Tracked ${result.tracked} template file(s) in ${STATE_DIR}/template.lock.json${result.installed ? ` (${result.installed} added after the installer)` : ''}.`);
        const side = findTemplateSideFiles(target);
        if (side.length) {
            log.appendLine(`Review these '.template' files (the template's version of a file you already have), merge what you want, then delete them:`);
            for (const s of side) { log.appendLine(`  ${s}`); }
        }
        const msg = `BC ALM setup added to ${path.basename(target)} (${result.tracked} template files tracked; bookkeeping in ${STATE_DIR}/).`
            + (side.length ? ` ${side.length} '.template' file(s) need a manual merge — see the output.` : '') + ' Review the changes in Source Control and commit them.';
        vscode.window.showInformationMessage(msg);
        await state.refresh(false, true);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

function realPath(p: string): string {
    try { return fs.realpathSync.native(p); } catch { return p; }
}

type UpdateAction = 'take' | 'merge' | 'delete';

/** One picker for every pending template change. */
export async function updateAllPicker(state: ProjectState, log: vscode.OutputChannel): Promise<void> {
    const comps = (state.status?.components ?? []).filter(c => !c.disabled && !c.keepLocal);
    const items: (vscode.QuickPickItem & { c?: ComponentState; action?: UpdateAction })[] = [];
    const add = (title: string, list: ComponentState[], action: UpdateAction, picked: boolean, detail: (c: ComponentState) => string) => {
        if (!list.length) { return; }
        items.push({ label: title, kind: vscode.QuickPickItemKind.Separator });
        for (const c of list) { items.push({ label: c.ref.name, description: `${KIND_LABELS[c.ref.kind]} · ${STATUS_LABEL[c.status]}`, detail: detail(c), picked, c, action }); }
    };
    add('Safe updates (you have not changed these)', comps.filter(c => ['update', 'new', 'missing'].includes(c.status)), 'take', true,
        c => `${c.files.filter(f => ['update', 'new', 'missing'].includes(f.status)).length} file(s)`);
    add('Changed on both sides — 3-way merge (conflict markers if needed)', comps.filter(c => c.status === 'conflict'), 'merge', true,
        () => 'Your edits are kept; template changes are merged in');
    add('Removed from the template — delete your copy?', comps.filter(c => c.status === 'removed'), 'delete', false,
        () => 'Leave unticked to keep it as your own');
    if (!items.length) {
        vscode.window.showInformationMessage('Everything is up to date with the template.');
        return;
    }
    const picks = await vscode.window.showQuickPick(items, { canPickMany: true, title: 'Apply template updates', placeHolder: 'Modified-only components are not listed (nothing to take). Use "Keep local" to stop updates for a component.', ignoreFocusOut: true });
    if (!picks?.length) { return; }
    const ops = state.ops();
    let taken = 0, merged = 0, conflicts = 0, deleted = 0;
    const conflictFiles: string[] = [];
    for (const p of picks) {
        if (!p.c) { continue; }
        for (const f of p.c.files) {
            if (p.action === 'take' && ['update', 'new', 'missing'].includes(f.status)) { ops.take(f); taken++; }
            else if (p.action === 'merge' && f.status === 'conflict') {
                const r = await ops.merge(f);
                merged++;
                if (r.conflicts) { conflicts++; conflictFiles.push(f.destRel); }
            } else if (p.action === 'merge' && ['update', 'new', 'missing'].includes(f.status)) { ops.take(f); taken++; }
            else if (p.action === 'delete' && f.status === 'removed') { ops.deleteLocal(f.destRel); deleted++; }
        }
    }
    ops.save();
    log.appendLine(`Template update: ${taken} taken, ${merged} merged (${conflicts} with conflicts), ${deleted} deleted.`);
    await state.refresh(false, true);
    const msg = `Updated ${taken} file(s), merged ${merged}${deleted ? `, deleted ${deleted}` : ''}.`;
    if (conflicts) {
        const open = await vscode.window.showWarningMessage(`${msg} ${conflicts} file(s) have conflict markers to resolve.`, 'Open Conflicts');
        if (open) { for (const f of conflictFiles) { await vscode.window.showTextDocument(vscode.Uri.file(path.join(ops.root, ...f.split('/'))), { preview: false }); } }
    } else {
        vscode.window.showInformationMessage(msg);
    }
}
