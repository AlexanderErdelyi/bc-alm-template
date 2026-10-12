import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { catFileBatch, git } from './exec';
import { parseConfig, ProjectConfig } from './config';

export interface TemplateSourceSpec {
    name?: string;
    url: string;
    ref: string;
}

export interface CommitInfo {
    sha: string;
    date: string;
    author: string;
    subject: string;
}

/**
 * A local bare mirror of a template repository, kept in the extension's global storage.
 * All reads go through git plumbing (ls-tree / cat-file --batch / log), so nothing is
 * checked out and many sources can be cached cheaply.
 */
export class TemplateRepo {
    readonly gitDir: string;
    private lastFetch = 0;
    private blobCache = new Map<string, string | undefined>();
    private configCache = new Map<string, ProjectConfig | undefined>();

    constructor(readonly spec: TemplateSourceSpec, cacheRoot: string) {
        const key = createHash('sha1').update(spec.url.trim().toLowerCase()).digest('hex').slice(0, 16);
        this.gitDir = path.join(cacheRoot, 'templates', key + '.git');
    }

    get label(): string {
        return this.spec.name || this.spec.url;
    }

    /** Clone (first time) or fetch. `maxAgeMs` skips the fetch when the mirror is fresh enough. */
    async ensure(maxAgeMs = 0): Promise<void> {
        if (!fs.existsSync(path.join(this.gitDir, 'HEAD'))) {
            fs.mkdirSync(path.dirname(this.gitDir), { recursive: true });
            await git(['clone', '--bare', '--quiet', this.spec.url, this.gitDir]);
            this.lastFetch = Date.now();
            return;
        }
        const stamp = path.join(this.gitDir, 'FETCH_HEAD');
        const last = Math.max(this.lastFetch, fs.existsSync(stamp) ? fs.statSync(stamp).mtimeMs : 0);
        if (maxAgeMs > 0 && Date.now() - last < maxAgeMs) { return; }
        await git(['--git-dir', this.gitDir, 'remote', 'set-url', 'origin', this.spec.url], undefined, { allowFailure: true });
        await git(['--git-dir', this.gitDir, 'fetch', '--quiet', '--prune', '--force', 'origin',
            '+refs/heads/*:refs/heads/*', '+refs/tags/*:refs/tags/*']);
        this.lastFetch = Date.now();
    }

    async resolve(ref: string = this.spec.ref): Promise<string> {
        const r = await git(['--git-dir', this.gitDir, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`], undefined, { allowFailure: true });
        if (r.code === 0 && r.stdout.trim()) { return r.stdout.trim(); }
        const r2 = await git(['--git-dir', this.gitDir, 'rev-parse', '--verify', `refs/heads/${ref}^{commit}`]);
        return r2.stdout.trim();
    }

    async hasCommit(sha: string): Promise<boolean> {
        const r = await git(['--git-dir', this.gitDir, 'cat-file', '-e', `${sha}^{commit}`], undefined, { allowFailure: true });
        return r.code === 0;
    }

    async listFiles(sha: string): Promise<string[]> {
        const r = await git(['--git-dir', this.gitDir, 'ls-tree', '-r', '--name-only', '-z', sha]);
        return r.stdout.split('\0').filter(x => x);
    }

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
                this.blobCache.set(k, v);
                out.set(k.slice(sha.length + 1), v);
            }
        }
        return out;
    }

    async readFile(sha: string, p: string): Promise<string | undefined> {
        return (await this.readFiles(sha, [p])).get(p);
    }

    async readConfig(sha: string): Promise<ProjectConfig | undefined> {
        if (this.configCache.has(sha)) { return this.configCache.get(sha); }
        const text = await this.readFile(sha, 'template.config.json');
        let cfg: ProjectConfig | undefined;
        try { cfg = text ? parseConfig(JSON.parse(text.replace(/^\uFEFF/, ''))) : undefined; } catch { cfg = undefined; }
        this.configCache.set(sha, cfg);
        return cfg;
    }

    /** Commits (newest first) touching `paths` reachable from `sha`, optionally only after `since`. */
    async log(sha: string, paths: string[] = [], max = 100, since?: string): Promise<CommitInfo[]> {
        const range = since ? `${since}..${sha}` : sha;
        const args = ['--git-dir', this.gitDir, 'log', `--max-count=${max}`, '--format=%H%x1f%cI%x1f%an%x1f%s', range];
        if (paths.length) { args.push('--', ...paths); }
        const r = await git(args, undefined, { allowFailure: true });
        if (r.code !== 0) { return []; }
        return r.stdout.split('\n').filter(l => l.trim()).map(l => {
            const [s, date, author, subject] = l.split('\x1f');
            return { sha: s, date, author, subject };
        });
    }

    /**
     * One-shot history for many paths: path -> commits (newest first) that changed it.
     * Used to infer which template version an un-tracked local file was installed from.
     */
    async fileHistory(sha: string, wanted: Set<string>, maxCommits = 400): Promise<Map<string, string[]>> {
        const out = new Map<string, string[]>();
        if (wanted.size === 0) { return out; }
        const r = await git(['--git-dir', this.gitDir, 'log', `--max-count=${maxCommits}`, '--no-renames', '--name-only', '--format=%x01%H', sha], undefined, { allowFailure: true });
        if (r.code !== 0) { return out; }
        let current = '';
        for (const line of r.stdout.split('\n')) {
            if (line.startsWith('\x01')) { current = line.slice(1).trim(); continue; }
            const p = line.trim();
            if (!p || !current || !wanted.has(p)) { continue; }
            const list = out.get(p) ?? [];
            list.push(current);
            out.set(p, list);
        }
        return out;
    }

    async isAncestor(a: string, b: string): Promise<boolean> {
        const r = await git(['--git-dir', this.gitDir, 'merge-base', '--is-ancestor', a, b], undefined, { allowFailure: true });
        return r.code === 0;
    }

    /** Export a commit's full tree into an empty folder (used for new projects). */
    async exportTo(sha: string, dest: string): Promise<void> {
        fs.mkdirSync(dest, { recursive: true });
        await git(['--git-dir', this.gitDir, '--work-tree', dest, 'checkout', '--force', sha, '--', '.']);
        // `checkout -- .` on a bare repo with a work-tree updates the bare index; reset it so the cache stays clean.
        await git(['--git-dir', this.gitDir, 'read-tree', '--empty'], undefined, { allowFailure: true });
    }
}

export class TemplateRepoRegistry {
    private repos = new Map<string, TemplateRepo>();
    constructor(private readonly cacheRoot: string) { }

    get(spec: TemplateSourceSpec): TemplateRepo {
        const key = spec.url.trim().toLowerCase();
        let r = this.repos.get(key);
        if (!r) {
            r = new TemplateRepo(spec, this.cacheRoot);
            this.repos.set(key, r);
        } else if (spec.ref && r.spec.ref !== spec.ref) {
            (r.spec as TemplateSourceSpec).ref = spec.ref;
        }
        return r;
    }
}
