import * as fs from 'fs';
import * as vscode from 'vscode';
import { buildCatalog, Catalog } from '../core/catalog';
import { classifySourceError } from '../core/access';
import { manifestOf, ProjectConfig, readProjectConfig, TemplateManifest, templateIdFromUrl } from '../core/config';
import { resolveProjectRoot } from '../core/layout';
import { LockFile, LockSource, readLock } from '../core/lock';
import { componentOf, isManaged } from '../core/paths';
import { ComponentState, computeStatus, FileState, ProjectStatus } from '../core/status';
import { TemplateRepo, TemplateRepoRegistry, TemplateSourceSpec } from '../core/templateRepo';
import { ProjectOps } from '../core/operations';
import { sameUrl } from '../core/util';

export const UPSTREAM_URL = 'https://github.com/AlexanderErdelyi/bc-alm-template.git';

export interface SourceInfo extends TemplateSourceSpec {
    inProject: boolean;
    primary: boolean;
    upstreamDefault: boolean;
    inSettings: boolean;
    /** Actionable load problem (no usable copy). */
    error?: string;
    /** Loaded from the cached copy because the fetch failed. */
    warning?: string;
    sha?: string;
    /** Template identity (manifest block or repository name); known once the source was read. */
    manifest?: TemplateManifest;
    /** Number of components the template offers. */
    componentCount?: number;
    /** Template switched off in this project (sync.templates.disabled). */
    disabled?: boolean;
    /** Another loaded source uses the same template id. */
    duplicateOf?: string;
}

export interface TemplateGroup {
    id: string;
    manifest: TemplateManifest;
    source?: SourceInfo;
    primary: boolean;
    disabled: boolean;
    components: ComponentState[];
}

export function settingsSources(): TemplateSourceSpec[] {
    const list = vscode.workspace.getConfiguration('bcAlm').get<Partial<TemplateSourceSpec>[]>('templateSources') ?? [];
    const out = list.filter(s => s && s.url).map(s => ({ name: s.name, url: s.url!, ref: s.ref || 'main', ...(s.upstream ? { upstream: s.upstream } : {}) }));
    return out.length ? out : [{ name: 'BC ALM Template (upstream)', url: UPSTREAM_URL, ref: 'main' }];
}

export async function saveSettingsSources(list: TemplateSourceSpec[]): Promise<void> {
    await vscode.workspace.getConfiguration('bcAlm').update('templateSources', list, vscode.ConfigurationTarget.Global);
}

/**
 * Finds the BC ALM project root for the workspace. Workspace folders may be the repo root, a
 * subfolder of it (multi-root workspaces that open app/ and test/), or the .bc-alm folder itself.
 */
export function findProjectRoot(): string | undefined {
    for (const f of vscode.workspace.workspaceFolders ?? []) {
        if (f.uri.scheme !== 'file') { continue; }
        const root = resolveProjectRoot(f.uri.fsPath);
        if (root) { return root; }
    }
    return undefined;
}

export class ProjectState implements vscode.Disposable {
    root?: string;
    project?: ProjectConfig;
    lock?: LockFile;
    catalogs: Catalog[] = [];
    status?: ProjectStatus;
    sources: SourceInfo[] = [];
    lastError?: string;
    loading = false;

    readonly registry: TemplateRepoRegistry;
    private readonly emitter = new vscode.EventEmitter<void>();
    readonly onDidChange = this.emitter.event;
    private queue: Promise<void> = Promise.resolve();

    constructor(readonly storageRoot: string) {
        fs.mkdirSync(storageRoot, { recursive: true });
        this.registry = new TemplateRepoRegistry(storageRoot);
    }

    dispose(): void { this.emitter.dispose(); }

    repo(spec: TemplateSourceSpec): TemplateRepo {
        return this.registry.get(spec);
    }

    /** Sources this project syncs from: the lock's sources, or the first configured source. */
    projectSources(): LockSource[] {
        if (this.lock?.sources?.length) { return this.lock.sources; }
        const s = settingsSources()[0];
        return [{ name: s.name, url: s.url, ref: s.ref }];
    }

    /** Serializes refreshes so tree/commands never see a half-built state. */
    /** fetch=true always fetches; offline=true never fetches (cached clones only); otherwise honors bcAlm.fetchIntervalMinutes. */
    refresh(fetch: boolean, offline = false): Promise<void> {
        this.queue = this.queue.then(() => this.doRefresh(fetch, offline), () => this.doRefresh(fetch, offline));
        return this.queue;
    }

    private async doRefresh(fetch: boolean, offline: boolean): Promise<void> {
        this.loading = true;
        this.emitter.fire();
        try {
            this.root = findProjectRoot();
            await vscode.commands.executeCommand('setContext', 'bcAlm.hasProject', !!this.root);
            this.project = this.root ? readProjectConfig(this.root) : undefined;
            this.lock = this.root ? readLock(this.root) : undefined;
            this.lastError = undefined;
            const minutes = vscode.workspace.getConfiguration('bcAlm').get<number>('fetchIntervalMinutes', 60);
            const maxAge = fetch ? 0 : offline ? Number.POSITIVE_INFINITY : Math.max(0, minutes) * 60_000;

            const projectSrc = this.root ? this.projectSources() : [];
            const all: SourceInfo[] = [];
            const push = (s: TemplateSourceSpec, inSettings: boolean) => {
                const ex = all.find(x => sameUrl(x.url, s.url));
                if (ex) { ex.inSettings ||= inSettings; ex.upstream ??= s.upstream; return; }
                const pi = projectSrc.findIndex(p => sameUrl(p.url, s.url));
                all.push({ ...s, ref: s.ref || 'main', inProject: pi >= 0, primary: pi === 0, upstreamDefault: sameUrl(s.url, UPSTREAM_URL), inSettings });
            };
            projectSrc.forEach(s => push({ name: s.name, url: s.url, ref: s.ref }, false));
            settingsSources().forEach(s => push(s, true));

            this.catalogs = [];
            const problems: string[] = [];
            const load = async (info: SourceInfo, p: TemplateSourceSpec, age: number) => {
                const repo = this.repo({ name: p.name, url: p.url, ref: p.ref });
                try {
                    await repo.ensure(age);
                } catch (e) {
                    const prob = classifySourceError((e as Error).message, p.url, p.ref);
                    if (!repo.isCached()) { throw Object.assign(new Error(prob.message), { detail: prob.detail }); }
                    info.warning = prob.message;
                }
                return repo;
            };
            const fail = (info: SourceInfo, e: unknown) => {
                const err = e as Error & { detail?: string };
                info.error = err.detail ? err.message : classifySourceError(err.message, info.url, info.ref).message;
            };
            if (this.root && this.project) {
                for (const p of projectSrc) {
                    const info = all.find(x => sameUrl(x.url, p.url))!;
                    try {
                        const repo = await load(info, p, maxAge);
                        const sha = await repo.resolve();
                        info.sha = sha;
                        const cat = await buildCatalog(repo, sha, this.project);
                        this.catalogs.push(cat);
                        info.manifest = cat.manifest;
                        info.componentCount = new Set([...cat.files.values()].map(f => f.component.id)).size;
                    } catch (e) {
                        fail(info, e);
                    }
                }
                this.status = await computeStatus({ root: this.root, project: this.project, lock: this.lock, catalogs: this.catalogs });
                const failed = all.filter(s => s.inProject && s.error);
                if (failed.length) { problems.push(`Could not load ${failed.map(f => f.name ?? f.url).join(', ')}: ${failed[0].error}`); }
            } else {
                this.status = undefined;
            }
            // Settings-only sources: read the identity from the cached copy (no network unless asked to refresh).
            for (const info of all.filter(s => !s.sha && !s.error)) {
                try {
                    const spec = { name: info.name, url: info.url, ref: info.ref };
                    const repo = this.repo(spec);
                    if (!repo.isCached() && !fetch) { continue; }
                    await load(info, spec, fetch ? 0 : Number.POSITIVE_INFINITY);
                    const sha = await repo.resolve();
                    info.sha = sha;
                    const cfg = await repo.readConfig(sha);
                    info.manifest = manifestOf(cfg, info.url, info.name);
                    const sync = this.project?.sync ?? cfg?.sync;
                    if (sync) { info.componentCount = new Set((await repo.listFiles(sha)).filter(f => isManaged(f, sync)).map(f => componentOf(f).id)).size; }
                } catch (e) {
                    fail(info, e);
                }
            }
            const disabled = new Set(this.project?.sync.templates.disabled ?? []);
            for (const info of all) {
                if (!info.manifest) { continue; }
                info.disabled = info.inProject && disabled.has(info.manifest.id);
                const twin = all.find(o => o !== info && o.manifest?.id === info.manifest!.id && (o.inProject || !info.inProject));
                if (twin && all.indexOf(twin) < all.indexOf(info)) {
                    info.duplicateOf = twin.name ?? twin.url;
                    if (info.inProject && twin.inProject) { problems.push(`Two template sources use the template id "${info.manifest.id}" (${twin.name ?? twin.url} and ${info.name ?? info.url}). Give each template a unique "template.id" in its template.config.json.`); }
                }
            }
            this.lastError = problems.length ? problems.join(' ') : undefined;
            this.sources = all;
        } catch (e) {
            this.lastError = (e as Error).message;
        } finally {
            this.loading = false;
            this.emitter.fire();
        }
    }

    ops(): ProjectOps {
        if (!this.root || !this.project) { throw new Error('No BC ALM project is open.'); }
        // Re-read the lock so external edits (e.g. a sync script run) are not overwritten.
        return new ProjectOps(this.root, this.project, readLock(this.root), this.catalogs);
    }

    component(id: string): ComponentState | undefined {
        return this.status?.components.find(c => c.ref.id === id);
    }

    /** The project's templates (primary first) with the components each one provides. */
    templateGroups(): TemplateGroup[] {
        const disabled = new Set(this.project?.sync.templates.disabled ?? []);
        const groups = new Map<string, TemplateGroup>();
        const add = (id: string, manifest: TemplateManifest, source?: SourceInfo) => {
            let g = groups.get(id);
            if (!g) {
                g = { id, manifest, source, primary: !!source?.primary, disabled: disabled.has(id), components: [] };
                groups.set(id, g);
            }
            return g;
        };
        for (const s of this.sources.filter(x => x.inProject)) {
            const id = s.manifest?.id ?? templateIdFromUrl(s.url);
            add(id, s.manifest ?? { id, name: s.name ?? id }, s);
        }
        for (const c of this.status?.components ?? []) {
            if (c.templateId) { add(c.templateId, { id: c.templateId, name: c.templateId }).components.push(c); }
        }
        return [...groups.values()];
    }

    /** Your own components that come from no template. */
    localComponents(): ComponentState[] {
        return (this.status?.components ?? []).filter(c => !c.templateId);
    }

    templateGroup(id: string): TemplateGroup | undefined {
        return this.templateGroups().find(g => g.id === id);
    }

    file(destRel: string): FileState | undefined {
        return this.status?.files.find(f => f.destRel === destRel);
    }

    counts(): { updates: number; conflicts: number; modified: number } {
        const comps = (this.status?.components ?? []).filter(c => !c.disabled && !c.keepLocal);
        return {
            updates: comps.filter(c => c.status === 'update' || c.status === 'new' || c.status === 'missing').length,
            conflicts: comps.filter(c => c.status === 'conflict').length,
            modified: comps.filter(c => c.status === 'modified').length
        };
    }
}
