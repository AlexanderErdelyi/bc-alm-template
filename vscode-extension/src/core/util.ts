import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/** Normalize text for hashing/comparison: strip BOM, CRLF/CR -> LF. */
export function normalizeText(text: string): string {
    if (text.charCodeAt(0) === 0xfeff) { text = text.slice(1); }
    return text.replace(/\r\n?/g, '\n');
}

/** sha256 (lowercase hex) of the LF-normalized UTF-8 text. Mirrors Get-NormHash in Update-FromTemplate.ps1. */
export function hashText(text: string): string {
    return createHash('sha256').update(normalizeText(text), 'utf8').digest('hex');
}

export function toPosix(p: string): string {
    return p.replace(/\\/g, '/');
}

export function joinRel(...parts: string[]): string {
    return parts.filter(p => p && p !== '.').join('/').replace(/\/+/g, '/');
}

export function readTextIfExists(file: string): string | undefined {
    try {
        return fs.readFileSync(file, 'utf8');
    } catch {
        return undefined;
    }
}

export function detectEol(text: string | undefined): '\n' | '\r\n' {
    return text && /\r\n/.test(text) ? '\r\n' : '\n';
}

/** Write text, preserving the line-ending style of an existing file (if any). */
export function writeTextPreservingEol(file: string, text: string, eolHint?: string): void {
    const existing = readTextIfExists(file);
    const eol = existing !== undefined ? detectEol(existing) : (eolHint === '\r\n' ? '\r\n' : '\n');
    let out = normalizeText(text);
    if (eol === '\r\n') { out = out.replace(/\n/g, '\r\n'); }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, out, 'utf8');
}

export function listFilesRecursive(dir: string, base = dir): string[] {
    const out: string[] = [];
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { out.push(...listFilesRecursive(full, base)); }
        else if (e.isFile()) { out.push(toPosix(path.relative(base, full))); }
    }
    return out;
}

export function removeEmptyParents(file: string, stopAt: string): void {
    let dir = path.dirname(file);
    const stop = path.resolve(stopAt);
    while (path.resolve(dir).startsWith(stop) && path.resolve(dir) !== stop) {
        try {
            if (fs.readdirSync(dir).length > 0) { return; }
            fs.rmdirSync(dir);
        } catch {
            return;
        }
        dir = path.dirname(dir);
    }
}

function clearReadOnly(dir: string): void {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
        const full = path.join(dir, e.name);
        try { fs.chmodSync(full, 0o666); } catch { /* best effort */ }
        if (e.isDirectory()) { clearReadOnly(full); }
    }
}

/**
 * Remove a temporary directory without ever throwing. On Windows git leaves read-only pack files
 * and child processes may still hold handles for a moment, which makes a plain rmSync fail with
 * EPERM/EBUSY - that must never mask the result of the operation that used the directory.
 */
export function safeRemove(dir: string, log?: (line: string) => void): boolean {
    if (!fs.existsSync(dir)) { return true; }
    const attempt = () => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    try {
        attempt();
        return true;
    } catch {
        clearReadOnly(dir);
        try {
            attempt();
            return true;
        } catch (e) {
            log?.(`Warning: could not remove temporary folder ${dir} (${(e as Error).message}). It will be cleaned up later.`);
            return false;
        }
    }
}

/** Remove leftover temporary folders (from earlier runs that could not clean up) older than maxAgeMs. */
export function sweepStale(root: string, prefix: string, maxAgeMs: number, now = Date.now()): number {
    let removed = 0;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return 0; }
    for (const e of entries) {
        if (!e.isDirectory() || !e.name.startsWith(prefix)) { continue; }
        const full = path.join(root, e.name);
        try {
            if (now - fs.statSync(full).mtimeMs < maxAgeMs) { continue; }
        } catch { continue; }
        if (safeRemove(full)) { removed++; }
    }
    return removed;
}

export function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Normalize a git URL / path for equality checks (case-insensitive, no trailing .git or slash).
 * A source key ("url#path", see sourceKey) keeps its template path.
 */
export function normalizeUrl(url: string): string {
    const i = url.indexOf('#');
    const base = toPosix((i >= 0 ? url.slice(0, i) : url).trim()).replace(/\/+$/, '').replace(/\.git$/i, '').toLowerCase();
    const p = i >= 0 ? templatePath(url.slice(i + 1)).toLowerCase() : '';
    return p ? `${base}#${p}` : base;
}

/** Folder of a template inside its repository ('' = repository root), posix, without leading ./ or slashes. */
export function templatePath(p: string | undefined): string {
    return toPosix((p ?? '').trim()).replace(/^(\.\/)+/, '').replace(/^\/+|\/+$/g, '').replace(/^\.$/, '');
}

/** Identity of a template source: its URL, plus "#<path>" for a template in a subfolder of a catalog repository. */
export function sourceKey(s: { url: string; path?: string }): string {
    const p = templatePath(s.path);
    return p ? `${s.url}#${p}` : s.url;
}

/** Inverse of sourceKey. */
export function splitSourceKey(key: string): { url: string; path: string } {
    const i = key.indexOf('#');
    return i >= 0 ? { url: key.slice(0, i), path: templatePath(key.slice(i + 1)) } : { url: key, path: '' };
}

/** Same URL or source key (a key with "#path" only equals the same key). */
export function sameUrl(a: string | undefined, b: string | undefined): boolean {
    return !!a && !!b && normalizeUrl(a) === normalizeUrl(b);
}

/** Same template source (URL and template path). */
export function sameSource(a: { url: string; path?: string } | undefined, b: { url: string; path?: string } | undefined): boolean {
    return !!a && !!b && sameUrl(sourceKey(a), sourceKey(b));
}

/** Same repository, ignoring the template path. */
export function sameRepo(a: string | undefined, b: string | undefined): boolean {
    return !!a && !!b && sameUrl(splitSourceKey(a).url, splitSourceKey(b).url);
}

export function timestamp(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
