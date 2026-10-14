import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { catFileBatch, git } from './exec';
import { parseConfig, ProjectConfig, slugId, TemplateManifest, templateIdFromUrl } from './config';
import { componentOf } from './paths';
import { normalizeUrl, safeRemove, sourceKey, templatePath } from './util';

export interface TemplateSourceSpec {
    name?: string;
    url: string;
    ref: string;
    /** Folder of the template inside a catalog repository (e.g. ".templates/bc-upgrade"); empty = repository root. */
    path?: string;
    /** Template this one was created from (duplicate/fork); used by "Sync from upstream". */
    upstream?: string;
}

export interface CommitInfo {
    sha: string;
    date: string;
    author: string;
    subject: string;
}

/** Folder of a catalog repository that holds additional templates (one sub-folder per template id). */
export const CATALOG_DIR = '.templates';

/** A template found in a repository: the root template or a `.templates/<id>/` folder. */
export interface TemplateEntry {
    id: string;
    /** Template folder in the repository ('' = root). */
    path: string;
    manifest: TemplateManifest;
    config?: ProjectConfig;
}

export interface TemplateListing {
    templates: TemplateEntry[];
    /** Folders that look like templates but were skipped (no manifest, id mismatch, duplicate). */
    warnings: string[];
}

function parseConfigText(text: string | undefined): ProjectConfig | undefined {
    if (text === undefined) { return undefined; }
    try { return parseConfig(JSON.parse(text.replace(/^\uFEFF/, ''))); } catch { return undefined; }
}

const isSha = (s: string) => /^[0-9a-f]{40}$/i.test(s);
const join = (root: string, rel: string) => root ? `${root}/${rel}` : rel;

/** Files of the template at `root` as template-relative path -> repository path. The root template never includes .templates/. */
function filesUnder(all: string[], root: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const p of all) {
        if (!root) {
            if (!p.startsWith(CATALOG_DIR + '/')) { out.set(p, p); }
        } else if (p.startsWith(root + '/')) {
            out.set(p.slice(root.length + 1), p);
        }
    }
    return out;
}

/**
 * A local bare mirror of a template repository, kept in the extension's global storage and shared by
 * every template of that repository. All reads go through git plumbing (ls-tree / cat-file --batch / log),
 * so nothing is checked out and many sources can be cached cheaply.
 */
export class GitMirror {
    private lastFetch = 0;
    private inflight?: Promise<void>;
    private blobCache = new Map<string, string | undefined>();
    private treeCache = new Map<string, string[]>();
    private listingCache = new Map<string, TemplateListing>();

    constructor(readonly url: string, readonly gitDir: string) { }

    isCached(): boolean {
        return fs.existsSync(path.join(this.gitDir, 'HEAD'));
    }

    /** Clone (first time) or fetch. `maxAgeMs` skips the fetch when the mirror is fresh enough. Concurrent calls share one fetch. */
    ensure(maxAgeMs = 0): Promise<void> {
        if (!this.inflight) {
            this.inflight = this.doEnsure(maxAgeMs).finally(() => { this.inflight = undefined; });
        }
        return this.inflight;
    }

    private async doEnsure(maxAgeMs: number): Promise<void> {
        if (!this.isCached()) {
            fs.mkdirSync(path.dirname(this.gitDir), { recursive: true });
            await git(['clone', '--bare', '--quiet', this.url, this.gitDir]);
            this.lastFetch = Date.now();
            return;
        }
        const stamp = path.join(this.gitDir, 'FETCH_HEAD');
        const last = Math.max(this.lastFetch, fs.existsSync(stamp) ? fs.statSync(stamp).mtimeMs : 0);
        if (maxAgeMs > 0 && Date.now() - last < maxAgeMs) { return; }
        await git(['--git-dir', this.gitDir, 'remote', 'set-url', 'origin', this.url], undefined, { allowFailure: true });
        await git(['--git-dir', this.gitDir, 'fetch', '--quiet', '--prune', '--force', 'origin',
            '+refs/heads/*:refs/heads/*', '+refs/tags/*:refs/tags/*']);
        this.lastFetch = Date.now();
    }

    async resolve(ref: string): Promise<string> {
        const r = await git(['--git-dir', this.gitDir, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`], undefined, { allowFailure: true });
        if (r.code === 0 && r.stdout.trim()) { return r.stdout.trim(); }
        const r2 = await git(['--git-dir', this.gitDir, 'rev-parse', '--verify', `refs/heads/${ref}^{commit}`]);
        return r2.stdout.trim();
    }

    async hasCommit(sha: string): Promise<boolean> {
        const r = await git(['--git-dir', this.gitDir, 'cat-file', '-e', `${sha}^{commit}`], undefined, { allowFailure: true });
        return r.code === 0;
    }

    async isAncestor(a: string, b: string): Promise<boolean> {
        const r = await git(['--git-dir', this.gitDir, 'merge-base', '--is-ancestor', a, b], undefined, { allowFailure: true });
        return r.code === 0;
    }

    /** Every file of the repository at `sha` (repository paths). */
    async listFiles(sha: string): Promise<string[]> {
        const hit = this.treeCache.get(sha);
        if (hit) { return hit; }
        const r = await git(['--git-dir', this.gitDir, 'ls-tree', '-r', '--name-only', '-z', sha]);
        const files = r.stdout.split('\0').filter(x => x);
        if (isSha(sha)) { this.treeCache.set(sha, files); }
        return files;
    }

    /** Read blobs by repository path. */
    async readFiles(sha: string, paths: string[]): Promise<Map<string, string | undefined>> {
        const out = new Map<string, string | undefined>();
        const missing: string[] = [];
        for (const p of paths) {
            const k = `${sha}:${p}`;
            if (this.blobCache.has(k)) { out.set(p, this.blobCache.get(k)); } else { missing.push(k); }
        }
        if (missing.length) {
            const res = await catFileBatch(this.gitDir, missing);
            for (const k of missing) {
                const v = res.get(k);
                if (isSha(sha)) { this.blobCache.set(k, v); }
                out.set(k.slice(sha.length + 1), v);
            }
        }
        return out;
    }

    async readFile(sha: string, p: string): Promise<string | undefined> {
        return (await this.readFiles(sha, [p])).get(p);
    }

    /** Commits (newest first) touching `pathspecs` reachable from `sha`, optionally only after `since`. */
    async log(sha: string, pathspecs: string[] = [], max = 100, since?: string): Promise<CommitInfo[]> {
        const range = since ? `${since}..${sha}` : sha;
        const args = ['--git-dir', this.gitDir, 'log', `--max-count=${max}`, '--format=%H%x1f%cI%x1f%an%x1f%s', range];
        if (pathspecs.length) { args.push('--', ...pathspecs); }
        const r = await git(args, undefined, { allowFailure: true });
        if (r.code !== 0) { return []; }
        return r.stdout.split('\n').filter(l => l.trim()).map(l => {
            const [s, date, author, subject] = l.split('\x1f');
            return { sha: s, date, author, subject };
        });
    }

    /** One-shot history: for each wanted repository path, push the commits (newest first) that changed it under its mapped key. */
    async fileHistory(sha: string, wanted: Map<string, string>, maxCommits = 400): Promise<Map<string, string[]>> {
        const out = new Map<string, string[]>();
        if (wanted.size === 0) { return out; }
        const r = await git(['--git-dir', this.gitDir, 'log', `--max-count=${maxCommits}`, '--no-renames', '--name-only', '--format=%x01%H', sha], undefined, { allowFailure: true });
        if (r.code !== 0) { return out; }
        let current = '';
        for (const line of r.stdout.split('\n')) {
            if (line.startsWith('\x01')) { current = line.slice(1).trim(); continue; }
            const key = wanted.get(line.trim());
            if (!key || !current) { continue; }
            const list = out.get(key) ?? [];
            if (list[list.length - 1] !== current) { list.push(current); }
            out.set(key, list);
        }
        return out;
    }

    /** Check out `sha` (or some of its paths) into `dest` without touching the mirror's refs. */
    async checkout(sha: string, dest: string, pathspecs: string[] = ['.']): Promise<void> {
        fs.mkdirSync(dest, { recursive: true });
        await git(['--git-dir', this.gitDir, '--work-tree', dest, 'checkout', '--force', sha, '--', ...pathspecs]);
        // `checkout -- .` on a bare repo with a work-tree updates the bare index; reset it so the cache stays clean.
        await git(['--git-dir', this.gitDir, 'read-tree', '--empty'], undefined, { allowFailure: true });
    }

    /**
     * Templates in this repository at `sha`: the root (when its template.config.json has a "template" block,
     * or it has Copilot customizations) plus every `.templates/<id>/` folder with a valid manifest.
     */
    async listTemplates(sha: string): Promise<TemplateListing> {
        const hit = this.listingCache.get(sha);
        if (hit) { return hit; }
        const files = await this.listFiles(sha);
        const subs = files.map(f => /^\.templates\/([^/]+)\/template\.config\.json$/.exec(f)).filter((m): m is RegExpExecArray => !!m);
        const blobs = await this.readFiles(sha, ['template.config.json', ...subs.map(m => m[0])]);
        const templates: TemplateEntry[] = [];
        const warnings: string[] = [];
        const rootCfg = parseConfigText(blobs.get('template.config.json'));
        const rootHasContent = files.some(f => /^\.github\/(agents|skills|prompts|instructions)\//.test(f));
        if (rootCfg?.template || rootHasContent || !subs.length) {
            const id = rootCfg?.template?.id ?? templateIdFromUrl(this.url);
            templates.push({ id, path: '', manifest: rootCfg?.template ?? { id, name: id }, config: rootCfg });
        }
        for (const m of subs) {
            const folder = m[1];
            const where = `${CATALOG_DIR}/${folder}`;
            const cfg = parseConfigText(blobs.get(m[0]));
            if (!cfg) { warnings.push(`${where}: template.config.json is not valid JSON - skipped.`); continue; }
            if (!cfg.template) { warnings.push(`${where}: template.config.json has no "template" block - skipped.`); continue; }
            if (cfg.template.id !== slugId(folder)) { warnings.push(`${where}: template id "${cfg.template.id}" does not match the folder name - skipped.`); continue; }
            if (templates.some(t => t.id === cfg.template!.id)) { warnings.push(`${where}: duplicate template id "${cfg.template.id}" - skipped.`); continue; }
            templates.push({ id: cfg.template.id, path: where, manifest: cfg.template, config: cfg });
        }
        const listing = { templates, warnings };
        if (isSha(sha)) { this.listingCache.set(sha, listing); }
        return listing;
    }
}

interface Layer {
    /** Template folder in the repository ('' = root). */
    path: string;
    id: string;
    config?: ProjectConfig;
}

/** How a template is assembled at one commit (a plain template has one layer; a variant adds its bases). */
export interface TemplateLayout {
    /** Template-relative path -> repository path. */
    files: Map<string, string>;
    /** Base first, the template itself last. */
    layers: Layer[];
    /** Component ids the template replaces from its base (variants only). */
    overridden: Set<string>;
    /** Component ids the template removes from its base (variants only). */
    removed: Set<string>;
}

const mirrors = new Map<string, GitMirror>();

/** The shared mirror of a repository URL (one per cache folder and URL). */
export function mirrorFor(url: string, cacheRoot: string): GitMirror {
    const hash = createHash('sha1').update(url.trim().toLowerCase()).digest('hex').slice(0, 16);
    const gitDir = path.join(cacheRoot, 'templates', hash + '.git');
    let m = mirrors.get(gitDir);
    if (!m) {
        m = new GitMirror(url, gitDir);
        mirrors.set(gitDir, m);
    }
    return m;
}

/**
 * One template of a repository: the repository root or a `.templates/<id>/` folder, optionally a
 * variant that extends another template of the same repository. All paths taken and returned by
 * this class are template-relative (the same as in a project), so the catalog, transform and merge
 * logic is independent of where the template lives.
 */
export class TemplateRepo {
    readonly mirror: GitMirror;
    private layoutCache = new Map<string, Promise<TemplateLayout>>();
    private configCache = new Map<string, ProjectConfig | undefined>();

    constructor(readonly spec: TemplateSourceSpec, cache: string | GitMirror) {
        if (templatePath(spec.path).split('/').some(s => s === '..')) { throw new Error(`Invalid template path "${spec.path}".`); }
        this.mirror = typeof cache === 'string' ? mirrorFor(spec.url, cache) : cache;
    }

    get gitDir(): string { return this.mirror.gitDir; }

    /** Template folder in the repository ('' = root). */
    get root(): string { return templatePath(this.spec.path); }

    /** Identity of this source: the URL, plus "#<path>" for a template in a sub-folder. */
    get key(): string { return sourceKey(this.spec); }

    get label(): string {
        return this.spec.name || (this.root ? `${this.spec.url} (${this.root})` : this.spec.url);
    }

    /** Repository path where a template-relative file is written when publishing (always the template's own folder). */
    writePath(rel: string): string { return join(this.root, rel); }

    isCached(): boolean { return this.mirror.isCached(); }
    ensure(maxAgeMs = 0): Promise<void> { return this.mirror.ensure(maxAgeMs); }
    resolve(ref: string = this.spec.ref): Promise<string> { return this.mirror.resolve(ref); }
    hasCommit(sha: string): Promise<boolean> { return this.mirror.hasCommit(sha); }
    isAncestor(a: string, b: string): Promise<boolean> { return this.mirror.isAncestor(a, b); }
    listTemplates(sha: string): Promise<TemplateListing> { return this.mirror.listTemplates(sha); }

    /** The template's own (unresolved) config at `sha`. */
    private async ownConfig(sha: string, root = this.root): Promise<ProjectConfig | undefined> {
        return parseConfigText(await this.mirror.readFile(sha, join(root, 'template.config.json')));
    }

    /** True when the template at `sha` has no base, so template paths map 1:1 below its root. */
    private async isPlain(sha: string): Promise<boolean> {
        return !(await this.ownConfig(sha))?.template?.extends;
    }

    /** Resolve the template's layers and files at `sha`. Throws on a missing base or an inheritance cycle. */
    layout(sha: string): Promise<TemplateLayout> {
        let p = this.layoutCache.get(sha);
        if (!p) {
            p = this.computeLayout(sha);
            if (isSha(sha)) { this.layoutCache.set(sha, p); }
            p.catch(() => this.layoutCache.delete(sha));
        }
        return p;
    }

    private async computeLayout(sha: string): Promise<TemplateLayout> {
        const all = await this.mirror.listFiles(sha);
        const top = await this.ownConfig(sha);
        const chain: Layer[] = [{ path: this.root, id: top?.template?.id ?? (this.root ? slugId(path.posix.basename(this.root)) : templateIdFromUrl(this.spec.url)), config: top }];
        let cfg = top;
        while (cfg?.template?.extends) {
            const baseId = cfg.template.extends;
            const listing = await this.mirror.listTemplates(sha);
            const base = listing.templates.find(t => t.id === baseId);
            if (!base) { throw new Error(`Template "${cfg.template.id}" extends "${baseId}", which is not a template in this repository.`); }
            if (chain.some(l => l.path === base.path || l.id === base.id)) {
                throw new Error(`Template inheritance cycle: ${[...chain.map(l => l.id), base.id].join(' → ')}.`);
            }
            chain.push({ path: base.path, id: base.id, config: base.config });
            cfg = base.config;
        }
        const layers = chain.reverse();
        const files = new Map<string, string>();
        const overridden = new Set<string>();
        const removed = new Set<string>();
        layers.forEach((layer, i) => {
            const own = filesUnder(all, layer.path);
            if (i > 0) {
                const remove = new Set(layer.config?.template?.remove ?? []);
                const ownComponents = new Set([...own.keys()].map(r => componentOf(r).id));
                const top = i === layers.length - 1;
                for (const rel of [...files.keys()]) {
                    const id = componentOf(rel).id;
                    if (remove.has(id)) {
                        files.delete(rel);
                        if (top) { removed.add(id); }
                    } else if (ownComponents.has(id)) {
                        // A variant that has any file of a component replaces the whole component of its base.
                        files.delete(rel);
                        if (top && !id.startsWith('file:')) { overridden.add(id); }
                    }
                }
            }
            for (const [rel, repoPath] of own) { files.set(rel, repoPath); }
        });
        return { files, layers, overridden, removed };
    }

    /** Map template-relative paths to repository paths at `sha`. */
    private async repoPaths(sha: string, rels: string[]): Promise<Map<string, string>> {
        const out = new Map<string, string>();
        if (await this.isPlain(sha)) {
            for (const r of rels) { out.set(r, join(this.root, r)); }
        } else {
            const layout = await this.layout(sha);
            for (const r of rels) { out.set(r, layout.files.get(r) ?? join(this.root, r)); }
        }
        return out;
    }

    /** Template-relative paths of every file of the template at `sha`. */
    async listFiles(sha: string): Promise<string[]> {
        if (await this.isPlain(sha)) { return [...filesUnder(await this.mirror.listFiles(sha), this.root).keys()]; }
        return [...(await this.layout(sha)).files.keys()];
    }

    async readFiles(sha: string, rels: string[]): Promise<Map<string, string | undefined>> {
        const map = await this.repoPaths(sha, rels);
        const blobs = await this.mirror.readFiles(sha, [...new Set(map.values())]);
        const out = new Map<string, string | undefined>();
        for (const r of rels) { out.set(r, blobs.get(map.get(r)!)); }
        return out;
    }

    async readFile(sha: string, rel: string): Promise<string | undefined> {
        return (await this.readFiles(sha, [rel])).get(rel);
    }

    /** The template's config; a variant without its own "values" uses its base's values. */
    async readConfig(sha: string): Promise<ProjectConfig | undefined> {
        if (this.configCache.has(sha)) { return this.configCache.get(sha); }
        let cfg = await this.ownConfig(sha);
        if (cfg?.template?.extends && !cfg.raw?.values) {
            const layout = await this.layout(sha);
            const base = [...layout.layers].reverse().find(l => l.config?.raw?.values);
            if (base?.config) { cfg = { ...cfg, values: base.config.values, models: { ...base.config.models, ...cfg.models } }; }
        }
        if (isSha(sha)) { this.configCache.set(sha, cfg); }
        return cfg;
    }

    /** Repository pathspecs covering the template (all layers), or the given template-relative paths in every layer. */
    private async pathspecs(sha: string, rels: string[]): Promise<string[]> {
        const layers = (await this.isPlain(sha)) ? [this.root] : (await this.layout(sha)).layers.map(l => l.path);
        if (rels.length) { return [...new Set(layers.flatMap(l => rels.map(r => join(l, r))))]; }
        if (layers.length === 1 && layers[0]) { return [layers[0]]; }
        const all = await this.mirror.listFiles(sha);
        if (layers.length === 1 && !all.some(f => f.startsWith(CATALOG_DIR + '/'))) { return []; }
        // The root template of a catalog: everything except the other templates.
        const tops = [...new Set(all.map(f => f.split('/')[0]).filter(t => t !== CATALOG_DIR))];
        return [...new Set([...tops, ...layers.filter(l => l)])];
    }

    /** Commits (newest first) touching the template (or `rels` in it) reachable from `sha`, optionally only after `since`. */
    async log(sha: string, rels: string[] = [], max = 100, since?: string): Promise<CommitInfo[]> {
        return this.mirror.log(sha, await this.pathspecs(sha, rels), max, since);
    }

    /**
     * One-shot history for many template-relative paths: path -> commits (newest first) that changed it in any layer.
     * Used to infer which template version an un-tracked local file was installed from.
     */
    async fileHistory(sha: string, wanted: Set<string>, maxCommits = 400): Promise<Map<string, string[]>> {
        const layers = (await this.isPlain(sha)) ? [this.root] : (await this.layout(sha)).layers.map(l => l.path);
        const map = new Map<string, string>();
        for (const l of layers) { for (const r of wanted) { map.set(join(l, r), r); } }
        return this.mirror.fileHistory(sha, map, maxCommits);
    }

    /** Export the template's files at `sha` into a folder (used for new projects). */
    async exportTo(sha: string, dest: string): Promise<void> {
        if (!this.root && await this.isPlain(sha)) {
            const hadCatalog = fs.existsSync(path.join(dest, CATALOG_DIR));
            await this.mirror.checkout(sha, dest);
            if (!hadCatalog) { fs.rmSync(path.join(dest, CATALOG_DIR), { recursive: true, force: true }); }
            return;
        }
        const layout = await this.layout(sha);
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-alm-export-'));
        try {
            await this.mirror.checkout(sha, tmp);
            for (const [rel, repoPath] of layout.files) {
                const to = path.join(dest, ...rel.split('/'));
                fs.mkdirSync(path.dirname(to), { recursive: true });
                fs.copyFileSync(path.join(tmp, ...repoPath.split('/')), to);
            }
        } finally {
            safeRemove(tmp);
        }
    }
}

export class TemplateRepoRegistry {
    private repos = new Map<string, TemplateRepo>();
    constructor(private readonly cacheRoot: string) { }

    get(spec: TemplateSourceSpec): TemplateRepo {
        const key = normalizeUrl(sourceKey(spec));
        let r = this.repos.get(key);
        if (!r) {
            r = new TemplateRepo({ ...spec, path: templatePath(spec.path) || undefined }, this.cacheRoot);
            this.repos.set(key, r);
        } else if (spec.ref && r.spec.ref !== spec.ref) {
            (r.spec as TemplateSourceSpec).ref = spec.ref;
        }
        return r;
    }

    /** The shared mirror of a repository (for listing its templates). */
    mirror(url: string): GitMirror {
        return mirrorFor(url, this.cacheRoot);
    }
}
