import * as path from 'path';
import * as vscode from 'vscode';
import { fetchFeed, NewsItem } from '../core/changelog';
import { KIND_LABELS, KIND_ORDER } from '../core/paths';
import { ComponentState, FileState, FileStatus, STATUS_LABEL } from '../core/status';
import { CommitInfo } from '../core/templateRepo';
import { DOCS, Finding } from '../core/validator';
import { githubSlug } from '../core/publish';
import { sameUrl } from '../core/util';
import { ProjectState, SourceInfo } from './projectState';

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
    | { type: 'group'; id: string; label: string; components: ComponentState[] }
    | { type: 'component'; comp: ComponentState }
    | { type: 'file'; comp: ComponentState; file: FileState }
    | { type: 'message'; label: string; icon?: string; command?: vscode.Command };

export class ComponentsTree implements vscode.TreeDataProvider<ComponentsNode> {
    private readonly emitter = new vscode.EventEmitter<ComponentsNode | undefined>();
    readonly onDidChangeTreeData = this.emitter.event;

    constructor(private readonly state: ProjectState) {
        state.onDidChange(() => this.emitter.fire(undefined));
    }

    private sourceName(url?: string): string | undefined {
        if (!url) { return undefined; }
        return this.state.sources.find(s => sameUrl(s.url, url))?.name ?? url;
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
            const installed = st.components.filter(c => c.status !== 'available');
            for (const k of KIND_ORDER) {
                const comps = installed.filter(c => c.ref.kind === k);
                if (comps.length) { out.push({ type: 'group', id: k, label: KIND_LABELS[k], components: comps }); }
            }
            const available = st.components.filter(c => c.status === 'available');
            if (available.length) { out.push({ type: 'group', id: 'available', label: 'Available to install', components: available }); }
            return out;
        }
        if (node.type === 'group') { return node.components.map(comp => ({ type: 'component', comp })); }
        if (node.type === 'component' && node.comp.files.length > 1) {
            return node.comp.files.map(file => ({ type: 'file', comp: node.comp, file }));
        }
        return [];
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
            case 'group': {
                const t = new vscode.TreeItem(node.label, node.id === 'available' ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded);
                const n = (s: FileStatus[]) => node.components.filter(c => s.includes(c.status) && !c.keepLocal).length;
                const parts = [`${node.components.length}`];
                const up = n(['update', 'new', 'missing']);
                const cf = n(['conflict']);
                if (up) { parts.push(`${up} update${up > 1 ? 's' : ''}`); }
                if (cf) { parts.push(`${cf} conflict${cf > 1 ? 's' : ''}`); }
                t.description = parts.join(' · ');
                t.contextValue = `group:${node.id}`;
                t.id = `group:${node.id}`;
                return t;
            }
            case 'component': {
                const c = node.comp;
                const multi = c.files.length > 1;
                const label = c.status === 'available' && c.ref.kind !== 'file' ? `${c.ref.kind} · ${c.ref.name}` : c.ref.name;
                const t = new vscode.TreeItem(label, multi ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
                const desc = [STATUS_LABEL[c.status]];
                if (c.keepLocal) { desc.push(c.implicitKeep ? 'kept local (sync setting)' : 'kept local'); }
                const primary = this.state.catalogs[0]?.repo.spec.url;
                if (c.source && primary && !sameUrl(c.source, primary)) { desc.push(`from ${this.sourceName(c.source)}`); }
                t.description = desc.join(' · ');
                t.iconPath = statusIcon(c.status);
                t.id = `component:${c.ref.id}`;
                t.contextValue = `component:${c.status}${c.keepLocal ? ':keepLocal' : ''}${c.alsoIn.length ? ':multiSource' : ''}`;
                const md = new vscode.MarkdownString(`**${c.ref.name}** (${c.ref.kind})\n\n${STATUS_LABEL[c.status]}`);
                if (c.source) { md.appendMarkdown(`\n\nSource: ${this.sourceName(c.source)}`); }
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
        const t = new vscode.TreeItem(s.name ?? s.url);
        const d = [s.ref + (s.sha ? ` @ ${s.sha.slice(0, 7)}` : '')];
        if (s.primary) { d.push('primary'); } else if (s.inProject) { d.push('in project'); }
        if (s.upstreamDefault) { d.push('upstream'); }
        t.description = d.join(' · ');
        t.tooltip = `${s.url}\n${s.error ? 'Error: ' + s.error : ''}`.trim();
        t.iconPath = new vscode.ThemeIcon(s.error ? 'warning' : s.primary ? 'star-full' : 'repo');
        const flags = [s.inProject && 'inProject', s.primary && 'primary', s.upstreamDefault && 'upstreamDefault', githubSlug(s.url) && 'github'].filter(Boolean);
        t.contextValue = `source:${flags.join(':')}`;
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
        const cat = this.state.catalogs.find(c => sameUrl(c.repo.spec.url, s.url));
        if (!cat) { return []; }
        // "Since your last sync" = the commit most of your tracked files were taken from.
        const counts = new Map<string, number>();
        for (const e of Object.values(this.state.lock?.files ?? {})) {
            if (sameUrl(e.source, s.url)) { counts.set(e.commit, (counts.get(e.commit) ?? 0) + 1); }
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
