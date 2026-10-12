import * as fs from 'fs';
import * as path from 'path';
import { git } from './exec';

/** Values an existing AL repository already tells us (app.json, AppSourceCop.json, git). */
export interface DetectedValues {
    appJson?: string;
    appName?: string;
    publisher?: string;
    objectIdFrom?: number;
    objectIdTo?: number;
    appPrefix?: string;
    prefixSource?: string;
    workItemSystem?: 'ADO' | 'GitHub';
    adoOrg?: string;
    adoProject?: string;
    repoSlug?: string;
    defaultBranch?: string;
}

export interface RemoteInfo { kind: 'ADO' | 'GitHub'; adoOrg?: string; adoProject?: string; repoSlug?: string }

/** Parse an Azure DevOps or GitHub remote URL (https or ssh). */
export function parseRemote(url: string): RemoteInfo | undefined {
    const u = url.trim().replace(/\.git$/i, '');
    const dec = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
    let m = /dev\.azure\.com[/:](?:v3\/)?([^/]+)\/([^/]+)\/(?:_git\/)?[^/]+$/i.exec(u);
    if (m) { return { kind: 'ADO', adoOrg: dec(m[1]), adoProject: dec(m[2]) }; }
    m = /^(?:https?:\/\/)?(?:[^@/]+@)?([^./]+)\.visualstudio\.com\/(?:DefaultCollection\/)?([^/]+)\/_git\/[^/]+$/i.exec(u);
    if (m) { return { kind: 'ADO', adoOrg: dec(m[1]), adoProject: dec(m[2]) }; }
    m = /vs-ssh\.visualstudio\.com:v3\/([^/]+)\/([^/]+)\/[^/]+$/i.exec(u);
    if (m) { return { kind: 'ADO', adoOrg: dec(m[1]), adoProject: dec(m[2]) }; }
    m = /github\.com[/:]([\w.-]+)\/([\w.-]+)$/i.exec(u);
    if (m) { return { kind: 'GitHub', repoSlug: `${m[1]}/${m[2]}` }; }
    return undefined;
}

interface AppJson { name?: string; publisher?: string; idRanges?: { from: number; to: number }[]; idRange?: { from: number; to: number } }

function readJson<T>(file: string): T | undefined {
    try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) as T; } catch { return undefined; }
}

const isTestApp = (dir: string, a: AppJson) => /\btests?\b/i.test(a.name ?? '') || /^tests?$/i.test(path.basename(dir));

/** The production app.json: the preferred folder first, then the root, then direct subfolders (test apps last). */
export function findAppJson(root: string, preferred?: string): string | undefined {
    const dirs: string[] = [];
    if (preferred) { dirs.push(preferred); }
    dirs.push(root);
    try {
        for (const d of fs.readdirSync(root, { withFileTypes: true })) {
            if (d.isDirectory() && !d.name.startsWith('.')) { dirs.push(path.join(root, d.name)); }
        }
    } catch { /* unreadable root */ }
    const found = dirs.map(d => ({ d, a: readJson<AppJson>(path.join(d, 'app.json')) })).filter(x => x.a);
    const prod = found.find(x => !isTestApp(x.d, x.a!)) ?? found[0];
    return prod ? path.join(prod.d, 'app.json') : undefined;
}

/** Most common all-caps leading token of AL object names (e.g. "RMG" in table 50100 "RMG Setup"). */
export function guessPrefixFromAl(appDir: string, maxFiles = 300): string | undefined {
    const counts = new Map<string, number>();
    let objects = 0, files = 0;
    const re = /^\s*(?:table|tableextension|page|pageextension|codeunit|report|reportextension|enum|enumextension|query|xmlport|permissionset|interface)\s+(?:\d+\s+)?"?([A-Za-z][A-Za-z0-9]{1,9})[ _"]/gim;
    const walk = (dir: string) => {
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            if (files >= maxFiles) { return; }
            if (e.isDirectory()) {
                if (!e.name.startsWith('.') && e.name !== 'node_modules') { walk(path.join(dir, e.name)); }
            } else if (e.name.toLowerCase().endsWith('.al')) {
                files++;
                const text = fs.readFileSync(path.join(dir, e.name), 'utf8');
                for (const m of text.matchAll(re)) {
                    objects++;
                    if (!/^[A-Z][A-Z0-9]+$/.test(m[1])) { continue; }
                    counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
                }
            }
        }
    };
    walk(appDir);
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return best && best[1] >= 3 && best[1] * 2 >= objects ? best[0] : undefined;
}

/** Read what an existing repo already defines so the wizard can suggest it. */
export async function detectRepoValues(root: string, preferredAppDir?: string): Promise<DetectedValues> {
    const v: DetectedValues = {};
    const appJson = findAppJson(root, preferredAppDir);
    if (appJson) {
        const a = readJson<AppJson>(appJson)!;
        v.appJson = appJson;
        v.appName = a.name || undefined;
        v.publisher = a.publisher || undefined;
        const ranges = a.idRanges?.length ? a.idRanges : a.idRange ? [a.idRange] : [];
        if (ranges.length) {
            v.objectIdFrom = Math.min(...ranges.map(r => r.from));
            v.objectIdTo = Math.max(...ranges.map(r => r.to));
        }
        const appDir = path.dirname(appJson);
        const cop = readJson<{ mandatoryAffixes?: string[]; mandatoryPrefix?: string }>(path.join(appDir, 'AppSourceCop.json'))
            ?? readJson<{ mandatoryAffixes?: string[]; mandatoryPrefix?: string }>(path.join(root, 'AppSourceCop.json'));
        const affix = cop?.mandatoryPrefix || cop?.mandatoryAffixes?.[0];
        if (affix && /^[A-Za-z][A-Za-z0-9]{1,9}$/.test(affix.trim())) {
            v.appPrefix = affix.trim();
            v.prefixSource = 'AppSourceCop.json';
        } else {
            const g = guessPrefixFromAl(appDir);
            if (g) { v.appPrefix = g; v.prefixSource = 'AL object names'; }
        }
    }
    const remote = (await git(['remote', 'get-url', 'origin'], root, { allowFailure: true })).stdout.trim();
    const r = remote ? parseRemote(remote) : undefined;
    if (r) {
        v.workItemSystem = r.kind;
        v.adoOrg = r.adoOrg;
        v.adoProject = r.adoProject;
        v.repoSlug = r.repoSlug;
    }
    const head = (await git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], root, { allowFailure: true })).stdout.trim();
    if (head.startsWith('origin/')) { v.defaultBranch = head.slice('origin/'.length); }
    return v;
}
