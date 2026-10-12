import * as fs from 'fs';
import * as path from 'path';
import { commandExists, run } from './exec';

export interface InitValues {
    appPrefix: string;
    ticketPrefix?: string;
    appName?: string;
    publisher?: string;
    objectIdFrom: number;
    objectIdTo: number;
    repoSlug?: string;
    adoOrg?: string;
    adoProject?: string;
    workItemSystem: 'ADO' | 'GitHub';
    defaultBranch?: string;
    extraTools?: string[];
    skipModels?: boolean;
}

export interface NewProjectOptions {
    cleanup: boolean;
    includeMetaDocs?: boolean;
    noReferenceDocs?: boolean;
    noIssueOps?: boolean;
    noSpecs?: boolean;
    noPrTemplate?: boolean;
    noSampleApp?: boolean;
}

export interface ExistingRepoOptions {
    customizationsPath?: string;
    includeMetaDocs?: boolean;
    includeReferenceDocs?: boolean;
    includeIssueOps?: boolean;
    includeSampleApp?: boolean;
    noSpecs?: boolean;
    noPrTemplate?: boolean;
    noSyncWorkflow?: boolean;
    force?: boolean;
}

export async function findPowerShell(configured?: string): Promise<string> {
    const candidates = [configured, 'pwsh', process.platform === 'win32' ? 'powershell' : undefined].filter((c): c is string => !!c);
    for (const c of candidates) {
        if (await commandExists(c, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'])) { return c; }
    }
    throw new Error('PowerShell was not found. Install PowerShell 7 (pwsh) or set "bcAlm.powershellPath".');
}

export function initializeArgs(v: InitValues, o?: NewProjectOptions, existingRepo = false): string[] {
    const a: string[] = [
        '-AppPrefix', v.appPrefix,
        '-ObjectIdFrom', String(v.objectIdFrom),
        '-ObjectIdTo', String(v.objectIdTo),
        '-WorkItemSystem', v.workItemSystem
    ];
    const opt: [string, string | undefined][] = [
        ['-TicketPrefix', v.ticketPrefix], ['-AppName', v.appName], ['-Publisher', v.publisher],
        ['-RepoSlug', v.repoSlug], ['-AdoOrg', v.adoOrg], ['-AdoProject', v.adoProject], ['-DefaultBranch', v.defaultBranch]
    ];
    for (const [k, val] of opt) { if (val) { a.push(k, val); } }
    if (v.extraTools?.length) { a.push('-ExtraTools', v.extraTools.join(',')); }
    if (v.skipModels) { a.push('-SkipModels'); }
    if (existingRepo) {
        a.push('-ExistingRepo');
    } else if (o) {
        a.push('-NewFromTemplate');
        if (o.cleanup) { a.push('-CleanupTemplateFiles'); }
        const sw: [boolean | undefined, string][] = [
            [o.includeMetaDocs, '-IncludeMetaDocs'], [o.noReferenceDocs, '-NoReferenceDocs'], [o.noIssueOps, '-NoIssueOps'],
            [o.noSpecs, '-NoSpecs'], [o.noPrTemplate, '-NoPrTemplate'], [o.noSampleApp, '-NoSampleApp']
        ];
        for (const [on, flag] of sw) { if (on) { a.push(flag); } }
    }
    return a;
}

export function installArgs(target: string, source: string, o: ExistingRepoOptions): string[] {
    const a = ['-TargetRepo', target, '-SourceRoot', source];
    if (o.customizationsPath && o.customizationsPath !== '.') { a.push('-CustomizationsPath', o.customizationsPath); }
    const sw: [boolean | undefined, string][] = [
        [o.includeMetaDocs, '-IncludeMetaDocs'], [o.includeReferenceDocs, '-IncludeReferenceDocs'], [o.includeIssueOps, '-IncludeIssueOps'],
        [o.includeSampleApp, '-IncludeSampleApp'], [o.noSpecs, '-NoSpecs'], [o.noPrTemplate, '-NoPrTemplate'],
        [o.noSyncWorkflow, '-NoSyncWorkflow'], [o.force, '-Force']
    ];
    for (const [on, flag] of sw) { if (on) { a.push(flag); } }
    return a;
}

/**
 * Run a template script non-interactively. Arrays (e.g. -ExtraTools a,b) are passed as a single
 * comma-joined token through -Command so PowerShell binds them as string[].
 */
export async function runScript(pwsh: string, script: string, args: string[], cwd: string, onOutput?: (s: string) => void): Promise<void> {
    if (!fs.existsSync(script)) { throw new Error(`Script not found: ${script}`); }
    const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;
    const parts: string[] = [];
    for (let i = 0; i < args.length; i++) {
        const t = args[i];
        if (t.startsWith('-') && /^-[A-Za-z]+$/.test(t)) { parts.push(t); continue; }
        parts.push(t.includes(',') && args[i - 1] === '-ExtraTools' ? t.split(',').map(quote).join(',') : quote(t));
    }
    const cmd = `$ErrorActionPreference='Stop'; $ConfirmPreference='None'; & ${quote(script)} ${parts.join(' ')}`;
    const r = await run(pwsh, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', cmd], { cwd, onOutput, allowFailure: true });
    if (r.code !== 0) {
        throw new Error(`${path.basename(script)} failed (exit ${r.code}).\n${(r.stderr || r.stdout).trim().split(/\r?\n/).slice(-15).join('\n')}`);
    }
}
