import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { CONFIG_FILE, custRoot } from '../core/config';
import { DependencyGraph, referencedComponents } from '../core/deps';
import { migrateToBcAlm, needsMigration, rewriteTrackedForLayout, STATE_DIR, statePath } from '../core/layout';
import { emptyLock, ensureSource, readLock, writeLock } from '../core/lock';
import { componentOf, isReparamTarget, resolveDest, srcFromDest } from '../core/paths';
import { commandExists } from '../core/exec';
import { findFork, forkBlocker, ghOwners, ghRepoInfo, requireGh } from '../core/github';
import { createOwnTemplate, CreateTemplateHow, DeliveryMode, executePublish, githubSlug, isLocalPath, preparePublish, PublishPlan, syncForkFromUpstream, syncFromUpstream } from '../core/publish';
import { isValidComponentName, scaffold, scaffoldPath, ScaffoldInput } from '../core/scaffolds';
import { ComponentState, disabledPath, FileState, STATUS_LABEL } from '../core/status';
import { TemplateSourceSpec } from '../core/templateRepo';
import { Finding } from '../core/validator';
import { readTextIfExists, sameUrl, toPosix } from '../core/util';
import { CustomizationDiagnostics, TemplateContentProvider } from './diagnostics';
import { ProjectState, saveSettingsSources, settingsSources, SourceInfo, UPSTREAM_URL } from './projectState';
import { ComponentsNode, GuidanceTree } from './trees';
import { addToExistingRepoWizard, isCancelled, newProjectWizard, updateAllPicker } from './wizards';

export interface CommandContext {
    ext: vscode.ExtensionContext;
    state: ProjectState;
    log: vscode.OutputChannel;
    content: TemplateContentProvider;
    diagnostics: CustomizationDiagnostics;
    guidance: GuidanceTree;
}

const UPDATABLE = ['update', 'new', 'missing'];

export function registerCommands(cx: CommandContext): void {
    const { ext, state, log, content, diagnostics, guidance } = cx;

    const reg = (id: string, fn: (...args: any[]) => unknown) => ext.subscriptions.push(vscode.commands.registerCommand(id, async (...args: any[]) => {
        try {
            await fn(...args);
        } catch (e) {
            if (isCancelled(e)) { return; }
            const msg = (e as Error).message ?? String(e);
            log.appendLine(`[${id}] ${(e as Error).stack ?? msg}`);
            const a = await vscode.window.showErrorMessage(`BC ALM: ${msg.split('\n')[0]}`, 'Show Log');
            if (a) { log.show(); }
        }
    }));

    const absOf = (destRel: string) => path.join(state.root!, ...destRel.split('/'));

    /** Resolve a component from a tree node, an explorer/editor URI, or the active editor. */
    const componentFrom = (arg: unknown): ComponentState | undefined => {
        const n = arg as ComponentsNode | undefined;
        if (n && typeof n === 'object' && 'type' in n && (n.type === 'component' || n.type === 'file')) { return state.component(n.comp.ref.id); }
        const uri = arg instanceof vscode.Uri ? arg : vscode.window.activeTextEditor?.document.uri;
        if (!uri || !state.root || !state.project) { return undefined; }
        let rel = toPosix(path.relative(state.root, uri.fsPath));
        if (rel.startsWith('..')) { return undefined; }
        const f = state.file(rel);
        if (f) { return state.component(f.component.id); }
        rel = srcFromDest(rel, state.project.sync);
        return state.component(componentOf(rel).id);
    };
    const needComponent = (arg: unknown): ComponentState => {
        const c = componentFrom(arg);
        if (!c) { throw new Error('Select a component in the BC ALM view (or open one of its files) first.'); }
        return c;
    };
    const fileFrom = (arg: unknown): FileState | undefined => {
        const n = arg as ComponentsNode | undefined;
        if (n && typeof n === 'object' && 'type' in n && n.type === 'file') { return state.file(n.file.destRel); }
        return undefined;
    };

    const graph = (): DependencyGraph => {
        const g = new DependencyGraph();
        const seen = new Set<string>();
        for (const cat of state.catalogs) {
            for (const f of cat.files.values()) {
                if (seen.has(f.destRel)) { continue; }
                seen.add(f.destRel);
                g.add(f.component, referencedComponents(f.srcRel, f.raw));
            }
        }
        for (const f of state.status?.files ?? []) {
            if (f.status !== 'custom') { continue; }
            const t = readTextIfExists(absOf(f.destRel));
            if (t !== undefined) { g.add(f.component, referencedComponents(f.srcRel, t)); }
        }
        return g;
    };

    const done = async (msg?: string) => {
        await state.refresh(false, true);
        if (msg) { vscode.window.showInformationMessage(msg); }
    };

    const openConflicts = async (files: string[]) => {
        for (const f of files) { await vscode.window.showTextDocument(vscode.Uri.file(absOf(f)), { preview: false }); }
    };

    // ------------------------------------------------------------ projects

    reg('bcAlm.newProject', () => newProjectWizard(state, log));
    reg('bcAlm.addToExistingRepo', () => addToExistingRepoWizard(state, log));
    reg('bcAlm.refresh', async () => {
        await vscode.window.withProgress({ location: { viewId: 'bcAlm.components' } }, () => state.refresh(true));
        if (state.lastError) { vscode.window.showWarningMessage(`BC ALM: ${state.lastError}`); }
    });
    reg('bcAlm.updateAll', () => updateAllPicker(state, log));

    reg('bcAlm.migrateLayout', async () => {
        const root = state.root;
        if (!root || !state.project) { throw new Error('No BC ALM project is open.'); }
        if (!needsMigration(root)) { vscode.window.showInformationMessage('BC ALM: this project already uses the .bc-alm/ layout.'); return; }
        const sync = { ...state.project.sync, stateDir: STATE_DIR };
        const r = migrateToBcAlm(root, custRoot(sync));
        const changed = rewriteTrackedForLayout(root, custRoot(sync), p => isReparamTarget(p, sync));
        log.appendLine(`[migrateLayout] ${[...r.moved, ...changed.map(c => `${c} (references)`)].join('\n  ')}`);
        await done(`Moved ${r.moved.length} BC ALM file(s) into .bc-alm/${changed.length ? ` and updated references in ${changed.length} file(s)` : ''}. Review and commit the change.`);
    });

    reg('bcAlm.adoptBaseline', async () => {
        const ops = state.ops();
        const files = (state.status?.files ?? []).filter(f => f.template && !f.lock);
        let adopted = 0;
        const unknown: FileState[] = [];
        for (const f of files) {
            if (ops.adopt(f)) { adopted++; } else if (f.status === 'modified' && f.unknownBase) { unknown.push(f); }
        }
        if (unknown.length) {
            const a = await vscode.window.showInformationMessage(
                `${unknown.length} file(s) differ from every recent template version. Record them at the current template version? Their differences will then show as your own changes (future updates are merged, not overwritten).`,
                { modal: true }, 'Record as My Changes', 'Leave Untracked');
            if (a === 'Record as My Changes') { unknown.forEach(f => ops.keepMine(f)); adopted += unknown.length; }
        }
        ops.save();
        await done(`Recorded ${adopted} file(s) in template.lock.json. Commit it so teammates and the sync workflow share the same baseline.`);
    });

    // ------------------------------------------------------------ per-component sync

    reg('bcAlm.updateComponent', async (arg: unknown) => {
        const c = needComponent(arg);
        const ops = state.ops();
        if (c.status === 'removed') {
            const a = await vscode.window.showWarningMessage(`"${c.ref.name}" was removed from the template. Delete your copy, or keep it as your own?`, { modal: true }, 'Delete', 'Keep as My Own');
            if (a === 'Delete') { c.files.forEach(f => ops.deleteLocal(f.destRel)); }
            else if (a === 'Keep as My Own') { c.files.forEach(f => ops.forget(f.destRel)); }
            else { return; }
            ops.save();
            return done();
        }
        let n = 0;
        const conflicts: string[] = [];
        for (const f of c.files) {
            if (UPDATABLE.includes(f.status)) { ops.take(f); n++; }
            else if (f.status === 'conflict') { const r = await ops.merge(f); n++; if (r.conflicts) { conflicts.push(f.destRel); } }
        }
        ops.save();
        await done(conflicts.length ? undefined : `Updated ${c.ref.name} (${n} file${n === 1 ? '' : 's'}).`);
        if (conflicts.length) {
            const a = await vscode.window.showWarningMessage(`${c.ref.name}: ${conflicts.length} file(s) have conflict markers to resolve.`, 'Open');
            if (a) { await openConflicts(conflicts); }
        }
    });

    reg('bcAlm.mergeComponent', async (arg: unknown) => {
        const c = needComponent(arg);
        const ops = state.ops();
        const conflicts: string[] = [];
        let merged = 0;
        for (const f of c.files) {
            if (f.status === 'conflict') {
                const r = await ops.merge(f);
                merged++;
                if (r.conflicts) { conflicts.push(f.destRel); }
            } else if (UPDATABLE.includes(f.status)) { ops.take(f); }
        }
        ops.save();
        await state.refresh(false, true);
        if (conflicts.length) {
            const a = await vscode.window.showWarningMessage(`Merged ${merged} file(s); ${conflicts.length} need manual resolution (look for <<<<<<< yours / >>>>>>> template).`, 'Open');
            if (a) { await openConflicts(conflicts); }
        } else {
            vscode.window.showInformationMessage(`Merged template changes into ${c.ref.name} cleanly. Review and commit.`);
        }
    });

    reg('bcAlm.resetComponent', async (arg: unknown) => {
        const c = needComponent(arg);
        const changed = c.files.filter(f => f.template && f.status !== 'current' && f.status !== 'disabled');
        if (!changed.length) { return; }
        const a = await vscode.window.showWarningMessage(`Replace ${changed.length} file(s) of "${c.ref.name}" with the template version? Your local changes are discarded (still recoverable through git).`, { modal: true }, 'Reset');
        if (a !== 'Reset') { return; }
        const ops = state.ops();
        changed.forEach(f => ops.take(f));
        ops.save();
        await done(`Reset ${c.ref.name} to the template version.`);
    });

    reg('bcAlm.skipUpdate', async (arg: unknown) => {
        const c = needComponent(arg);
        const ops = state.ops();
        c.files.filter(f => f.status === 'update' || f.status === 'conflict').forEach(f => ops.keepMine(f));
        ops.save();
        await done(`Skipped this template version of ${c.ref.name}. You will be offered the next change.`);
    });

    reg('bcAlm.showDiff', async (arg: unknown) => {
        let f = fileFrom(arg);
        if (!f) {
            const c = needComponent(arg);
            const cands = c.files.filter(x => x.template && ['update', 'conflict', 'modified', 'missing', 'new'].includes(x.status));
            if (cands.length === 1) { f = cands[0]; }
            else if (cands.length > 1) {
                const p = await vscode.window.showQuickPick(cands.map(x => ({ label: x.destRel, description: STATUS_LABEL[x.status], x })), { placeHolder: 'File to compare' });
                f = p?.x;
            }
        }
        if (!f?.template) { return; }
        const name = path.posix.basename(f.destRel);
        const left = content.uri(f.template.transformed, name, 'template');
        const local = vscode.Uri.file(absOf(f.destRel));
        const right = fs.existsSync(local.fsPath) ? local : content.uri('', name, 'deleted');
        const srcName = state.sources.find(s => sameUrl(s.url, f!.source))?.name ?? 'template';
        await vscode.commands.executeCommand('vscode.diff', left, right, `${name}: ${srcName} ↔ yours (${STATUS_LABEL[f.status]})`);
    });

    reg('bcAlm.openFile', async (f: FileState) => {
        if (!state.root) { return; }
        const local = absOf(f.destRel);
        if (fs.existsSync(local)) { return vscode.window.showTextDocument(vscode.Uri.file(local), { preview: true }); }
        const stored = disabledPath(state.root, f.destRel);
        if (fs.existsSync(stored)) { return vscode.window.showTextDocument(vscode.Uri.file(stored), { preview: true }); }
        if (f.template) {
            const doc = await vscode.workspace.openTextDocument(content.uri(f.template.transformed, path.posix.basename(f.destRel), 'template'));
            return vscode.window.showTextDocument(doc, { preview: true });
        }
    });

    // ------------------------------------------------------------ policy

    reg('bcAlm.keepLocal', async (arg: unknown) => {
        const c = needComponent(arg);
        state.ops().setKeepLocal(c.ref.id, true);
        await done(`"${c.ref.name}" will no longer be updated from the template (recorded in template.config.json → sync.components.keepLocal).`);
    });

    reg('bcAlm.unkeepLocal', async (arg: unknown) => {
        const c = needComponent(arg);
        if (c.implicitKeep) {
            const a = await vscode.window.showInformationMessage(`"${c.ref.name}" is kept local by a sync setting in template.config.json (updateInstructions / updateExtensions). Open it?`, 'Open template.config.json');
            if (a) { await vscode.window.showTextDocument(vscode.Uri.file(statePath(state.root!, CONFIG_FILE))); }
            return;
        }
        state.ops().setKeepLocal(c.ref.id, false);
        await done(`"${c.ref.name}" follows the template again.`);
    });

    reg('bcAlm.disableComponent', async (arg: unknown) => {
        const c = needComponent(arg);
        const users = graph().dependents(c.ref.id).map(id => state.component(id)).filter((x): x is ComponentState => !!x && x.installed && !x.disabled);
        const warn = users.length ? `\n\nStill referenced by: ${users.map(u => `${u.ref.kind} ${u.ref.name}`).join(', ')}.` : '';
        const a = await vscode.window.showWarningMessage(`Disable "${c.ref.name}"? Its files move to .bc-alm/disabled/ (so Copilot stops loading them) and template updates skip it until you enable it again.${warn}`, { modal: true }, 'Disable');
        if (a !== 'Disable') { return; }
        state.ops().disable(c);
        await done();
    });

    reg('bcAlm.enableComponent', async (arg: unknown) => {
        const c = needComponent(arg);
        const ops = state.ops();
        ops.enable(c);
        ops.save();
        await done(`Enabled ${c.ref.name}.`);
    });

    reg('bcAlm.installComponent', async (arg: unknown) => {
        const c = needComponent(arg);
        const ops = state.ops();
        const deps = graph().closure(c.ref.id).map(id => state.component(id)).filter((x): x is ComponentState => !!x && x.status === 'available');
        let withDeps: ComponentState[] = [];
        if (deps.length) {
            const a = await vscode.window.showInformationMessage(`"${c.ref.name}" uses ${deps.map(d => `${d.ref.kind} ${d.ref.name}`).join(', ')}, which ${deps.length === 1 ? 'is' : 'are'} not installed.`, 'Install All', `Only ${c.ref.name}`);
            if (!a) { return; }
            if (a === 'Install All') { withDeps = deps; }
        }
        let n = 0;
        for (const x of [c, ...withDeps]) {
            if (x.disabled) { ops.enable(x); } else { n += ops.install(x); }
        }
        ops.save();
        await done(`Installed ${[c, ...withDeps].map(x => x.ref.name).join(', ')}${n ? ` (${n} files)` : ''}.`);
    });

    reg('bcAlm.switchSource', async (arg: unknown) => {
        const c = needComponent(arg);
        const others = state.catalogs.filter(cat => !sameUrl(cat.repo.spec.url, c.source) && [...cat.files.values()].some(f => f.component.id === c.ref.id));
        if (!others.length) {
            vscode.window.showInformationMessage(`No other template source in this project offers "${c.ref.name}". Add one in Template Sources and choose "Use in This Project".`);
            return;
        }
        const pick = await vscode.window.showQuickPick(others.map(cat => ({ label: cat.repo.label, description: `${cat.repo.spec.ref} @ ${cat.sha.slice(0, 7)}`, cat })), { placeHolder: `Track "${c.ref.name}" from…` });
        if (!pick) { return; }
        const ops = state.ops();
        ops.switchSource(c, pick.cat);
        ops.save();
        await done(`"${c.ref.name}" now follows ${pick.cat.repo.label}. Differences show as your changes - compare and reset if you want the new source's version.`);
    });

    reg('bcAlm.reapplyValues', async () => {
        await state.refresh(false, true);
        const ops = state.ops();
        const files = (state.status?.files ?? []).filter(f => f.status === 'update' && f.template && (!f.lock || f.lock.templateHash === f.template.rawHash));
        const comps = (state.status?.components ?? []);
        const skip = new Set(comps.filter(c => c.keepLocal || c.disabled).map(c => c.ref.id));
        const todo = files.filter(f => !skip.has(f.component.id));
        if (!todo.length) {
            vscode.window.showInformationMessage('All template files already reflect the values in template.config.json (files you changed yourself are left alone).');
            return;
        }
        const a = await vscode.window.showInformationMessage(`Re-apply template.config.json values (prefix, range, org, tools, models) to ${todo.length} unmodified template file(s)?`, { modal: true }, 'Apply');
        if (a !== 'Apply') { return; }
        todo.forEach(f => ops.take(f));
        ops.save();
        await done(`Updated ${todo.length} file(s).`);
    });

    // ------------------------------------------------------------ authoring

    reg('bcAlm.newCustomization', async () => {
        if (!state.root || !state.project) { throw new Error('Open a BC ALM project first.'); }
        const kindPick = await vscode.window.showQuickPick<{ label: string; detail: string; k: ScaffoldInput['kind'] }>([
            { label: 'Skill', detail: 'A reusable procedure Copilot loads on demand (SKILL.md + resources). Best place for "how we do X".', k: 'skill' },
            { label: 'Agent', detail: 'A persona with its own tools/model and handoffs. Keep it thin; link a skill for the procedure.', k: 'agent' },
            { label: 'Prompt', detail: 'An explicitly invoked /command with parameters.', k: 'prompt' },
            { label: 'Instruction', detail: 'Always-on rules for files matching a glob (applyTo).', k: 'instruction' }
        ], { placeHolder: 'What do you want to create?' });
        if (!kindPick) { return; }
        const kind = kindPick.k;
        const prefix = state.project.values.appPrefix.toLowerCase();
        const name = await vscode.window.showInputBox({
            prompt: `${kindPick.label} name`, placeHolder: kind === 'skill' ? `${prefix}-my-procedure` : `${prefix}-my-${kind}`,
            validateInput: v => isValidComponentName(kind, v.trim()) ?? (fs.existsSync(absOf(resolveDest(scaffoldPath(kind, v.trim()), state.project!.sync))) ? 'Already exists.' : undefined)
        });
        if (!name) { return; }
        const description = await vscode.window.showInputBox({
            prompt: kind === 'skill' || kind === 'agent' ? 'Description - WHAT it does and WHEN to use it ("Use when: …"). This is what Copilot matches on.' : 'Short description',
            validateInput: v => v.trim().length < 10 ? 'Write a useful description (at least a sentence).' : undefined
        });
        if (!description) { return; }
        const input: ScaffoldInput = { kind, name: name.trim(), description: description.trim() };
        const comps = state.status?.components ?? [];
        if (kind === 'agent') {
            const skills = comps.filter(c => c.ref.kind === 'skill' && c.installed && !c.disabled);
            const p = await vscode.window.showQuickPick([{ label: '$(add) Create a matching skill', v: '__new' }, { label: 'No backing skill', v: '' }, ...skills.map(s => ({ label: s.ref.name, v: s.ref.name }))], { placeHolder: 'Skill that holds this agent\'s procedure' });
            if (!p) { return; }
            if (p.v === '__new') {
                const sk = input.name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
                const sp = absOf(resolveDest(scaffoldPath('skill', sk), state.project.sync));
                if (!fs.existsSync(sp)) {
                    fs.mkdirSync(path.dirname(sp), { recursive: true });
                    fs.writeFileSync(sp, scaffold({ kind: 'skill', name: sk, description: input.description }), 'utf8');
                }
                input.link = sk;
            } else { input.link = p.v || undefined; }
        } else if (kind === 'prompt') {
            const agents = comps.filter(c => c.ref.kind === 'agent' && c.installed && !c.disabled);
            const p = await vscode.window.showQuickPick([{ label: 'agent', description: 'built-in agent mode', v: 'agent' }, { label: 'ask', description: 'built-in', v: 'ask' }, ...agents.map(a => ({ label: a.ref.name, description: 'custom agent', v: a.ref.name }))], { placeHolder: 'Agent that runs this prompt' });
            if (!p) { return; }
            input.link = p.v;
        } else if (kind === 'instruction') {
            const g = await vscode.window.showInputBox({ prompt: 'applyTo glob', value: '**/*.al' });
            if (g === undefined) { return; }
            input.applyTo = g.trim() || '**';
        }
        const dest = absOf(resolveDest(scaffoldPath(kind, input.name), state.project.sync));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, scaffold(input), 'utf8');
        await vscode.window.showTextDocument(vscode.Uri.file(dest));
        await state.refresh(false, true);
    });

    // ------------------------------------------------------------ publishing

    const pickTarget = async (placeHolder: string, preferUrl?: string): Promise<TemplateSourceSpec | undefined> => {
        const list = state.sources.length ? state.sources : settingsSources().map(s => ({ ...s } as SourceInfo));
        const items: (vscode.QuickPickItem & { s?: TemplateSourceSpec; create?: boolean })[] = list.map(s => ({
            label: (sameUrl(s.url, preferUrl) ? '$(star-full) ' : '') + (s.name ?? s.url),
            description: `${s.ref}${sameUrl(s.url, UPSTREAM_URL) ? ' · upstream BC ALM template' : ''}`, detail: s.url, s
        }));
        items.sort((a, b) => Number(sameUrl(b.s?.url, preferUrl)) - Number(sameUrl(a.s?.url, preferUrl)));
        items.push({ label: '$(repo-create) Create my own template repository…', create: true });
        const p = await vscode.window.showQuickPick(items, { placeHolder });
        if (!p) { return undefined; }
        if (p.create) {
            await vscode.commands.executeCommand('bcAlm.createTemplateRepo');
            return undefined;
        }
        return p.s;
    };

    const previewPlan = async (plan: PublishPlan): Promise<void> => {
        log.appendLine(`\n=== Publish ${plan.componentId} → ${plan.repo.label} (${plan.repo.spec.ref} @ ${plan.baseSha.slice(0, 7)}) ===`);
        for (const f of plan.files) {
            log.appendLine(`  ${f.existing === undefined ? 'add' : 'update'} ${f.srcRel}${f.changes.length ? `\n    - ${f.changes.join('\n    - ')}` : ''}`);
        }
        const changed = plan.files.filter(f => f.existing !== f.text);
        for (const f of changed.slice(0, 5)) {
            const name = path.posix.basename(f.srcRel);
            await vscode.commands.executeCommand('vscode.diff', content.uri(f.existing ?? '', name, 'template'), content.uri(f.text, name, 'publish'),
                `${f.srcRel}: ${plan.repo.label} ↔ to publish`, { preview: false });
        }
        if (changed.length > 5) { log.appendLine(`  (${changed.length - 5} more file(s) not opened)`); }
        log.show(true);
    };

    const publish = async (arg: unknown, upstream: boolean) => {
        if (!state.root || !state.project) { throw new Error('Open a BC ALM project first.'); }
        const c = needComponent(arg);
        const local = c.files.filter(f => fs.existsSync(absOf(f.destRel)));
        if (!local.length) { throw new Error(`"${c.ref.name}" has no local files to publish.`); }
        let target: TemplateSourceSpec | undefined;
        if (upstream) {
            const src = c.source ?? state.catalogs[0]?.repo.spec.url ?? UPSTREAM_URL;
            target = state.sources.find(s => sameUrl(s.url, src)) ?? { url: src, ref: 'main' };
            const ok = await vscode.window.showInformationMessage(`Open a pull request with your version of "${c.ref.name}" against ${target.name ?? target.url}? Your project values are mapped back to the template's placeholders first; you will see a preview.`, { modal: true }, 'Continue');
            if (!ok) { return; }
        } else {
            target = await pickTarget(`Save "${c.ref.name}" to which template?`, settingsSources().find(s => !sameUrl(s.url, UPSTREAM_URL))?.url);
        }
        if (!target) { return; }
        const repo = state.repo(target);
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Reading ${repo.label}…` }, () => repo.ensure(0));
        const sha = await repo.resolve();
        const tFiles = new Set(await repo.listFiles(sha));
        const exists = local.some(f => tFiles.has(srcFromDest(f.destRel, state.project!.sync)));
        type ModePick = vscode.QuickPickItem & { mode: 'overwrite' | 'saveAs' };
        const modes: ModePick[] = [];
        if (exists) { modes.push({ label: `Overwrite "${c.ref.name}" in the template`, detail: 'Everyone using this template gets your version as an update.', mode: 'overwrite' }); }
        else { modes.push({ label: `Add "${c.ref.name}" to the template`, detail: 'New component in the template.', mode: 'overwrite' }); }
        if (['agent', 'skill', 'prompt', 'instruction'].includes(c.ref.kind)) {
            modes.push({ label: 'Save as a new component…', detail: 'Keep the template version and add yours next to it under a new name.', mode: 'saveAs' });
        }
        const mode = modes.length === 1 ? modes[0] : await vscode.window.showQuickPick(modes, { placeHolder: 'How should it be saved?' });
        if (!mode) { return; }
        let newName: string | undefined;
        if (mode.mode === 'saveAs') {
            const kind = c.ref.kind as ScaffoldInput['kind'];
            newName = await vscode.window.showInputBox({ prompt: 'New component name', value: `${c.ref.name}-custom`, validateInput: v => isValidComponentName(kind, v.trim()) });
            if (!newName) { return; }
            newName = newName.trim();
        }
        const plan = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Preparing…' },
            () => preparePublish({ root: state.root!, project: state.project!, componentId: c.ref.id, destFiles: local.map(f => f.destRel), repo, mode: mode.mode, newName }));
        if (plan.files.every(f => f.existing === f.text)) {
            vscode.window.showInformationMessage(`${repo.label} already has this version of "${c.ref.name}".`);
            return;
        }
        await previewPlan(plan);

        let delivery: DeliveryMode = 'pullRequest';
        if (!upstream) {
            const d = await vscode.window.showQuickPick([
                { label: 'Open a pull request', detail: 'Recommended for shared templates - teammates review first.', d: 'pullRequest' as DeliveryMode },
                { label: `Commit directly to ${repo.spec.ref}`, detail: 'Needs push access. Projects see it on their next update check.', d: 'direct' as DeliveryMode }
            ], { placeHolder: 'Review the diff tabs, then choose how to deliver' });
            if (!d) { return; }
            delivery = d.d;
        }
        const message = await vscode.window.showInputBox({
            prompt: 'Commit / pull request title',
            value: `feat(${c.ref.kind}): ${mode.mode === 'saveAs' ? `add ${newName}` : `${exists ? 'update' : 'add'} ${c.ref.name}`}`
        });
        if (!message) { return; }
        const projectName = state.project.values.appName || path.basename(state.root);
        const body = `Published from **${projectName}** with the BC ALM VS Code extension.\n\n` +
            plan.files.map(f => `- \`${f.srcRel}\`${f.changes.length ? ` - ${f.changes.join('; ')}` : ''}`).join('\n');
        const res = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Publishing to ${repo.label}…` },
            () => executePublish(plan, { workRoot: path.join(state.storageRoot, 'work'), delivery, message, body, log: l => log.appendLine(l) }));
        log.appendLine(`Published ${res.commit.slice(0, 7)} → ${res.pushedTo} (${res.branch})${res.prUrl ? ` PR: ${res.prUrl}` : ''}`);
        await state.refresh(true);
        if (delivery === 'direct' && mode.mode === 'overwrite' && state.lock?.sources.some(s => sameUrl(s.url, repo.spec.url))) {
            const ops = state.ops();
            const cur = state.component(c.ref.id);
            cur?.files.filter(f => f.status === 'current' || f.status === 'modified' || f.status === 'conflict').forEach(f => ops.keepMine(f));
            ops.save();
            await state.refresh(false, true);
        }
        const url = res.prUrl ?? res.compareUrl;
        const a = await vscode.window.showInformationMessage(
            res.prUrl ? `Pull request created${res.forked ? ' from your fork' : ''}.` : delivery === 'direct' ? `Committed to ${repo.label} (${res.commit.slice(0, 7)}).` : `Pushed branch ${res.branch}.`,
            ...(url ? ['Open'] : []));
        if (a && url) { await vscode.env.openExternal(vscode.Uri.parse(url)); }
    };

    reg('bcAlm.saveToTemplate', (arg: unknown) => publish(arg, false));
    reg('bcAlm.contributeUpstream', (arg: unknown) => publish(arg, true));

    reg('bcAlm.createTemplateRepo', async () => {
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Checking GitHub CLI…' }, () => requireGh());
        const ghSources = [...settingsSources(), ...state.sources].filter((s, i, all) => githubSlug(s.url) && all.findIndex(x => sameUrl(x.url, s.url)) === i);
        if (!ghSources.some(s => sameUrl(s.url, UPSTREAM_URL))) { ghSources.push({ name: 'BC ALM Template (upstream)', url: UPSTREAM_URL, ref: 'main' }); }
        let base: TemplateSourceSpec = ghSources.find(s => sameUrl(s.url, UPSTREAM_URL))!;
        if (ghSources.length > 1) {
            const b = await vscode.window.showQuickPick(ghSources.map(s => ({ label: s.name ?? s.url, description: s.ref, detail: s.url, s })), { placeHolder: 'Start the new template from which template?' });
            if (!b) { return; }
            base = b.s;
        }
        const up = githubSlug(base.url)!;
        const { login, orgs, info } = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Reading your GitHub accounts…' }, async () => {
            const o = await ghOwners();
            return { ...o, info: await ghRepoInfo(up) };
        });
        if (!info) { throw new Error(`Cannot read ${up.owner}/${up.repo} with the GitHub CLI. Check the URL and your access ("gh auth status").`); }
        const ownerPick = await vscode.window.showQuickPick([
            { label: `$(account) ${login}`, description: 'your account', owner: login },
            ...orgs.map(o => ({ label: `$(organization) ${o}`, description: 'organization', owner: o }))
        ], { placeHolder: 'Who should own the new template repository?' });
        if (!ownerPick) { return; }
        const owner = ownerPick.owner;
        const name = (await vscode.window.showInputBox({
            prompt: `Repository name (created as ${owner}/<name>)`, value: owner.toLowerCase() === info.owner.toLowerCase() ? `${up.repo}-team` : up.repo,
            validateInput: v => /^[\w.-]+$/.test(v.trim()) ? undefined : 'Letters, digits, ".", "-" and "_" only'
        }))?.trim();
        if (!name) { return; }

        const blocker = forkBlocker(info.fullName, info.owner, owner, await findFork(up, owner));
        type HowPick = vscode.QuickPickItem & { v: CreateTemplateHow | 'existing' };
        const hows: HowPick[] = [];
        if (!blocker) {
            hows.push({ label: 'Fork', detail: 'GitHub fork - pull upstream improvements with one click, contribute back via pull request.', v: 'fork' });
        } else if (blocker.kind === 'existing') {
            hows.push({ label: `Use my existing fork ${blocker.fork}`, detail: 'Add the fork you already have as a template source.', v: 'existing' });
        }
        hows.push({
            label: 'Duplicate (keeps upstream link)', v: 'duplicate',
            detail: `New repository with the full history of ${info.fullName}; "Sync from Upstream" merges later improvements.${blocker?.kind === 'owner' ? ' Recommended - you own the upstream, so it cannot be forked.' : ''}`
        });
        hows.push({ label: 'Independent copy', detail: 'Fresh copy with no upstream link (GitHub "Use this template").', v: 'template' });
        const how = await vscode.window.showQuickPick(hows, { placeHolder: blocker ? `${blocker.message.split(';')[0]}. How should the template be created?` : 'How should the template be created?' });
        if (!how) { return; }

        let created: { url: string; upstream?: string };
        if (how.v === 'existing' && blocker?.kind === 'existing') {
            created = { url: `https://github.com/${blocker.fork}`, upstream: base.url };
        } else {
            let visibility: 'private' | 'public' | 'internal' = 'private';
            if (how.v !== 'fork') {
                const v = await vscode.window.showQuickPick(['private', 'internal', 'public'], { placeHolder: 'Visibility' });
                if (!v) { return; }
                visibility = v as typeof visibility;
            }
            log.appendLine(`\n=== Create template ${owner}/${name} (${how.v}) from ${info.fullName} ===`);
            created = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Creating ${owner}/${name}…` },
                () => createOwnTemplate({ upstreamUrl: base.url, upstreamRef: base.ref, owner, name, how: how.v as CreateTemplateHow, visibility, workRoot: path.join(state.storageRoot, 'work'), log: l => log.appendLine(l) }));
        }
        const url = created.url;
        const gitUrl = url.endsWith('.git') ? url : `${url}.git`;
        const list = settingsSources();
        if (!list.some(s => sameUrl(s.url, gitUrl))) {
            const asDefault = await vscode.window.showQuickPick(['Yes - use it for new projects by default', 'No - just add it to the list'], { placeHolder: `Created ${url}. Make it the default template?` });
            const entry: TemplateSourceSpec = { name: `${owner}/${name}`, url: gitUrl, ref: base.ref, ...(created.upstream ? { upstream: created.upstream } : {}) };
            await saveSettingsSources(asDefault?.startsWith('Yes') ? [entry, ...list] : [...list, entry]);
        }
        await state.refresh(false, true);
        const next = state.root ? await vscode.window.showInformationMessage(`Template ${url} added to BC ALM sources.`, 'Use in This Project', 'Open on GitHub') : await vscode.window.showInformationMessage(`Template ${url} added.`, 'Open on GitHub');
        if (next === 'Open on GitHub') { await vscode.env.openExternal(vscode.Uri.parse(url)); }
        if (next === 'Use in This Project') {
            const info2 = state.sources.find(s => sameUrl(s.url, gitUrl));
            if (info2) { await vscode.commands.executeCommand('bcAlm.useSourceInProject', info2); }
        }
    });

    // ------------------------------------------------------------ sources

    reg('bcAlm.addTemplateSource', async () => {
        const kind = await vscode.window.showQuickPick([{ label: 'Git URL', v: 'url' }, { label: 'Local folder (git repository)', v: 'dir' }], { placeHolder: 'Where is the template?' });
        if (!kind) { return; }
        let url: string | undefined;
        if (kind.v === 'dir') {
            url = (await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: 'Use as template source' }))?.[0]?.fsPath;
        } else {
            url = await vscode.window.showInputBox({ prompt: 'Git URL of the template repository', placeHolder: 'https://github.com/my-org/bc-alm-template.git', validateInput: v => /^(https?:\/\/|git@|ssh:\/\/|file:\/\/)/.test(v.trim()) ? undefined : 'Enter an https/ssh git URL' });
            url = url?.trim();
        }
        if (!url) { return; }
        if (settingsSources().some(s => sameUrl(s.url, url))) { vscode.window.showInformationMessage('That source is already configured.'); return; }
        const ref = await vscode.window.showInputBox({ prompt: 'Branch or tag to follow', value: 'main' });
        if (!ref) { return; }
        const slug = githubSlug(url);
        const name = await vscode.window.showInputBox({ prompt: 'Display name', value: slug ? `${slug.owner}/${slug.repo}` : isLocalPath(url) ? path.basename(url) : url });
        if (name === undefined) { return; }
        const spec = { name: name || undefined, url, ref: ref.trim() };
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Checking ${url}…` }, async () => {
            const repo = state.repo(spec);
            await repo.ensure(0);
            const sha = await repo.resolve();
            if (!(await repo.readConfig(sha))) { throw new Error(`${url} (${ref}) has no template.config.json - it is not a BC ALM template.`); }
        });
        await saveSettingsSources([...settingsSources(), spec]);
        await state.refresh(false, true);
        if (state.root) {
            const a = await vscode.window.showInformationMessage(`Added ${name || url}. Pull components from it in this project too?`, 'Use in This Project');
            if (a) { const info = state.sources.find(s => sameUrl(s.url, url)); if (info) { await vscode.commands.executeCommand('bcAlm.useSourceInProject', info); } }
        }
    });

    reg('bcAlm.removeTemplateSource', async (s: SourceInfo) => {
        if (!s) { return; }
        const tracked = Object.values(readLock(state.root ?? '')?.files ?? {}).filter(e => sameUrl(e.source, s.url)).length;
        const a = await vscode.window.showWarningMessage(
            `Remove "${s.name ?? s.url}" from your template sources?${s.inProject ? `\n\nThis project tracks ${tracked} file(s) from it; they stay as they are but no longer receive updates.` : ''}`, { modal: true }, 'Remove');
        if (a !== 'Remove') { return; }
        await saveSettingsSources(settingsSources().filter(x => !sameUrl(x.url, s.url)));
        if (s.inProject && state.root) {
            const lock = readLock(state.root);
            if (lock) {
                lock.sources = lock.sources.filter(x => !sameUrl(x.url, s.url));
                for (const [k, e] of Object.entries(lock.files)) { if (sameUrl(e.source, s.url)) { delete lock.files[k]; } }
                writeLock(state.root, lock);
            }
        }
        await done();
    });

    reg('bcAlm.useSourceInProject', async (s: SourceInfo) => {
        if (!s || !state.root) { return; }
        const lock = readLock(state.root) ?? emptyLock();
        if (!lock.sources.length) { state.projectSources().forEach((p, i) => ensureSource(lock, p, i === 0)); }
        ensureSource(lock, { name: s.name, url: s.url, ref: s.ref });
        writeLock(state.root, lock);
        await done(`"${s.name ?? s.url}" is now a source for this project. Its extra components appear under "Available to install"; use "Track Component from Another Template Source" to switch existing ones.`);
    });

    reg('bcAlm.setPrimarySource', async (s: SourceInfo) => {
        if (!s || !state.root) { return; }
        const lock = readLock(state.root) ?? emptyLock();
        if (!lock.sources.length) { state.projectSources().forEach((p, i) => ensureSource(lock, p, i === 0)); }
        ensureSource(lock, { name: s.name, url: s.url, ref: s.ref }, true);
        writeLock(state.root, lock);
        await done(`"${s.name ?? s.url}" is now the primary source (new components and the template-sync workflow use it).`);
    });

    reg('bcAlm.syncTemplateFromUpstream', async (s: SourceInfo) => {
        if (!s) { return; }
        const label = s.name ?? s.url;
        const slug = githubSlug(s.url);
        const info = slug && await commandExists('gh') ? await ghRepoInfo(slug) : undefined;
        let upstream = s.upstream ?? (info?.parent ? `https://github.com/${info.parent}.git` : undefined);
        if (info?.isFork) {
            try {
                const out = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Syncing ${label} with its upstream…` }, () => syncForkFromUpstream(s.url, s.ref));
                log.appendLine(out);
                await state.refresh(true);
                vscode.window.showInformationMessage(`${label} is up to date with its upstream. ${out.split('\n')[0]}`);
                return;
            } catch (e) {
                log.appendLine(`gh repo sync failed (${(e as Error).message.split('\n')[0]}) - merging with git instead.`);
            }
        }
        if (!upstream) {
            upstream = (await vscode.window.showInputBox({
                prompt: `Which template was ${label} created from? (git URL)`, value: UPSTREAM_URL,
                validateInput: v => /^(https?:\/\/|git@|ssh:\/\/|file:\/\/)/.test(v.trim()) || isLocalPath(v.trim()) ? undefined : 'Enter a git URL'
            }))?.trim();
            if (!upstream) { return; }
            const list = settingsSources();
            if (list.some(x => sameUrl(x.url, s.url))) {
                await saveSettingsSources(list.map(x => sameUrl(x.url, s.url) ? { ...x, upstream } : x));
            }
        }
        const up = upstream;
        log.appendLine(`\n=== Sync ${label} (${s.ref}) from ${up} ===`);
        const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Syncing ${label} with ${up}…` },
            () => syncFromUpstream({ url: s.url, ref: s.ref, upstream: up, workRoot: path.join(state.storageRoot, 'work'), log: l => log.appendLine(l) }));
        log.appendLine(r.message + (r.prUrl ? ` PR: ${r.prUrl}` : ''));
        await state.refresh(true);
        const link = r.prUrl ?? r.compareUrl;
        const a = await vscode.window.showInformationMessage(`${label}: ${r.message}`, ...(link ? ['Open Pull Request'] : []));
        if (a && link) { await vscode.env.openExternal(vscode.Uri.parse(link)); }
    });

    // ------------------------------------------------------------ guidance

    reg('bcAlm.validate', async () => {
        const n = diagnostics.validateAll();
        await vscode.commands.executeCommand('bcAlm.guidance.focus');
        vscode.window.showInformationMessage(n ? `BC ALM: ${n} finding(s) in Copilot customizations - see Problems or the Guidance view.` : 'BC ALM: no findings - customizations follow the current guidance.');
    });

    reg('bcAlm.reviewWithCopilot', async (arg: unknown) => {
        let uri = arg instanceof vscode.Uri ? arg : undefined;
        if (!uri) {
            const c = componentFrom(arg);
            const f = c?.files.find(x => fs.existsSync(absOf(x.destRel)) && /(\.agent\.md|\.prompt\.md|\.instructions\.md|SKILL\.md)$/.test(x.destRel)) ?? c?.files.find(x => fs.existsSync(absOf(x.destRel)));
            if (f) { uri = vscode.Uri.file(absOf(f.destRel)); }
        }
        uri ??= vscode.window.activeTextEditor?.document.uri;
        if (!uri) { throw new Error('Open an agent, skill, prompt or instruction file first.'); }
        const rel = vscode.workspace.asRelativePath(uri, false);
        const practices = vscode.Uri.joinPath(ext.extensionUri, 'guidance', 'best-practices.md');
        const query = `Review #file:${rel} as a GitHub Copilot customization. Check it against the current VS Code and GitHub docs for custom agents, agent skills, prompt files and custom instructions ` +
            `(frontmatter keys, description quality and "Use when" triggers, tool names, handoffs, size limits, progressive disclosure, links) and against these team practices: ${practices.fsPath}. ` +
            'List concrete issues with suggested edits; do not change files until I confirm.';
        try {
            await vscode.commands.executeCommand('workbench.action.chat.open', { query, isPartialQuery: false });
        } catch {
            await vscode.env.clipboard.writeText(query);
            vscode.window.showInformationMessage('Copilot Chat is not available. The review prompt was copied to the clipboard.');
        }
    });

    reg('bcAlm.openBestPractices', async () => {
        const uri = vscode.Uri.joinPath(ext.extensionUri, 'guidance', 'best-practices.md');
        await vscode.commands.executeCommand('markdown.showPreview', uri);
    });

    reg('bcAlm.refreshGuidance', () => guidance.loadNews());
    reg('bcAlm.openUrl', (url: string) => url && vscode.env.openExternal(vscode.Uri.parse(url)));
    reg('bcAlm.openFinding', async (f: Finding) => {
        if (!state.root && !vscode.workspace.workspaceFolders?.length) { return; }
        const root = state.root ?? vscode.workspace.workspaceFolders![0].uri.fsPath;
        const doc = await vscode.window.showTextDocument(vscode.Uri.file(path.join(root, ...f.file.split('/'))));
        const pos = new vscode.Position(f.line, 0);
        doc.selection = new vscode.Selection(pos, pos);
        doc.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    });
}
