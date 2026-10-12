import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { buildCatalog, Catalog } from '../core/catalog';
import { readProjectConfig, writeComponentPolicy } from '../core/config';
import { git } from '../core/exec';
import { ExistingRepoOptions, findPowerShell, initializeArgs, installArgs, InitValues, NewProjectOptions, runScript } from '../core/init';
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

async function askValues(defaults: ValueDefaults, folderName: string): Promise<InitValues> {
    const appPrefix = await input('App prefix used in AL object names (e.g. CON, ACME)', defaults.appPrefix ?? '',
        v => PREFIX_RE.test(v.trim()) ? undefined : '2-10 letters/digits, starting with a letter');
    const ticketPrefix = await input('Work-item key used in branch names / commits (PREFIX-123). Leave empty for bare IDs.', defaults.ticketPrefix ?? appPrefix.trim());
    const appName = await input('App display name (app.json "name")', defaults.appName ?? `${appPrefix.trim()} ${folderName}`);
    const publisher = await input('Publisher (app.json "publisher")', defaults.publisher ?? '');
    const range = await input('Assigned AL object ID range (from-to)', `${defaults.objectIdFrom ?? 50100}-${defaults.objectIdTo ?? 50199}`, v => {
        const m = /^\s*(\d+)\s*[-–]\s*(\d+)\s*$/.exec(v);
        if (!m) { return 'Use the form 50100-50199'; }
        return +m[1] < +m[2] ? undefined : '"from" must be lower than "to"';
    });
    const [objectIdFrom, objectIdTo] = range.split(/[-–]/).map(s => parseInt(s.trim(), 10));
    const wis = need(await vscode.window.showQuickPick([
        { label: 'Azure DevOps', description: 'Work items, AB#123 commit links, ADO MCP tools', v: 'ADO' as const },
        { label: 'GitHub Issues', description: '#123 links; ADO tools are removed from agents', v: 'GitHub' as const }
    ], { placeHolder: 'Where are your work items?', ignoreFocusOut: true })).v;
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

/** After the scripts ran: drop deselected components, then record the lock baseline. */
async function finishProject(root: string, repo: TemplateRepo, sha: string, dropped: string[], log: vscode.OutputChannel): Promise<{ tracked: number; differing: number }> {
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
    let tracked = 0, differing = 0;
    for (const f of status.files) {
        if (!f.template || f.status === 'available' || f.status === 'disabled' || f.status === 'new') { continue; }
        if (ops.adoptLocal(f)) {
            tracked++;
            if (f.status !== 'current') { differing++; log.appendLine(`  baseline differs from template transform: ${f.destRel}`); }
        }
    }
    ops.save();
    return { tracked, differing };
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
    let target: string;
    const browse = 'Browse…';
    const pick = await vscode.window.showQuickPick([...folders.map(f => ({ label: f.name, description: f.uri.fsPath, p: f.uri.fsPath })), { label: browse, description: '', p: '' }],
        { placeHolder: 'Repository to add the BC ALM setup to', ignoreFocusOut: true });
    if (need(pick).label === browse) {
        target = need(await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: 'Add BC ALM here' }))[0].fsPath;
    } else { target = pick!.p; }
    if (fs.existsSync(path.join(target, 'template.config.json'))) {
        const go = await vscode.window.showWarningMessage('This repository already has template.config.json. Use the BC ALM view to update it instead. Re-install anyway (existing template files are overwritten)?', { modal: true }, 'Re-install');
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
    const custPick = need(await vscode.window.showQuickPick([
        { label: '.', description: 'Repository root (default)' },
        ...appFolders.map(f => ({ label: f, description: `Put .github customizations under ${f}/ (for opening that folder directly)` }))
    ], { placeHolder: 'Where should agents / skills / prompts live?', ignoreFocusOut: true }));

    const values = await askValues({ ...cfg.values, appPrefix: '', publisher: '', ticketPrefix: undefined, appName: undefined }, path.basename(target));
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
        noPrTemplate: !content.has('prTemplate'), noSyncWorkflow: !content.has('syncWorkflow'), force: true
    };

    log.show(true);
    log.appendLine(`\n=== Add BC ALM to ${target} (from ${repo.label} @ ${sha.slice(0, 7)}) ===`);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-alm-src-'));
    try {
        const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Adding BC ALM setup' }, async progress => {
            const pwsh = await findPowerShell(pwshPath());
            progress.report({ message: 'exporting template…' });
            await repo.exportTo(sha, tmp);
            progress.report({ message: 'copying files…' });
            await runScript(pwsh, path.join(tmp, 'scripts', 'Install-IntoExistingRepo.ps1'), installArgs(target, tmp, opts), target, s => log.append(s));
            progress.report({ message: 'applying your values…' });
            await runScript(pwsh, path.join(target, 'scripts', 'Initialize-Template.ps1'), initializeArgs(values, undefined, true), target, s => log.append(s));
            progress.report({ message: 'recording template baseline…' });
            return finishProject(target, repo, sha, dropped, log);
        });
        log.appendLine(`Tracked ${result.tracked} template file(s) in template.lock.json.`);
        vscode.window.showInformationMessage(`BC ALM setup added (${result.tracked} template files tracked). Review the changes in Source Control and commit them.`);
        await state.refresh(false, true);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
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
