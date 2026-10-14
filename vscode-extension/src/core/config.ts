import * as fs from 'fs';
import * as path from 'path';
import { statePath, stateDirOf } from './layout';

export interface SyncInclude {
    metaDocs: boolean;
    referenceDocs: boolean;
    issueOps: boolean;
    specs: boolean;
    prTemplate: boolean;
    sampleApp?: boolean;
}

export interface ComponentPolicy {
    /** Component ids that are turned off in this project (never installed or re-added by a sync). */
    disabled: string[];
    /** Component ids pinned to the local version (excluded from sync, but still shown with upstream status). */
    keepLocal: string[];
}

export interface TemplatePolicy {
    /** Template ids whose Copilot customizations (agents, skills, prompts, instructions) are switched off. */
    disabled: string[];
}

/** Identity of a template repository (top-level "template" block of its template.config.json). */
export interface TemplateManifest {
    id: string;
    name: string;
    description?: string;
    version?: string;
    /** Codicon id (without "$(...)"). */
    icon?: string;
}

/** Kinds that switch off with their template. Docs, workflows and scripts stay so the project keeps working. */
export const TEMPLATE_TOGGLE_KINDS: readonly string[] = ['agent', 'skill', 'prompt', 'instruction'];

export interface SyncConfig {
    customizationsPath: string;
    syncWorkflow: boolean;
    updateModels: boolean;
    updateExtensions: boolean;
    updateInstructions: boolean;
    include: SyncInclude;
    components: ComponentPolicy;
    templates: TemplatePolicy;
    /** Not persisted: '.bc-alm' when the project keeps its BC ALM files in .bc-alm/, '' for the root layout. */
    stateDir: string;
}

export interface ExtraTools {
    all: string[];
    agents: Record<string, string[] | string>;
    prompts: Record<string, string[] | string>;
}

export interface TemplateValues {
    appPrefix: string;
    /** undefined = not configured (keep template's); '' = bare IDs */
    ticketPrefix?: string;
    appName?: string;
    publisher?: string;
    objectIdFrom: number;
    objectIdTo: number;
    repoSlug: string;
    adoOrg: string;
    adoProject?: string;
    workItemSystem: 'ADO' | 'GitHub' | string;
    defaultBranch?: string;
    [key: string]: unknown;
}

export interface ProjectConfig {
    raw: any;
    initialized: boolean;
    values: TemplateValues;
    sync: SyncConfig;
    extraTools: ExtraTools;
    models: Record<string, string>;
    /** The "template" identity block, when this config belongs to a template repository. */
    template?: TemplateManifest;
}

export const CONFIG_FILE = 'template.config.json';

export function defaultSync(): SyncConfig {
    return {
        customizationsPath: '.',
        syncWorkflow: true,
        updateModels: false,
        updateExtensions: false,
        updateInstructions: true,
        include: { metaDocs: true, referenceDocs: true, issueOps: true, specs: true, prTemplate: true },
        components: { disabled: [], keepLocal: [] },
        templates: { disabled: [] },
        stateDir: ''
    };
}

function asStringArray(v: unknown): string[] {
    if (Array.isArray(v)) { return v.map(x => String(x)).filter(x => x.length > 0); }
    if (typeof v === 'string' && v) { return [v]; }
    return [];
}

/** Lower-case, dash-separated id ("BC Upgrade" -> "bc-upgrade"). */
export function slugId(s: string): string {
    return s.trim().toLowerCase().replace(/\.git$/, '').replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'template';
}

/** Fallback template id for a source without a manifest: the repository (or folder) name. */
export function templateIdFromUrl(url: string): string {
    const parts = url.trim().replace(/[\\/]+$/, '').split(/[\\/:]/);
    return slugId(parts[parts.length - 1] ?? url);
}

function parseManifestBlock(t: any): TemplateManifest | undefined {
    if (!t || typeof t !== 'object' || (!t.id && !t.name)) { return undefined; }
    const str = (v: unknown) => typeof v === 'string' && v.trim() ? v.trim() : undefined;
    const name = str(t.name) ?? String(t.id);
    return {
        id: slugId(str(t.id) ?? name),
        name,
        description: str(t.description),
        version: str(t.version) ?? (typeof t.version === 'number' ? String(t.version) : undefined),
        icon: str(t.icon)?.replace(/^\$\(|\)$/g, '')
    };
}

/** The manifest of a template source, falling back to the repository name when the config has no "template" block. */
export function manifestOf(cfg: ProjectConfig | undefined, url: string, displayName?: string): TemplateManifest {
    if (cfg?.template) { return cfg.template; }
    const id = templateIdFromUrl(url);
    return { id, name: displayName || id };
}

/** Parse a template.config.json object (from a project or from a template source). */
export function parseConfig(raw: any): ProjectConfig {
    const v = (raw && raw.values) || {};
    const sync = defaultSync();
    const s = v.sync || {};
    if (typeof s.customizationsPath === 'string' && s.customizationsPath) { sync.customizationsPath = s.customizationsPath; }
    for (const k of ['syncWorkflow', 'updateModels', 'updateExtensions', 'updateInstructions'] as const) {
        if (typeof s[k] === 'boolean') { sync[k] = s[k]; }
    }
    if (s.include && typeof s.include === 'object') {
        for (const k of Object.keys(sync.include) as (keyof SyncInclude)[]) {
            if (typeof s.include[k] === 'boolean') { (sync.include as any)[k] = s.include[k]; }
        }
        if (typeof s.include.sampleApp === 'boolean') { sync.include.sampleApp = s.include.sampleApp; }
    }
    if (s.components && typeof s.components === 'object') {
        sync.components.disabled = asStringArray(s.components.disabled);
        sync.components.keepLocal = asStringArray(s.components.keepLocal);
    }
    if (s.templates && typeof s.templates === 'object') {
        sync.templates.disabled = asStringArray(s.templates.disabled).map(slugId);
    }
    const et = v.extraTools || {};
    const extraTools: ExtraTools = {
        all: asStringArray(et.all),
        agents: (et.agents && typeof et.agents === 'object') ? et.agents : {},
        prompts: (et.prompts && typeof et.prompts === 'object') ? et.prompts : {}
    };
    const models: Record<string, string> = {};
    if (raw && raw.models && typeof raw.models === 'object') {
        for (const [k, val] of Object.entries(raw.models)) {
            if (k.startsWith('_') || typeof val !== 'string') { continue; }
            models[k] = val;
        }
    }
    const values: TemplateValues = {
        ...v,
        appPrefix: String(v.appPrefix ?? ''),
        ticketPrefix: v.ticketPrefix === undefined || v.ticketPrefix === null ? undefined : String(v.ticketPrefix),
        objectIdFrom: Number(v.objectIdFrom ?? 0),
        objectIdTo: Number(v.objectIdTo ?? 0),
        repoSlug: String(v.repoSlug ?? ''),
        adoOrg: String(v.adoOrg ?? ''),
        workItemSystem: String(v.workItemSystem ?? 'ADO')
    };
    return { raw, initialized: !!(raw && raw.initialized), values, sync, extraTools, models, template: parseManifestBlock(raw?.template) };
}

export function readProjectConfig(root: string): ProjectConfig | undefined {
    const stateDir = stateDirOf(root);
    const file = statePath(root, CONFIG_FILE, stateDir);
    if (!fs.existsSync(file)) { return undefined; }
    const text = fs.readFileSync(file, 'utf8');
    const cfg = parseConfig(JSON.parse(text.replace(/^\uFEFF/, '')));
    cfg.sync.stateDir = stateDir;
    return cfg;
}

/** Custom-izations root ('' = repo root). Mirrors $custRoot in the PowerShell scripts. */
export function custRoot(sync: SyncConfig): string {
    const p = (sync.customizationsPath || '.').trim().replace(/[\\/]+$/, '');
    return p === '.' || p === '' ? '' : p.replace(/\\/g, '/');
}

/**
 * Update the component policy (values.sync.components) in template.config.json,
 * preserving every other key and the 2-space formatting the scripts use.
 */
export function writeComponentPolicy(root: string, policy: ComponentPolicy): void {
    updateSyncBlock(root, sync => {
        sync.components = {
            disabled: [...new Set(policy.disabled)].sort(),
            keepLocal: [...new Set(policy.keepLocal)].sort()
        };
    });
}

/** Update values.sync.templates (template ids switched off in this project). */
export function writeTemplatePolicy(root: string, policy: TemplatePolicy): void {
    updateSyncBlock(root, sync => {
        const disabled = [...new Set(policy.disabled.map(slugId))].sort();
        if (disabled.length) { sync.templates = { ...(sync.templates || {}), disabled }; } else { delete sync.templates; }
    });
}

function updateSyncBlock(root: string, mutate: (sync: any) => void): void {
    const file = statePath(root, CONFIG_FILE);
    const original = fs.readFileSync(file, 'utf8');
    const raw = JSON.parse(original.replace(/^\uFEFF/, ''));
    raw.values = raw.values || {};
    raw.values.sync = raw.values.sync || {};
    mutate(raw.values.sync);
    const eol = /\r\n/.test(original) ? '\r\n' : '\n';
    fs.writeFileSync(file, JSON.stringify(raw, null, 2).replace(/\n/g, eol) + eol, 'utf8');
}
