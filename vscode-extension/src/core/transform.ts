import { ProjectConfig, TemplateValues } from './config';
import { isReparamTarget, componentOf } from './paths';
import { escapeRegExp, normalizeText } from './util';

/**
 * The forward transform turns a raw template file into what this project should contain.
 * It mirrors scripts/Update-FromTemplate.ps1 step by step (Reparameterize -> Restore-Models
 * -> Trim-WorkItemTools -> Merge-ExtraTools) so the extension and the GitHub Action
 * produce byte-identical (LF-normalized) results.
 */
export interface TransformContext {
    /** values from the TEMPLATE's template.config.json at the commit being transformed */
    from: TemplateValues;
    project: ProjectConfig;
}

function toValue<T>(project: TemplateValues, key: string, fallback: T): T {
    const v = (project as any)[key];
    if (v === undefined || v === null || `${v}` === '') { return fallback; }
    return v as T;
}

const WORD = '[\\p{L}\\p{Mn}\\p{Nd}\\p{Pc}]';

/** Regex for `\b<literal>` with .NET (Unicode-aware) word-boundary semantics. */
export function boundaryRegex(literal: string, suffix = ''): RegExp {
    const firstIsWord = new RegExp(`^${WORD}`, 'u').test(literal);
    const look = firstIsWord ? `(?<!${WORD})` : `(?<=${WORD})`;
    return new RegExp(`${look}${escapeRegExp(literal)}${escapeRegExp(suffix)}`, 'gu');
}

export function reparameterize(text: string, from: TemplateValues, to: TemplateValues): string {
    const fromPrefix = String(from.appPrefix ?? '');
    const fromTicket = String(from.ticketPrefix ?? '');
    const fromSlug = String(from.repoSlug ?? '');
    const fromOrg = String(from.adoOrg ?? '');
    const fromFrom = Number(from.objectIdFrom);
    const fromTo = Number(from.objectIdTo);

    const toPrefix = String(toValue(to, 'appPrefix', fromPrefix));
    // Same as the PowerShell sync: an empty project value falls back to the template's value.
    const toTicket = String(toValue(to, 'ticketPrefix', fromTicket));
    const toSlug = String(toValue(to, 'repoSlug', fromSlug));
    const toOrg = String(toValue(to, 'adoOrg', fromOrg));
    const toFrom = Number(toValue(to, 'objectIdFrom', fromFrom));
    const toTo = Number(toValue(to, 'objectIdTo', fromTo));
    const wis = String(toValue(to, 'workItemSystem', 'ADO'));

    let s = text;
    if (fromSlug) { s = s.split(fromSlug).join(toSlug); }
    if (fromOrg) { s = s.split(fromOrg).join(toOrg); }
    if (fromTicket) {
        const repl = toTicket ? `${toTicket}-` : '';
        s = s.replace(boundaryRegex(fromTicket, '-'), () => repl);
    }
    if (fromPrefix) { s = s.replace(boundaryRegex(fromPrefix), () => toPrefix); }
    if (toFrom !== fromFrom || toTo !== fromTo) {
        for (const dash of ['-', '\u2013', '\u2014']) {
            s = s.split(`${fromFrom}${dash}${fromTo}`).join(`${toFrom}-${toTo}`);
        }
    }
    if (wis === 'GitHub') { s = s.split('AB#').join('#'); }
    return s;
}

export function applyModel(text: string, model: string): string {
    return text.replace(/^model:\s*.*$/gm, () => `model: "${model}"`);
}

export function trimAzureDevOpsTools(text: string): string {
    return text.split(", 'azure-devops/*'").join('').split("'azure-devops/*', ").join('').split("'azure-devops/*'").join('');
}

const TOOLS_RE = /^tools:\s*\[(.*)\]\s*$/m;

export function parseToolsLine(text: string): string[] | undefined {
    const m = TOOLS_RE.exec(text);
    if (!m) { return undefined; }
    return m[1].split(',').map(t => t.trim().replace(/^['"]+|['"]+$/g, '')).filter(t => t);
}

function splitTools(list: (string | string[])[]): string[] {
    const out: string[] = [];
    for (const e of list.flat()) {
        for (const p of String(e).split(/\s*,\s*/)) {
            const t = p.trim().replace(/^['"]+|['"]+$/g, '');
            if (t) { out.push(t); }
        }
    }
    return out;
}

export function addTools(text: string, extra: string[]): string {
    if (extra.length === 0) { return text; }
    const m = TOOLS_RE.exec(text);
    if (!m) { return text; }
    const existing = m[1].split(',').map(t => t.trim().replace(/^['"]+|['"]+$/g, '')).filter(t => t);
    let added = false;
    for (const e of splitTools(extra)) {
        if (!existing.includes(e)) { existing.push(e); added = true; }
    }
    if (!added) { return text; }
    const line = 'tools: [' + existing.map(t => `'${t}'`).join(', ') + ']';
    return text.replace(m[0], () => line);
}

export function removeTools(text: string, remove: string[]): string {
    if (remove.length === 0) { return text; }
    const m = TOOLS_RE.exec(text);
    if (!m) { return text; }
    const existing = m[1].split(',').map(t => t.trim().replace(/^['"]+|['"]+$/g, '')).filter(t => t);
    const kept = existing.filter(t => !remove.includes(t));
    if (kept.length === existing.length) { return text; }
    const line = 'tools: [' + kept.map(t => `'${t}'`).join(', ') + ']';
    return text.replace(m[0], () => line);
}

export function extraToolsFor(project: ProjectConfig, kind: 'agent' | 'prompt', name: string): string[] {
    const per = kind === 'agent' ? project.extraTools.agents : project.extraTools.prompts;
    const list: (string | string[])[] = [...project.extraTools.all];
    if (per && Object.prototype.hasOwnProperty.call(per, name)) { list.push(per[name]); }
    return splitTools(list);
}

/** Transform raw template content for this project (LF-normalized output). */
export function transformTemplateFile(srcRel: string, rawText: string, ctx: TransformContext): string {
    const { project } = ctx;
    let s = normalizeText(rawText);
    if (isReparamTarget(srcRel, project.sync)) {
        s = reparameterize(s, ctx.from, project.values);
    }
    const ref = componentOf(srcRel);
    if (ref.kind === 'agent' && !project.sync.updateModels && project.models[ref.name]) {
        s = applyModel(s, project.models[ref.name]);
    }
    if ((ref.kind === 'agent' || ref.kind === 'prompt') && project.values.workItemSystem === 'GitHub') {
        s = trimAzureDevOpsTools(s);
    }
    if (ref.kind === 'agent' || ref.kind === 'prompt') {
        s = addTools(s, extraToolsFor(project, ref.kind, ref.name));
    }
    return s;
}

export interface GeneralizeResult {
    text: string;
    changes: string[];
}

/**
 * Reverse transform used when publishing a project file back to a template: project values
 * become the target template's placeholders again, project-only extra tools are removed and
 * the target's own model choice is kept. Prose is heuristic — the caller shows a diff first.
 */
export function generalize(srcRel: string, localText: string, project: ProjectConfig, target: TemplateValues, targetExisting?: string): GeneralizeResult {
    const changes: string[] = [];
    let s = normalizeText(localText);
    const ref = componentOf(srcRel);
    const v = project.values;

    if (ref.kind === 'agent' || ref.kind === 'prompt') {
        const keep = targetExisting ? (parseToolsLine(targetExisting) ?? []) : [];
        const extra = extraToolsFor(project, ref.kind, ref.name).filter(t => !keep.includes(t));
        const before = s;
        s = removeTools(s, extra);
        if (s !== before) { changes.push(`removed project-only tools: ${extra.join(', ')}`); }
    }
    if (ref.kind === 'agent' && targetExisting) {
        const tm = /^model:\s*.*$/m.exec(normalizeText(targetExisting));
        if (tm) {
            const before = s;
            s = s.replace(/^model:\s*.*$/gm, () => tm[0]);
            if (s !== before) { changes.push(`kept template model line (${tm[0]})`); }
        }
    }
    if (isReparamTarget(srcRel, project.sync)) {
        const before = s;
        if (v.repoSlug && target.repoSlug && v.repoSlug !== target.repoSlug) { s = s.split(v.repoSlug).join(target.repoSlug); }
        if (v.adoOrg && target.adoOrg && v.adoOrg !== target.adoOrg) { s = s.split(v.adoOrg).join(target.adoOrg); }
        if (v.ticketPrefix && target.ticketPrefix && v.ticketPrefix !== target.ticketPrefix) {
            s = s.replace(boundaryRegex(v.ticketPrefix, '-'), () => `${target.ticketPrefix}-`);
        }
        if (v.appPrefix && target.appPrefix && v.appPrefix !== target.appPrefix) {
            s = s.replace(boundaryRegex(v.appPrefix), () => target.appPrefix);
        }
        if (v.objectIdFrom !== target.objectIdFrom || v.objectIdTo !== target.objectIdTo) {
            s = s.split(`${v.objectIdFrom}-${v.objectIdTo}`).join(`${target.objectIdFrom}-${target.objectIdTo}`);
        }
        if (s !== before) {
            changes.push(`project values -> template placeholders (${[v.appPrefix + '→' + target.appPrefix, v.repoSlug + '→' + target.repoSlug].join(', ')})`);
        }
    }
    return { text: s, changes };
}
