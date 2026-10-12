import * as fs from 'fs';
import * as path from 'path';

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

export interface SyncConfig {
    customizationsPath: string;
    syncWorkflow: boolean;
    updateModels: boolean;
    updateExtensions: boolean;
    updateInstructions: boolean;
    include: SyncInclude;
    components: ComponentPolicy;
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
        components: { disabled: [], keepLocal: [] }
    };
}

function asStringArray(v: unknown): string[] {
    if (Array.isArray(v)) { return v.map(x => String(x)).filter(x => x.length > 0); }
    if (typeof v === 'string' && v) { return [v]; }
    return [];
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
    return { raw, initialized: !!(raw && raw.initialized), values, sync, extraTools, models };
}

export function readProjectConfig(root: string): ProjectConfig | undefined {
    const file = path.join(root, CONFIG_FILE);
    if (!fs.existsSync(file)) { return undefined; }
    const text = fs.readFileSync(file, 'utf8');
    return parseConfig(JSON.parse(text.replace(/^\uFEFF/, '')));
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
    const file = path.join(root, CONFIG_FILE);
    const raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    raw.values = raw.values || {};
    raw.values.sync = raw.values.sync || {};
    raw.values.sync.components = {
        disabled: [...new Set(policy.disabled)].sort(),
        keepLocal: [...new Set(policy.keepLocal)].sort()
    };
    const original = fs.readFileSync(file, 'utf8');
    const eol = /\r\n/.test(original) ? '\r\n' : '\n';
    fs.writeFileSync(file, JSON.stringify(raw, null, 2).replace(/\n/g, eol) + eol, 'utf8');
}
