/**
 * Minimal YAML-frontmatter reader for Copilot customization files. It understands the
 * subset these files use: scalars (plain/quoted), inline arrays, block lists (of scalars
 * or flat maps) and folded/literal block scalars. It never rewrites the file; edits are
 * done with targeted line replacements so author formatting survives.
 */
export interface FrontmatterKey {
    key: string;
    line: number; // 0-based line in the file
    value: unknown;
    rawValue: string;
}

export interface Frontmatter {
    present: boolean;
    data: Record<string, unknown>;
    keys: FrontmatterKey[];
    /** 0-based line of the opening '---' (always 0 when present) and closing '---'. */
    endLine: number;
    body: string;
    bodyStartLine: number;
    error?: string;
}

export function unquote(s: string): string {
    const t = s.trim();
    if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
        const inner = t.slice(1, -1);
        return t.startsWith('"') ? inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\') : inner.replace(/''/g, "'");
    }
    return t;
}

function stripComment(s: string): string {
    let q: string | null = null;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (q) { if (c === q) { q = null; } continue; }
        if (c === '"' || c === "'") { q = c; continue; }
        if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) { return s.slice(0, i).trimEnd(); }
    }
    return s;
}

export function parseInlineArray(s: string): string[] {
    const t = s.trim();
    if (!t.startsWith('[') || !t.endsWith(']')) { return []; }
    const inner = t.slice(1, -1);
    const out: string[] = [];
    let cur = '';
    let q: string | null = null;
    for (const c of inner) {
        if (q) { cur += c; if (c === q) { q = null; } continue; }
        if (c === '"' || c === "'") { q = c; cur += c; continue; }
        if (c === ',') { if (cur.trim()) { out.push(unquote(cur)); } cur = ''; continue; }
        cur += c;
    }
    if (cur.trim()) { out.push(unquote(cur)); }
    return out;
}

function parseScalar(raw: string): unknown {
    const t = stripComment(raw).trim();
    if (t.startsWith('[')) { return parseInlineArray(t); }
    if (t === 'true') { return true; }
    if (t === 'false') { return false; }
    if (/^-?\d+(\.\d+)?$/.test(t)) { return Number(t); }
    return unquote(t);
}

export function parseFrontmatter(text: string): Frontmatter {
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
    const empty: Frontmatter = { present: false, data: {}, keys: [], endLine: -1, body: text, bodyStartLine: 0 };
    if (lines[0]?.trim() !== '---') { return empty; }
    let end = -1;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === '---') { end = i; break; }
    }
    if (end < 0) { return { ...empty, present: true, error: 'Frontmatter is not closed with a "---" line.' }; }

    const data: Record<string, unknown> = {};
    const keys: FrontmatterKey[] = [];
    let i = 1;
    while (i < end) {
        const line = lines[i];
        const m = /^([A-Za-z0-9_.-]+)\s*:(.*)$/.exec(line);
        if (!m) { i++; continue; }
        const key = m[1];
        const rest = m[2];
        const keyLine = i;
        let value: unknown;
        const restTrim = stripComment(rest).trim();
        if (restTrim === '' || restTrim === '|' || restTrim === '>' || /^[|>][+-]?$/.test(restTrim)) {
            // Block: list, map or block scalar.
            const block: string[] = [];
            i++;
            while (i < end && (lines[i].trim() === '' || /^\s/.test(lines[i]))) { block.push(lines[i]); i++; }
            if (restTrim.startsWith('|') || restTrim.startsWith('>')) {
                const nonEmpty = block.filter(b => b.trim());
                const indent = Math.min(...nonEmpty.map(b => b.length - b.trimStart().length));
                const parts = block.map(b => b.slice(Number.isFinite(indent) ? indent : 0));
                value = restTrim.startsWith('>') ? parts.join(' ').replace(/\s+/g, ' ').trim() : parts.join('\n').trim();
            } else if (block.some(b => /^\s*-\s/.test(b) || /^\s*-$/.test(b))) {
                const items: unknown[] = [];
                let curObj: Record<string, unknown> | null = null;
                for (const b of block) {
                    if (!b.trim()) { continue; }
                    const li = /^\s*-\s*(.*)$/.exec(b);
                    if (li) {
                        const body = li[1];
                        const kv = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(body);
                        if (kv && !/^["']/.test(body)) {
                            curObj = { [kv[1]]: parseScalar(kv[2]) };
                            items.push(curObj);
                        } else {
                            curObj = null;
                            items.push(parseScalar(body));
                        }
                    } else if (curObj) {
                        const kv = /^\s*([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(b);
                        if (kv) { curObj[kv[1]] = parseScalar(kv[2]); }
                    }
                }
                value = items;
            } else {
                const obj: Record<string, unknown> = {};
                for (const b of block) {
                    const kv = /^\s*([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(b);
                    if (kv) { obj[kv[1]] = parseScalar(kv[2]); }
                }
                value = obj;
            }
        } else {
            value = parseScalar(rest);
            i++;
            // Plain multi-line scalar continuation (indented lines).
            while (i < end && /^\s+\S/.test(lines[i]) && typeof value === 'string' && !/^["'[]/.test(restTrim)) {
                value = `${value} ${lines[i].trim()}`;
                i++;
            }
        }
        data[key] = value;
        keys.push({ key, line: keyLine, value, rawValue: rest.trim() });
    }
    const body = lines.slice(end + 1).join('\n');
    return { present: true, data, keys, endLine: end, body, bodyStartLine: end + 1 };
}

export function fmString(fm: Frontmatter, key: string): string | undefined {
    const v = fm.data[key];
    return typeof v === 'string' ? v : undefined;
}

/** Replace (or insert) a scalar frontmatter key, preserving everything else. */
export function setFrontmatterScalar(text: string, key: string, value: string): string {
    const eol = /\r\n/.test(text) ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    const fm = parseFrontmatter(text);
    const quoted = `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    if (!fm.present) {
        return ['---', `${key}: ${quoted}`, '---', ...lines].join(eol);
    }
    const k = fm.keys.find(x => x.key === key);
    if (k) {
        lines[k.line] = `${key}: ${quoted}`;
    } else {
        lines.splice(1, 0, `${key}: ${quoted}`);
    }
    return lines.join(eol);
}

/** Rename a frontmatter key in place (e.g. legacy 'mode' -> 'agent'). */
export function renameFrontmatterKey(text: string, from: string, to: string): string {
    const eol = /\r\n/.test(text) ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    const fm = parseFrontmatter(text);
    const k = fm.keys.find(x => x.key === from);
    if (!k) { return text; }
    lines[k.line] = lines[k.line].replace(new RegExp(`^${from}(\\s*:)`), `${to}$1`);
    return lines.join(eol);
}
