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

export function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Normalize a git URL / path for equality checks (case-insensitive, no trailing .git or slash). */
export function normalizeUrl(url: string): string {
    return toPosix(url.trim()).replace(/\/+$/, '').replace(/\.git$/i, '').toLowerCase();
}

export function sameUrl(a: string | undefined, b: string | undefined): boolean {
    return !!a && !!b && normalizeUrl(a) === normalizeUrl(b);
}

export function timestamp(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
