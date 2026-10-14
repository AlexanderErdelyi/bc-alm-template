import * as fs from 'fs';
import * as path from 'path';
import { statePath } from './layout';
import { sameSource, templatePath } from './util';

export const LOCK_FILE = 'template.lock.json';

export interface LockSource {
    name?: string;
    /** Template id (manifest id) of this source. */
    id?: string;
    url: string;
    ref: string;
    /** Template folder inside a catalog repository (e.g. ".templates/bc-upgrade"); omitted for the repository root. */
    path?: string;
    /** Component ids deliberately not taken from this source ("Manage Components"). */
    exclude?: string[];
}

export interface LockEntry {
    /** Source key the file is tracked from: the template URL, plus "#<path>" for a template in a catalog folder. */
    source: string;
    /** Template id of that source (lets the sync script and the views group files by template). */
    template?: string;
    /** Template-relative path (may differ from the destination when customizationsPath relocates it). */
    path: string;
    /** Template commit the installed content was derived from. */
    commit: string;
    /** Hash of the RAW template file at that commit (LF-normalized sha256). */
    templateHash: string;
    /** Hash of the project file right after it was installed/updated. */
    installedHash: string;
}

export interface LockFile {
    version: 1;
    /** Template sources used by this project; the first is the primary (used by the GitHub Action). */
    sources: LockSource[];
    /** Keyed by project-relative destination path (posix). */
    files: Record<string, LockEntry>;
}

export function emptyLock(): LockFile {
    return { version: 1, sources: [], files: {} };
}

function readSource(s: any): LockSource {
    const out: LockSource = { name: s.name, url: String(s.url), ref: String(s.ref || 'main') };
    if (s.id) { out.id = String(s.id); }
    const p = templatePath(typeof s.path === 'string' ? s.path : '');
    if (p) { out.path = p; }
    if (Array.isArray(s.exclude)) { out.exclude = s.exclude.map((x: unknown) => String(x)).filter((x: string) => x); }
    return out;
}

function writeSource(s: LockSource): LockSource {
    const out: any = {};
    if (s.name !== undefined) { out.name = s.name; }
    if (s.id) { out.id = s.id; }
    out.url = s.url;
    const p = templatePath(s.path);
    if (p) { out.path = p; }
    out.ref = s.ref;
    if (s.exclude) { out.exclude = [...new Set(s.exclude)].sort(); }
    return out;
}

export function readLock(root: string): LockFile | undefined {
    const file = statePath(root, LOCK_FILE);
    if (!fs.existsSync(file)) { return undefined; }
    try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
        return {
            version: 1,
            sources: Array.isArray(raw.sources) ? raw.sources.filter((s: any) => s && s.url).map(readSource) : [],
            files: raw.files && typeof raw.files === 'object' ? raw.files : {}
        };
    } catch {
        return undefined;
    }
}

export function writeLock(root: string, lock: LockFile): void {
    const sortedFiles: Record<string, LockEntry> = {};
    for (const k of Object.keys(lock.files).sort()) {
        const e = lock.files[k];
        sortedFiles[k] = { source: e.source, ...(e.template ? { template: e.template } : {}), path: e.path, commit: e.commit, templateHash: e.templateHash, installedHash: e.installedHash };
    }
    const out = {
        $comment: 'Managed by the BC ALM VS Code extension and scripts/Update-FromTemplate.ps1. Records which template version each template-managed file came from so updates never silently overwrite your own changes. Commit this file.',
        version: 1,
        sources: lock.sources.map(writeSource),
        files: sortedFiles
    };
    fs.writeFileSync(statePath(root, LOCK_FILE), JSON.stringify(out, null, 2) + '\n', 'utf8');
}

export function ensureSource(lock: LockFile, src: LockSource, primary = false): void {
    const i = lock.sources.findIndex(s => sameSource(s, src));
    if (i >= 0) {
        const merged = { ...lock.sources[i], ...src };
        // Keep the recorded selection unless the caller sets one explicitly.
        if (src.exclude === undefined && lock.sources[i].exclude) { merged.exclude = lock.sources[i].exclude; }
        if (!src.id && lock.sources[i].id) { merged.id = lock.sources[i].id; }
        lock.sources[i] = merged;
        if (primary && i > 0) {
            const [s] = lock.sources.splice(i, 1);
            lock.sources.unshift(s);
        }
    } else if (primary) {
        lock.sources.unshift(src);
    } else {
        lock.sources.push(src);
    }
}
