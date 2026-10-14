import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { TEMPLATE_TOGGLE_KINDS, templateIdFromUrl, TemplateManifest } from '../core/config';
import { DependencyGraph } from '../core/deps';
import { run } from '../core/exec';
import { ghOwners, requireGh } from '../core/github';
import { emptyLock, readLock, writeLock } from '../core/lock';
import { manifestFromInput, placeholderValues, pushNewTemplate, scaffoldTemplate, seedFromProject } from '../core/newTemplate';
import { KIND_LABELS } from '../core/paths';
import { githubSlug, isLocalPath } from '../core/publish';
import { ComponentState, STATUS_LABEL } from '../core/status';
import { TemplateSourceSpec } from '../core/templateRepo';
import { safeRemove, sameSource, sameUrl, sourceKey } from '../core/util';
import { ProjectState, saveSettingsSources, settingsSources, SourceInfo, TemplateGroup } from './projectState';
import { ComponentsNode } from './trees';

export interface TemplateCommandContext {
    state: ProjectState;
    log: vscode.OutputChannel;
    reg: (id: string, fn: (...args: any[]) => unknown) => void;
    graph: () => DependencyGraph;
    done: (msg?: string) => Promise<void>;
}

const ICONS = ['rocket', 'arrow-up', 'tools', 'beaker', 'book', 'package', 'shield', 'zap', 'organization', 'symbol-namespace'];

export function registerTemplateCommands(cx: TemplateCommandContext): void {
    const { state, log, reg, graph, done } = cx;
    const workRoot = () => path.join(state.storageRoot, 'work');

    const needProject = () => {
        if (!state.root || !state.project) { throw new Error('Open a BC ALM project first.'); }
    };

    const isSource = (a: unknown): a is SourceInfo => !!a && typeof a === 'object' && 'url' in a && 'inProject' in a;
    const isNode = (a: unknown): a is ComponentsNode => !!a && typeof a === 'object' && 'type' in a;

    /** Resolve a template from a template node, a source, a component node, or ask. */
    const groupFrom = async (arg: unknown, placeHolder: string, filter: (g: TemplateGroup) => boolean = () => true): Promise<TemplateGroup | undefined> => {
        needProject();
        let id: string | undefined;
        if (isNode(arg) && arg.type === 'template') { id = arg.group.id; }
        else if (isNode(arg) && (arg.type === 'component' || arg.type === 'file')) { id = arg.comp.templateId; }
        else if (isSource(arg)) { id = arg.manifest?.id ?? templateIdFromUrl(sourceKey(arg)); }
        if (id) {
            const g = state.templateGroup(id);
            if (!g) { throw new Error(`"${id}" is not a template of this project. Choose "Use in This Project" on its source first.`); }
            return g;
        }
        const groups = state.templateGroups().filter(filter);
        if (!groups.length) { vscode.window.showInformationMessage('No matching template in this project.'); return undefined; }
        if (groups.length === 1) { return groups[0]; }
        const p = await vscode.window.showQuickPick(groups.map(g => ({ label: `$(${g.manifest.icon ?? 'repo'}) ${g.manifest.name}`, description: describe(g), g })), { placeHolder });
        return p?.g;
    };

    const describe = (g: TemplateGroup) => [
        g.primary ? '★ primary' : '',
        g.disabled ? 'disabled' : '',
        `${g.components.filter(c => c.installed).length} installed`
    ].filter(Boolean).join(' · ');

    /** Installed, enabled components of other templates that reference components of `g`. */
    const externalUsers = (g: TemplateGroup): ComponentState[] => {
        const ids = new Set(g.components.filter(c => TEMPLATE_TOGGLE_KINDS.includes(c.ref.kind)).map(c => c.ref.id));
        const gr = graph();
        const users = new Map<string, ComponentState>();
        for (const id of ids) {
            for (const u of gr.dependents(id)) {
                const c = state.component(u);
                if (c && !ids.has(u) && c.installed && !c.disabled) { users.set(u, c); }
            }
        }
        return [...users.values()];
    };

    const disable = async (g: TemplateGroup, ask: boolean): Promise<number> => {
        const users = externalUsers(g);
        if (ask) {
            const warn = users.length ? `\n\nStill referenced by: ${users.map(u => `${u.ref.kind} ${u.ref.name}`).join(', ')}.` : '';
            const a = await vscode.window.showWarningMessage(
                `Disable template "${g.manifest.name}"? Its installed agents, skills, prompts and instructions move to .bc-alm/disabled/ so Copilot stops loading them, and syncs skip them. Docs, workflows and scripts stay.${warn}`,
                { modal: true }, 'Disable Template');
            if (a !== 'Disable Template') { return -1; }
        }
        return state.ops().disableTemplate(g.id, state.status?.components ?? []).length;
    };

    reg('bcAlm.disableTemplate', async (arg: unknown) => {
        const g = await groupFrom(arg, 'Disable which template?', x => !x.disabled);
        if (!g) { return; }
        if (g.disabled) { vscode.window.showInformationMessage(`"${g.manifest.name}" is already disabled.`); return; }
        const n = await disable(g, true);
        if (n >= 0) { await done(`Disabled template "${g.manifest.name}" (${n} component(s) stored). Recorded in template.config.json → sync.templates.disabled.`); }
    });

    reg('bcAlm.enableTemplate', async (arg: unknown) => {
        const g = await groupFrom(arg, 'Enable which template?', x => x.disabled);
        if (!g) { return; }
        if (!g.disabled) { vscode.window.showInformationMessage(`"${g.manifest.name}" is already enabled.`); return; }
        const n = state.ops().enableTemplate(g.id, state.status?.components ?? []).length;
        await done(`Enabled template "${g.manifest.name}"${n ? ` (${n} component(s) restored)` : ''}.`);
    });

    reg('bcAlm.activateOnlyTemplate', async (arg: unknown) => {
        const g = await groupFrom(arg, 'Keep which template active?');
        if (!g) { return; }
        const others = state.templateGroups().filter(x => x.id !== g.id && !x.disabled);
        if (!others.length && !g.disabled) { vscode.window.showInformationMessage(`"${g.manifest.name}" is already the only active template.`); return; }
        const a = await vscode.window.showWarningMessage(
            `Make "${g.manifest.name}" the only active template? ${others.length ? `This disables ${others.map(o => `"${o.manifest.name}"`).join(', ')}; their agents, skills, prompts and instructions move to .bc-alm/disabled/. ` : ''}Your own components (not from a template) stay active.`,
            { modal: true }, 'Activate Only This');
        if (a !== 'Activate Only This') { return; }
        let stored = 0;
        for (const o of others) { stored += await disable(o, false); await state.refresh(false, true); }
        if (g.disabled) { state.ops().enableTemplate(g.id, state.status?.components ?? []); }
        await done(`"${g.manifest.name}" is now the only active template${stored ? ` (${stored} component(s) of other templates stored)` : ''}.`);
    });

    reg('bcAlm.switchTemplates', async () => {
        needProject();
        const groups = state.templateGroups();
        if (groups.length < 2) {
            const a = await vscode.window.showInformationMessage('This project uses one template. Add another under Template Sources and choose "Use in This Project" to switch between them.', 'Add Template Source');
            if (a) { await vscode.commands.executeCommand('bcAlm.addTemplateSource'); }
            return;
        }
        const picks = await vscode.window.showQuickPick(groups.map(g => ({
            label: `$(${g.manifest.icon ?? 'repo'}) ${g.manifest.name}`, description: describe(g), detail: g.manifest.description, picked: !g.disabled, g
        })), { canPickMany: true, placeHolder: 'Checked templates are active in this project' });
        if (!picks) { return; }
        const on = new Set(picks.map(p => p.g.id));
        const toDisable = groups.filter(g => !g.disabled && !on.has(g.id));
        const toEnable = groups.filter(g => g.disabled && on.has(g.id));
        if (!toDisable.length && !toEnable.length) { return; }
        const users = toDisable.flatMap(externalUsers).filter(u => !toDisable.some(d => d.id === u.templateId));
        if (users.length) {
            const a = await vscode.window.showWarningMessage(`Still referenced by active components: ${users.map(u => `${u.ref.kind} ${u.ref.name}`).join(', ')}. Continue?`, { modal: true }, 'Continue');
            if (a !== 'Continue') { return; }
        }
        for (const g of toDisable) { await disable(g, false); await state.refresh(false, true); }
        for (const g of toEnable) { state.ops().enableTemplate(g.id, state.status?.components ?? []); await state.refresh(false, true); }
        await done(`Active templates: ${groups.filter(g => on.has(g.id)).map(g => g.manifest.name).join(', ') || 'none'}.`);
    });

    reg('bcAlm.groupByTemplate', () => vscode.workspace.getConfiguration('bcAlm').update('components.groupBy', 'template', vscode.ConfigurationTarget.Global));
    reg('bcAlm.groupByKind', () => vscode.workspace.getConfiguration('bcAlm').update('components.groupBy', 'kind', vscode.ConfigurationTarget.Global));

    // ------------------------------------------------------------ choose components per source

    reg('bcAlm.manageComponents', async (arg: unknown) => {
        needProject();
        let src: SourceInfo | undefined = isSource(arg) ? arg : undefined;
        if (!src) {
            const g = await groupFrom(arg, 'Choose components of which template?', x => !!x.source);
            src = g?.source;
            if (!g) { return; }
            if (!src) { throw new Error(`"${g.manifest.name}" has no loaded template source.`); }
        }
        const s = src;
        const cat = state.catalogs.find(c => sameUrl(c.repo.key, sourceKey(s)));
        if (!cat) {
            if (!s.inProject) {
                const a = await vscode.window.showInformationMessage(`"${s.name ?? s.url}" is not used in this project yet.`, 'Use in This Project');
                if (a) { await vscode.commands.executeCommand('bcAlm.useSourceInProject', s); }
                return;
            }
            throw new Error(`"${s.name ?? s.url}" could not be loaded${s.error ? `: ${s.error}` : ''}.`);
        }
        const g = state.templateGroup(cat.manifest.id);
        if (g?.disabled) {
            const a = await vscode.window.showInformationMessage(`Template "${g.manifest.name}" is disabled in this project. Enable it first?`, 'Enable Template');
            if (a !== 'Enable Template') { return; }
            state.ops().enableTemplate(g.id, state.status?.components ?? []);
            await state.refresh(false, true);
        }
        const ids = [...new Set([...cat.files.values()].map(f => f.component).filter(r => r.kind !== 'file').map(r => r.id))];
        const comps = ids.map(id => state.component(id)).filter((c): c is ComponentState => !!c)
            .sort((a, b) => a.ref.kind.localeCompare(b.ref.kind) || a.ref.name.localeCompare(b.ref.name));
        const fromOther = (c: ComponentState) => c.installed && !!c.source && !sameUrl(c.source, sourceKey(s));
        const active = (c: ComponentState) => c.installed && !c.disabled;
        type Item = vscode.QuickPickItem & { c: ComponentState };
        const items: Item[] = comps.map(c => ({
            label: c.ref.name,
            description: [KIND_LABELS[c.ref.kind] ?? c.ref.kind, c.disabled ? 'disabled' : c.installed ? STATUS_LABEL[c.status] : c.newInTemplate ? 'new in template' : 'not installed',
                fromOther(c) ? `tracked from ${state.sources.find(x => sameUrl(sourceKey(x), c.source))?.name ?? c.source}` : ''].filter(Boolean).join(' · '),
            picked: active(c),
            c
        }));
        const picks = await vscode.window.showQuickPick(items, {
            canPickMany: true, matchOnDescription: true,
            title: `Components from ${s.name ?? cat.manifest.name}`,
            placeHolder: 'Checked components are installed. Uncheck to disable; unchecked components are remembered as "not selected".'
        });
        if (!picks) { return; }
        const chosen = new Set(picks.map(p => p.c.ref.id));
        let install = comps.filter(c => chosen.has(c.ref.id) && !active(c));
        const remove = comps.filter(c => !chosen.has(c.ref.id) && active(c) && !fromOther(c));

        const gr = graph();
        const deps = [...new Set(install.flatMap(c => gr.closure(c.ref.id)))].map(id => state.component(id))
            .filter((x): x is ComponentState => !!x && !active(x) && !install.includes(x));
        if (deps.length) {
            const a = await vscode.window.showInformationMessage(`The selection uses ${deps.map(d => `${d.ref.kind} ${d.ref.name}`).join(', ')}, which ${deps.length === 1 ? 'is' : 'are'} not installed.`, 'Install Them Too', 'Skip');
            if (!a) { return; }
            if (a === 'Install Them Too') { install = [...install, ...deps]; deps.forEach(d => chosen.add(d.ref.id)); }
        }
        if (remove.length) {
            const users = remove.flatMap(r => gr.dependents(r.ref.id)).map(id => state.component(id))
                .filter((x): x is ComponentState => !!x && active(x) && !remove.includes(x));
            const warn = users.length ? `\n\nStill referenced by: ${[...new Set(users.map(u => `${u.ref.kind} ${u.ref.name}`))].join(', ')}.` : '';
            const a = await vscode.window.showWarningMessage(`Disable ${remove.map(r => r.ref.name).join(', ')}? Their files move to .bc-alm/disabled/.${warn}`, { modal: true }, 'Apply');
            if (a !== 'Apply') { return; }
        }
        const ops = state.ops();
        let files = 0;
        for (const c of install) {
            if (c.disabled && !c.templateDisabled && c.installed) { ops.enable(c); continue; }
            files += ops.installFrom(c, cat);
        }
        for (const c of remove) { ops.disable(c); }
        ops.setExclude(sourceKey(s), ids.filter(id => !chosen.has(id)).sort());
        ops.save();
        const parts = [install.length ? `installed ${install.length}${files ? ` (${files} files)` : ''}` : '', remove.length ? `disabled ${remove.length}` : ''].filter(Boolean);
        await done(`${s.name ?? cat.manifest.name}: ${parts.join(', ') || 'selection saved'}.`);
    });

    // ------------------------------------------------------------ create a new template

    reg('bcAlm.createNewTemplate', async () => {
        type Start = vscode.QuickPickItem & { v: 'blank' | 'seed' | 'copy' };
        const starts: Start[] = [
            { label: '$(new-file) Blank template', detail: 'Empty agents/skills/prompts/instructions folders, a README and template.config.json.', v: 'blank' }
        ];
        const ownable = (state.status?.components ?? []).filter(c => c.installed && !c.disabled && TEMPLATE_TOGGLE_KINDS.includes(c.ref.kind));
        if (state.root && ownable.length) {
            starts.push({ label: '$(checklist) From components in this project', detail: 'Pick agents, skills, prompts and instructions you have here; project values are turned back into placeholders.', v: 'seed' });
        }
        starts.push({ label: '$(repo-forked) Copy an existing template', detail: 'Duplicate a template repository (e.g. BC ALM) under a new name and identity.', v: 'copy' });
        const start = await vscode.window.showQuickPick(starts, { placeHolder: 'How should the new template start?' });
        if (!start) { return; }

        const name = (await vscode.window.showInputBox({ prompt: 'Template name (shown in the Components view)', placeHolder: 'BC Upgrade', validateInput: v => v.trim() ? undefined : 'Enter a name' }))?.trim();
        if (!name) { return; }
        const manifest0 = manifestFromInput(name);
        const taken = state.sources.find(x => x.manifest?.id === manifest0.id);
        if (taken) {
            const a = await vscode.window.showWarningMessage(`Template id "${manifest0.id}" is already used by ${taken.name ?? taken.url}. Projects could not tell them apart.`, 'Use Anyway');
            if (!a) { return; }
        }
        const description = await vscode.window.showInputBox({ prompt: 'Short description (optional)', placeHolder: 'Agents and skills for Business Central upgrade projects' });
        if (description === undefined) { return; }
        const icon = await vscode.window.showQuickPick(ICONS.map(i => ({ label: `$(${i}) ${i}`, i })), { placeHolder: 'Icon' });
        if (!icon) { return; }
        const manifest: TemplateManifest = manifestFromInput(name, description, icon.i);

        if (start.v === 'copy') {
            await vscode.commands.executeCommand('bcAlm.createTemplateRepo', { identity: manifest });
            return;
        }

        let picked: ComponentState[] = [];
        if (start.v === 'seed') {
            const sel = await vscode.window.showQuickPick(ownable.map(c => ({ label: c.ref.name, description: KIND_LABELS[c.ref.kind] ?? c.ref.kind, c })), { canPickMany: true, placeHolder: 'Components to put into the new template' });
            if (!sel?.length) { return; }
            picked = sel.map(x => x.c);
            const gr = graph();
            const deps = [...new Set(picked.flatMap(c => gr.closure(c.ref.id)))].map(id => state.component(id))
                .filter((x): x is ComponentState => !!x && x.installed && !picked.includes(x) && TEMPLATE_TOGGLE_KINDS.includes(x.ref.kind));
            if (deps.length) {
                const a = await vscode.window.showInformationMessage(`The selection uses ${deps.map(d => `${d.ref.kind} ${d.ref.name}`).join(', ')}.`, 'Include Them', 'Skip');
                if (!a) { return; }
                if (a === 'Include Them') { picked = [...picked, ...deps]; }
            }
        }

        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Checking GitHub CLI…' }, () => requireGh());
        const { login, orgs } = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Reading your GitHub accounts…' }, () => ghOwners());
        const ownerPick = await vscode.window.showQuickPick([
            { label: `$(account) ${login}`, description: 'your account', owner: login },
            ...orgs.map(o => ({ label: `$(organization) ${o}`, description: 'organization', owner: o }))
        ], { placeHolder: 'Who should own the new template repository?' });
        if (!ownerPick) { return; }
        const owner = ownerPick.owner;
        const repo = (await vscode.window.showInputBox({
            prompt: `Repository name (created as ${owner}/<name>)`, value: `${manifest.id}-template`,
            validateInput: v => /^[\w.-]+$/.test(v.trim()) ? undefined : 'Letters, digits, ".", "-" and "_" only'
        }))?.trim();
        if (!repo) { return; }
        const visibility = await vscode.window.showQuickPick(['private', 'internal', 'public'], { placeHolder: 'Visibility' });
        if (!visibility) { return; }

        const full = `${owner}/${repo}`;
        const url = `https://github.com/${full}`;
        const values = placeholderValues(state.project, full);
        const seeded = picked.length && state.root && state.project
            ? seedFromProject(state.root, state.project, picked.flatMap(c => c.files.map(f => f.destRel)), values)
            : [];
        log.appendLine(`\n=== Create new template ${full} ("${manifest.name}", id ${manifest.id}) ===`);
        seeded.forEach(f => log.appendLine(`  ${f.srcRel}${f.changes.length ? `\n    - ${f.changes.join('\n    - ')}` : ''}`));
        fs.mkdirSync(workRoot(), { recursive: true });
        const dir = fs.mkdtempSync(path.join(workRoot(), 'new-'));
        try {
            await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Creating ${full}…` }, async () => {
                scaffoldTemplate(dir, manifest, values, seeded);
                log.appendLine(`gh repo create ${full} --${visibility}`);
                await run('gh', ['repo', 'create', full, `--${visibility}`, '--description', manifest.description ?? `Copilot template: ${manifest.name}`], { cwd: os.tmpdir() });
                await pushNewTemplate(dir, `${url}.git`, 'main', l => log.appendLine(l));
            });
        } finally {
            safeRemove(dir, l => log.appendLine(l));
        }
        await addAndOffer({ name: manifest.name, url: `${url}.git`, ref: 'main' }, url, seeded.length ? `with ${picked.length} component(s)` : '');
    });

    /** Add a created template to the settings and offer to use it in this project. */
    const addAndOffer = async (entry: TemplateSourceSpec, webUrl: string, note: string) => {
        const list = settingsSources();
        if (!list.some(x => sameSource(x, entry))) { await saveSettingsSources([...list, entry]); }
        await state.refresh(false, true);
        const actions = state.root ? ['Use in This Project', 'Open on GitHub'] : ['Open on GitHub'];
        const a = await vscode.window.showInformationMessage(`Created template "${entry.name}" ${note ? `${note} ` : ''}at ${webUrl} and added it to your template sources.`, ...actions);
        if (a === 'Open on GitHub') { await vscode.env.openExternal(vscode.Uri.parse(webUrl)); }
        if (a === 'Use in This Project') {
            const info = state.sources.find(x => sameSource(x, entry));
            if (info) { await vscode.commands.executeCommand('bcAlm.useSourceInProject', info); }
        }
    };

    // ------------------------------------------------------------ source actions

    reg('bcAlm.changeSourceRef', async (s: SourceInfo) => {
        if (!s) { return; }
        const ref = (await vscode.window.showInputBox({ prompt: `Branch or tag of ${s.name ?? s.url} to follow`, value: s.ref, validateInput: v => v.trim() ? undefined : 'Enter a branch or tag' }))?.trim();
        if (!ref || ref === s.ref) { return; }
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Checking ${ref}…` }, async () => {
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
        vscode.window.showInformationMessage(`${s.name ?? s.url} now follows ${ref}.${s.inProject ? ' Commit .bc-alm/template.lock.json so your team follows it too.' : ''}`);
    });

    reg('bcAlm.openSourceOnGitHub', async (s: SourceInfo) => {
        if (!s) { return; }
        const slug = githubSlug(s.url);
        if (slug) { await vscode.env.openExternal(vscode.Uri.parse(`https://github.com/${slug.owner}/${slug.repo}/tree/${encodeURIComponent(s.ref)}${s.path ? `/${s.path}` : ''}`)); return; }
        if (isLocalPath(s.url)) { await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(s.url.replace(/^file:\/\//, ''))); return; }
        await vscode.env.openExternal(vscode.Uri.parse(s.url));
    });

    // ------------------------------------------------------------ team sharing

    reg('bcAlm.shareTemplateSources', async () => {
        const list = settingsSources();
        const snippet = JSON.stringify({ 'bcAlm.templateSources': list }, null, 2);
        await vscode.env.clipboard.writeText(snippet);
        const a = await vscode.window.showInformationMessage(
            `Copied ${list.length} template source(s) as a settings snippet. Colleagues paste it into their user settings.json - or commit the project's .bc-alm/template.lock.json, which already lists the sources the project uses.`,
            'Show Snippet', 'Add to Workspace Settings');
        if (a === 'Show Snippet') {
            const doc = await vscode.workspace.openTextDocument({ language: 'jsonc', content: snippet });
            await vscode.window.showTextDocument(doc);
        }
        if (a === 'Add to Workspace Settings') {
            if (!vscode.workspace.workspaceFolders?.length) { throw new Error('Open a folder first.'); }
            await vscode.workspace.getConfiguration('bcAlm').update('templateSources', list, vscode.ConfigurationTarget.Workspace);
            vscode.window.showInformationMessage('Saved to .vscode/settings.json. Commit it so everyone opening this repository gets the same sources.');
        }
    });

    reg('bcAlm.addProjectSourcesToSettings', async () => {
        const missing = state.sources.filter(x => x.inProject && !x.inSettings);
        if (!missing.length) { vscode.window.showInformationMessage('All template sources of this project are already in your settings.'); return; }
        const picks = await vscode.window.showQuickPick(missing.map(x => ({ label: x.name ?? x.url, description: x.ref, detail: x.url, picked: true, x })), { canPickMany: true, placeHolder: 'Add these project sources to your template sources' });
        if (!picks?.length) { return; }
        await saveSettingsSources([...settingsSources(), ...picks.map(p => ({ name: p.x.name, url: p.x.url, ref: p.x.ref, ...(p.x.path ? { path: p.x.path } : {}), ...(p.x.upstream ? { upstream: p.x.upstream } : {}) }))]);
        await done(`Added ${picks.length} source(s) to your template sources.`);
    });
}
