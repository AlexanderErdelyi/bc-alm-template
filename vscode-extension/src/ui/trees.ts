import * as path from 'path';
import * as vscode from 'vscode';
import { fetchFeed, NewsItem } from '../core/changelog';
import { TEMPLATE_TOGGLE_KINDS } from '../core/config';
import { KIND_LABELS, KIND_ORDER } from '../core/paths';
import { ComponentState, FileState, FileStatus, STATUS_LABEL } from '../core/status';
import { CommitInfo } from '../core/templateRepo';
import { DOCS, Finding } from '../core/validator';
import { githubSlug } from '../core/publish';
import { sameUrl, sourceKey } from '../core/util';
import { ProjectState, SourceInfo, TemplateGroup } from './projectState';

const ICONS: Record<FileStatus, [string, string | undefined]> = {
    current: ['pass', 'testing.iconPassed'],
    update: ['arrow-circle-down', 'charts.blue'],
    new: ['diff-added', 'charts.blue'],
    modified: ['edit', 'charts.yellow'],
    conflict: ['warning', 'charts.red'],
    missing: ['circle-slash', 'charts.orange'],
    available: ['cloud-download', undefined],
    custom: ['person', 'charts.purple'],
    removed: ['archive', 'charts.orange'],
    disabled: ['circle-slash', 'disabledForeground']
};

export function statusIcon(s: FileStatus): vscode.ThemeIcon {
    const [id, color] = ICONS[s];
    return new vscode.ThemeIcon(id, color ? new vscode.ThemeColor(color) : undefined);
}

// ---------------------------------------------------------------- Components

export type ComponentsNode =
    | { type: 'template'; group: TemplateGroup }
    | { type: 'local'; components: ComponentState[] }
    | { type: 'group'; id: string; scope?: string; label: string; components: ComponentState[] }
    | { type: 'component'; comp: ComponentState }
    | { type: 'file'; comp: ComponentState; file: FileState }
    | { type: 'message'; label: string; icon?: string; command?: vscode.Command };

export type GroupMode = 'template' | 'kind';

/** Effective grouping: bcAlm.components.groupBy, where "auto" groups by template once the project uses more than one. */
export function groupMode(state: ProjectState): GroupMode {
    const setting = vscode.workspace.getConfiguration('bcAlm').get<string>('components.groupBy', 'auto');
    if (setting === 'template' || setting === 'kind') { return setting; }
    const groups = state.templateGroups().filter(g => g.components.length || g.source);
    return groups.length > 1 ? 'template' : 'kind';
}

/** True when the component's template is switched off in this project (it cannot be installed or enabled on its own). */
export function offByTemplate(state: ProjectState, c: ComponentState): boolean {
    return c.templateDisabled || (!!c.templateId && TEMPLATE_TOGGLE_KINDS.includes(c.ref.kind) && !!state.project?.sync.templates.disabled.includes(c.templateId));
}

export class ComponentsTree implements vscode.TreeDataProvider<ComponentsNode> {
    private readonly emitter = new vscode.EventEmitter<ComponentsNode | undefined>();
    readonly onDidChangeTreeData = this.emitter.event;

    constructor(private readonly state: ProjectState) {
        state.onDidChange(() => this.refresh());
    }

    refresh(): void {
        void vscode.commands.executeCommand('setContext', 'bcAlm.groupMode', groupMode(this.state));
        void vscode.commands.executeCommand('setContext', 'bcAlm.multiTemplate', this.state.templateGroups().length > 1);
        this.emitter.fire(undefined);
    }

    private sourceName(url?: string): string | undefined {
        if (!url) { return undefined; }
        return this.state.sources.find(s => sameUrl(sourceKey(s), url))?.name ?? url;
    }

    private templateName(id?: string): string | undefined {
        if (!id) { return undefined; }
        return this.state.sources.find(s => s.manifest?.id === id)?.manifest?.name ?? id;
    }

    /** Installed components by kind, then "Available" (and "Excluded" when a selection was made). */
    private kindGroups(comps: ComponentState[], scope?: string): ComponentsNode[] {
        const out: ComponentsNode[] = [];
        const installed = comps.filter(c => c.status !== 'available');
        for (const k of KIND_ORDER) {
            const list = installed.filter(c => c.ref.kind === k);
            if (list.length) { out.push({ type: 'group', id: k, scope, label: KIND_LABELS[k], components: list }); }
        }
        const available = comps.filter(c => c.status === 'available' && !c.excluded);
        if (available.length) {
            const fresh = available.filter(c => c.newInTemplate).length;
            out.push({ type: 'group', id: 'available', scope, label: fresh ? `Available to install (${fresh} new)` : 'Available to install', components: available });
        }
        const excluded = comps.filter(c => c.status === 'available' && c.excluded);
        if (excluded.length) { out.push({ type: 'group', id: 'excluded', scope, label: 'Not selected', components: excluded }); }
        return out;
    }

    getChildren(node?: ComponentsNode): ComponentsNode[] {
        const st = this.state.status;
        if (!node) {
            if (!this.state.root) { return []; }
            const out: ComponentsNode[] = [];
            if (this.state.loading && !st) { return [{ type: 'message', label: 'Loading template sources…', icon: 'loading~spin' }]; }
            if (this.state.lastError) { out.push({ type: 'message', label: this.state.lastError, icon: 'error' }); }
            if (!st) { return out; }
            if (st.noLock && this.state.catalogs.length) {
                out.push({ type: 'message', label: 'No template.lock.json yet - statuses are inferred. Click to record a baseline.', icon: 'info',
                    command: { command: 'bcAlm.adoptBaseline', title: 'Record baseline' } });
            }
            if (groupMode(this.state) === 'template') {
                const groups = this.state.templateGroups().sort((a, b) => Number(b.primary) - Number(a.primary) || a.manifest.name.localeCompare(b.manifest.name));
                for (const group of groups) { out.push({ type: 'template', group }); }
                const local = this.state.localComponents();
                if (local.length) { out.push({ type: 'local', components: local }); }
                return out;
            }
            return [...out, ...this.kindGroups(st.components)];
        }
        if (node.type === 'template') { return this.kindGroups(node.group.components, node.group.id); }
        if (node.type === 'local') { return this.kindGroups(node.components, '_local'); }
        if (node.type === 'group') { return node.components.map(comp => ({ type: 'component', comp })); }
        if (node.type === 'component' && node.comp.files.length > 1) {
            return node.comp.files.map(file => ({ type: 'file', comp: node.comp, file }));
        }
        return [];
    }

    private rollup(comps: ComponentState[]): string[] {
        const n = (s: FileStatus[]) => comps.filter(c => s.includes(c.status) && !c.keepLocal && !c.disabled).length;
        const parts: string[] = [];
        const up = n(['update', 'new', 'missing']);
        const cf = n(['conflict']);
        if (up) { parts.push(`${up} update${up > 1 ? 's' : ''}`); }
        if (cf) { parts.push(`${cf} conflict${cf > 1 ? 's' : ''}`); }
        return parts;
    }

    getTreeItem(node: ComponentsNode): vscode.TreeItem {
        switch (node.type) {
            case 'message': {
                const t = new vscode.TreeItem(node.label);
                t.iconPath = node.icon ? new vscode.ThemeIcon(node.icon) : undefined;
                t.command = node.command;
                t.tooltip = node.label;
                return t;
            }
            case 'template': {
                const g = node.group;
                const m = g.manifest;
                const t = new vscode.TreeItem(m.name, g.disabled ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded);
                const installed = g.components.filter(c => c.installed).length;
                const available = g.components.filter(c => c.status === 'available' && !c.excluded).length;
                const d: string[] = [];
                if (g.primary) { d.push('★ primary'); }
                if (g.disabled) { d.push('disabled'); }
                d.push(`${installed} installed`);
                if (available) { d.push(`${available} available`); }
                if (!g.disabled) { d.push(...this.rollup(g.components)); }
                if (g.source?.warning) { d.push('offline copy'); }
                t.description = d.join(' · ');
                t.iconPath = g.disabled ? new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('disabledForeground'))
                    : g.source?.error ? new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.orange'))
                    : new vscode.ThemeIcon(m.icon || 'package');
                const md = new vscode.MarkdownString(`**${m.name}**${m.version ? ` v${m.version}` : ''} \`${g.id}\``);
                if (m.description) { md.appendMarkdown(`\n\n${m.description}`); }
                if (g.source) { md.appendMarkdown(`\n\n${g.source.url} (${g.source.ref})`); }
                if (g.disabled) { md.appendMarkdown('\n\nSwitched off in this project: its agents, skills, prompts and instructions are stored in `.bc-alm/disabled/` and skipped by syncs.'); }
                if (g.source?.error) { md.appendMarkdown(`\n\n$(warning) ${g.source.error}`); }
                else if (g.source?.warning) { md.appendMarkdown(`\n\n$(warning) ${g.source.warning}`); }
                md.supportThemeIcons = true;
                t.tooltip = md;
                t.id = `template:${g.id}`;
                const flags = [g.disabled ? 'disabled' : 'enabled', g.primary && 'primary', g.source && 'hasSource'].filter(Boolean);
                t.contextValue = `template:${flags.join(':')}`;
                return t;
            }
            case 'local': {
                const t = new vscode.TreeItem('Local only', vscode.TreeItemCollapsibleState.Collapsed);
                t.description = `${node.components.length} · your own, from no template`;
                t.iconPath = new vscode.ThemeIcon('person');
                t.id = 'template:_local';
                t.contextValue = 'localGroup';
                return t;
            }
            case 'group': {
                const collapsed = node.id === 'available' || node.id === 'excluded';
                const t = new vscode.TreeItem(node.label, collapsed ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded);
                t.description = [`${node.components.length}`, ...this.rollup(node.components)].join(' · ');
                if (node.id === 'excluded') { t.tooltip = 'Components you chose not to take from this template (Manage Components…).'; }
                t.contextValue = `group:${node.id}`;
                t.id = `group:${node.scope ? node.scope + ':' : ''}${node.id}`;
                return t;
            }
            case 'component': {
                const c = node.comp;
                const multi = c.files.length > 1;
                const label = c.status === 'available' && c.ref.kind !== 'file' ? `${c.ref.kind} · ${c.ref.name}` : c.ref.name;
                const t = new vscode.TreeItem(label, multi ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
                const tplOff = offByTemplate(this.state, c);
                const desc = [c.templateDisabled ? 'Disabled (template off)' : STATUS_LABEL[c.status]];
                if (c.newInTemplate) { desc.push('new in template'); }
                if (tplOff && !c.templateDisabled) { desc.push('template off'); }
                if (c.keepLocal) { desc.push(c.implicitKeep ? 'kept local (sync setting)' : 'kept local'); }
                if (groupMode(this.state) === 'kind') {
                    const primary = this.state.catalogs[0]?.repo.key;
                    if (this.state.templateGroups().length > 1) { if (c.templateId) { desc.push(this.templateName(c.templateId)!); } }
                    else if (c.source && primary && !sameUrl(c.source, primary)) { desc.push(`from ${this.sourceName(c.source)}`); }
                }
                t.description = desc.join(' · ');
                t.iconPath = c.newInTemplate ? new vscode.ThemeIcon('sparkle', new vscode.ThemeColor('charts.green')) : statusIcon(c.status);
                t.id = `component:${c.ref.id}`;
                t.contextValue = `component:${c.status}${c.keepLocal ? ':keepLocal' : ''}${c.alsoIn.length ? ':multiSource' : ''}${tplOff ? ':templateOff' : ''}`;
                const md = new vscode.MarkdownString(`**${c.ref.name}** (${c.ref.kind})\n\n${STATUS_LABEL[c.status]}`);
                if (c.templateId) { md.appendMarkdown(`\n\nTemplate: ${this.templateName(c.templateId)}${tplOff ? ' (switched off in this project)' : ''}`); }
                if (c.source) { md.appendMarkdown(`\n\nSource: ${this.sourceName(c.source)}`); }
                if (c.newInTemplate) { md.appendMarkdown('\n\nAdded to the template after you chose its components.'); }
                if (c.alsoIn.length) { md.appendMarkdown(`\n\nAlso offered by: ${c.alsoIn.map(u => this.sourceName(u)).join(', ')}`); }
                md.appendMarkdown('\n\n' + c.files.map(f => `- \`${f.destRel}\` - ${STATUS_LABEL[f.status]}`).join('\n'));
                t.tooltip = md;
                if (!multi && c.files[0]) { t.command = { command: 'bcAlm.openFile', title: 'Open', arguments: [c.files[0]] }; }
                return t;
            }
            case 'file': {
                const f = node.file;
                const base = node.comp.files.map(x => x.destRel);
                const prefix = commonDir(base);
                const t = new vscode.TreeItem(f.destRel.slice(prefix.length) || path.posix.basename(f.destRel));
                t.description = STATUS_LABEL[f.status];
                t.iconPath = statusIcon(f.status);
                t.id = `file:${f.destRel}`;
                t.contextValue = `file:${f.status}`;
                t.tooltip = f.destRel;
                t.command = { command: 'bcAlm.openFile', title: 'Open', arguments: [f] };
                return t;
            }
        }
    }
}

function commonDir(paths: string[]): string {
    if (paths.length < 2) { return ''; }
    const parts = paths[0].split('/');
    let i = 0;
    while (i < parts.length - 1 && paths.every(p => p.split('/')[i] === parts[i])) { i++; }
    return i ? parts.slice(0, i).join('/') + '/' : '';
}

// ---------------------------------------------------------------- Sources

export class SourcesTree implements vscode.TreeDataProvider<SourceInfo> {
    private readonly emitter = new vscode.EventEmitter<SourceInfo | undefined>();
    readonly onDidChangeTreeData = this.emitter.event;
    constructor(private readonly state: ProjectState) {
        state.onDidChange(() => this.emitter.fire(undefined));
    }
    getChildren(node?: SourceInfo): SourceInfo[] {
        return node ? [] : this.state.sources;
    }
    getTreeItem(s: SourceInfo): vscode.TreeItem {
        const t = new vscode.TreeItem(s.name ?? s.manifest?.name ?? s.url);
        const d = [s.ref + (s.sha ? ` @ ${s.sha.slice(0, 7)}` : '')];
        if (s.manifest?.version) { d.push(`v${s.manifest.version}`); }
        if (s.primary) { d.push('★ primary'); } else if (s.inProject) { d.push('in project'); }
        if (s.disabled) { d.push('disabled'); }
        if (s.inProject && !s.inSettings) { d.push('from project'); }
        if (s.componentCount !== undefined) {
            const g = s.inProject && s.manifest ? this.state.templateGroup(s.manifest.id) : undefined;
            const inst = g?.components.filter(c => c.installed && !c.disabled && c.source && sameUrl(c.source, sourceKey(s))).length;
            d.push(`${s.componentCount} components${inst !== undefined ? ` · ${inst} installed` : ''}`);
        }
        if (s.upstreamDefault) { d.push('upstream'); }
        if (s.duplicateOf) { d.push(`same id as ${s.duplicateOf}`); }
        t.description = d.join(' · ');

        const md = new vscode.MarkdownString(`**${s.name ?? s.url}**`);
        md.supportThemeIcons = true;
        if (s.manifest) { md.appendMarkdown(`\n\nTemplate: ${s.manifest.name}${s.manifest.version ? ` v${s.manifest.version}` : ''} \`${s.manifest.id}\``); }
        if (s.manifest?.description) { md.appendMarkdown(`\n\n${s.manifest.description}`); }
        md.appendMarkdown(`\n\n${s.url}\n\nBranch/tag: \`${s.ref}\`${s.sha ? ` @ \`${s.sha.slice(0, 7)}\`` : ''}`);
        if (s.inProject && !s.inSettings) { md.appendMarkdown('\n\nUsed by this project (template.lock.json) but not in your bcAlm.templateSources setting.'); }
        if (s.disabled) { md.appendMarkdown('\n\nSwitched off in this project.'); }
        if (s.duplicateOf) { md.appendMarkdown(`\n\n$(warning) Uses the same template id as ${s.duplicateOf}.`); }
        if (s.error) { md.appendMarkdown(`\n\n$(error) ${s.error}`); }
        else if (s.warning) { md.appendMarkdown(`\n\n$(warning) Showing the cached copy. ${s.warning}`); }
        if (!s.sha && !s.error) { md.appendMarkdown('\n\nNot downloaded yet - refresh to read it.'); }
        t.tooltip = md;

        t.iconPath = s.error ? new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'))
            : s.warning ? new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.orange'))
            : s.disabled ? new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('disabledForeground'))
            : s.primary ? new vscode.ThemeIcon('star-full')
            : new vscode.ThemeIcon(s.manifest?.icon || 'repo');
        const flags = [
            s.inProject && 'inProject', s.primary && 'primary', s.upstreamDefault && 'upstreamDefault', githubSlug(s.url) && 'github',
            s.inSettings && 'inSettings', s.inProject && (s.disabled ? 'tplDisabled' : 'tplEnabled'), s.manifest && 'loaded'
        ].filter(Boolean);
        t.contextValue = `source:${flags.join(':')}`;
        t.id = `source:${sourceKey(s)}`;
        return t;
    }
}

// ---------------------------------------------------------------- Guidance

type GuidanceNode =
    | { type: 'section'; id: 'practices' | 'validation' | 'changes' | 'news' | 'docs'; label: string }
    | { type: 'link'; label: string; description?: string; url?: string; command?: vscode.Command; icon: string; tooltip?: string }
    | { type: 'findingFile'; file: string; findings: Finding[] }
    | { type: 'finding'; finding: Finding }
    | { type: 'sourceChanges'; source: SourceInfo };

export class GuidanceTree implements vscode.TreeDataProvider<GuidanceNode> {
    private readonly emitter = new vscode.EventEmitter<GuidanceNode | undefined>();
    readonly onDidChangeTreeData = this.emitter.event;
    news?: NewsItem[];
    newsError?: string;
    private newsLoading = false;

    constructor(private readonly state: ProjectState, private readonly findings: () => Map<string, Finding[]>, private readonly bestPracticesUri: vscode.Uri) {
        state.onDidChange(() => this.emitter.fire(undefined));
    }

    refresh(): void { this.emitter.fire(undefined); }

    async loadNews(): Promise<void> {
        const cfg = vscode.workspace.getConfiguration('bcAlm');
        const url = cfg.get<string>('whatsNew.feedUrl');
        if (!url) { this.news = []; return; }
        this.newsLoading = true;
        this.refresh();
        try {
            this.news = await fetchFeed(url, cfg.get<string[]>('whatsNew.keywords') ?? []);
            this.newsError = undefined;
        } catch (e) {
            this.newsError = (e as Error).message;
        } finally {
            this.newsLoading = false;
            this.refresh();
        }
    }

    async getChildren(node?: GuidanceNode): Promise<GuidanceNode[]> {
        if (!node) {
            const n = [...this.findings().values()].reduce((a, f) => a + f.length, 0);
            return [
                { type: 'section', id: 'practices', label: 'Best practices' },
                { type: 'section', id: 'validation', label: `Validation${n ? ` (${n})` : ''}` },
                { type: 'section', id: 'changes', label: 'Template changes' },
                { type: 'section', id: 'news', label: 'Copilot updates (GitHub changelog)' },
                { type: 'section', id: 'docs', label: 'Official documentation' }
            ];
        }
        if (node.type === 'section') {
            switch (node.id) {
                case 'practices':
                    return [
                        { type: 'link', label: 'BC ALM customization best practices', icon: 'book', command: { command: 'bcAlm.openBestPractices', title: 'Open' } },
                        { type: 'link', label: 'Validate all customizations', icon: 'checklist', command: { command: 'bcAlm.validate', title: 'Validate' } },
                        { type: 'link', label: 'Create a new agent / skill / prompt / instruction', icon: 'add', command: { command: 'bcAlm.newCustomization', title: 'New' } }
                    ];
                case 'validation': {
                    const m = this.findings();
                    if (!m.size) { return [{ type: 'link', label: 'No findings', icon: 'pass' }]; }
                    return [...m.entries()].sort().map(([file, findings]) => ({ type: 'findingFile', file, findings }));
                }
                case 'changes':
                    return this.state.sources.filter(s => s.inProject && s.sha).map(source => ({ type: 'sourceChanges', source }));
                case 'news':
                    if (this.newsLoading) { return [{ type: 'link', label: 'Loading…', icon: 'loading~spin' }]; }
                    if (this.newsError) { return [{ type: 'link', label: `Could not load feed: ${this.newsError}`, icon: 'error', command: { command: 'bcAlm.refreshGuidance', title: 'Retry' } }]; }
                    if (!this.news) { void this.loadNews(); return [{ type: 'link', label: 'Loading…', icon: 'loading~spin' }]; }
                    if (!this.news.length) { return [{ type: 'link', label: 'No matching entries', icon: 'info' }]; }
                    return this.news.map(n => ({
                        type: 'link', label: n.title, description: n.date.toISOString().slice(0, 10), url: n.link, icon: 'megaphone',
                        tooltip: `${n.summary}\n\nMatched: ${n.matched.join(', ')}`
                    }));
                case 'docs':
                    return [
                        { type: 'link', label: 'Custom agents (VS Code)', url: DOCS.agentsVsCode, icon: 'link-external' },
                        { type: 'link', label: 'Custom agents configuration (GitHub)', url: DOCS.agentsGitHub, icon: 'link-external' },
                        { type: 'link', label: 'Agent skills (VS Code)', url: DOCS.skillsVsCode, icon: 'link-external' },
                        { type: 'link', label: 'Agent skills (GitHub)', url: DOCS.skillsGitHub, icon: 'link-external' },
                        { type: 'link', label: 'Agent Skills specification', url: DOCS.skillsSpec, icon: 'link-external' },
                        { type: 'link', label: 'Prompt files', url: DOCS.prompts, icon: 'link-external' },
                        { type: 'link', label: 'Custom instructions', url: DOCS.instructions, icon: 'link-external' }
                    ];
            }
        }
        if (node.type === 'findingFile') { return node.findings.map(finding => ({ type: 'finding', finding })); }
        if (node.type === 'sourceChanges') { return this.changesFor(node.source); }
        return [];
    }

    private async changesFor(s: SourceInfo): Promise<GuidanceNode[]> {
        const cat = this.state.catalogs.find(c => sameUrl(c.repo.key, sourceKey(s)));
        if (!cat) { return []; }
        // "Since your last sync" = the commit most of your tracked files were taken from.
        const counts = new Map<string, number>();
        for (const e of Object.values(this.state.lock?.files ?? {})) {
            if (sameUrl(e.source, sourceKey(s))) { counts.set(e.commit, (counts.get(e.commit) ?? 0) + 1); }
        }
        let since: string | undefined = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        if (since && !(await cat.repo.hasCommit(since))) { since = undefined; }
        const commits: CommitInfo[] = await cat.repo.log(cat.sha, [], 40, since);
        const slug = githubSlug(s.url);
        if (!commits.length) { return [{ type: 'link', label: since ? 'Up to date - no new template commits' : 'No commits', icon: 'pass' }]; }
        return commits.map(c => ({
            type: 'link', label: c.subject, description: `${c.date.slice(0, 10)} · ${c.sha.slice(0, 7)}`, icon: 'git-commit',
            tooltip: `${c.author}\n${c.sha}`, url: slug ? `https://github.com/${slug.owner}/${slug.repo}/commit/${c.sha}` : undefined
        }));
    }

    getTreeItem(node: GuidanceNode): vscode.TreeItem {
        switch (node.type) {
            case 'section': {
                const t = new vscode.TreeItem(node.label, node.id === 'practices' ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
                t.id = `section:${node.id}`;
                t.iconPath = new vscode.ThemeIcon({ practices: 'lightbulb', validation: 'checklist', changes: 'history', news: 'megaphone', docs: 'book' }[node.id]);
                t.contextValue = `guidance:${node.id}`;
                return t;
            }
            case 'link': {
                const t = new vscode.TreeItem(node.label);
                t.description = node.description;
                t.iconPath = new vscode.ThemeIcon(node.icon);
                t.tooltip = node.tooltip ?? node.url;
                t.command = node.command ?? (node.url ? { command: 'bcAlm.openUrl', title: 'Open', arguments: [node.url] } : undefined);
                return t;
            }
            case 'findingFile': {
                const t = new vscode.TreeItem(node.file, vscode.TreeItemCollapsibleState.Collapsed);
                t.description = `${node.findings.length}`;
                t.iconPath = new vscode.ThemeIcon(node.findings.some(f => f.severity === 'error') ? 'error' : node.findings.some(f => f.severity === 'warning') ? 'warning' : 'info');
                return t;
            }
            case 'finding': {
                const f = node.finding;
                const t = new vscode.TreeItem(f.message);
                t.description = `line ${f.line + 1}`;
                t.tooltip = `${f.code}: ${f.message}${f.docUrl ? `\n${f.docUrl}` : ''}`;
                t.iconPath = new vscode.ThemeIcon(f.severity === 'error' ? 'error' : f.severity === 'warning' ? 'warning' : 'info');
                t.command = { command: 'bcAlm.openFinding', title: 'Open', arguments: [f] };
                return t;
            }
            case 'sourceChanges': {
                const t = new vscode.TreeItem(node.source.name ?? node.source.url, vscode.TreeItemCollapsibleState.Collapsed);
                t.description = node.source.ref;
                t.iconPath = new vscode.ThemeIcon('repo');
                return t;
            }
        }
    }
}
