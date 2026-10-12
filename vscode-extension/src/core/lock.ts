import * as fs from 'fs';
import * as path from 'path';
import { statePath } from './layout';
import { normalizeUrl } from './util';

export const LOCK_FILE = 'template.lock.json';

export interface LockSource {
    name?: string;
    url: string;
    ref: string;
}

export interface LockEntry {
    /** Template source URL the file is tracked from. */
    source: string;
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

export function readLock(root: string): LockFile | undefined {
    const file = statePath(root, LOCK_FILE);
    if (!fs.existsSync(file)) { return undefined; }
    try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
        return {
            version: 1,
            sources: Array.isArray(raw.sources) ? raw.sources.filter((s: any) => s && s.url).map((s: any) => ({ name: s.name, url: String(s.url), ref: String(s.ref || 'main') })) : [],
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
        sortedFiles[k] = { source: e.source, path: e.path, commit: e.commit, templateHash: e.templateHash, installedHash: e.installedHash };
    }
    const out = {
        $comment: 'Managed by the BC ALM VS Code extension and scripts/Update-FromTemplate.ps1. Records which template version each template-managed file came from so updates never silently overwrite your own changes. Commit this file.',
        version: 1,
        sources: lock.sources,
        files: sortedFiles
    };
    fs.writeFileSync(statePath(root, LOCK_FILE), JSON.stringify(out, null, 2) + '\n', 'utf8');
}

export function ensureSource(lock: LockFile, src: LockSource, primary = false): void {
    const i = lock.sources.findIndex(s => normalizeUrl(s.url) === normalizeUrl(src.url));
    if (i >= 0) {
        lock.sources[i] = { ...lock.sources[i], ...src };
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
