import * as fs from 'fs';
import * as path from 'path';
import { hashText, normalizeText, readTextIfExists, writeTextPreservingEol } from './util';

/**
 * Projects keep the BC ALM bookkeeping in one folder instead of the repo root:
 *   .bc-alm/template.config.json, .bc-alm/template.lock.json, .bc-alm/scripts/*.ps1,
 *   .bc-alm/.templatesyncignore, .bc-alm/PROJECT.md, .bc-alm/disabled/
 * The template repository itself keeps the classic root layout. Mirrored by the
 * PowerShell scripts (ConvertTo-BcAlmLayout / Move-ToBcAlmLayout).
 */
export const STATE_DIR = '.bc-alm';

export const LAYOUT_SCRIPTS = [
    'Initialize-Template', 'Add-BCQuality', 'Start-ALLanguageServer',
    'Update-FromTemplate', 'Enable-CopilotCustomizations', 'Install-IntoExistingRepo'
];

/** '.bc-alm' when the project uses the state folder, '' for the classic root layout. */
export function stateDirOf(root: string): '' | typeof STATE_DIR {
    return fs.existsSync(path.join(root, STATE_DIR, 'template.config.json')) ? STATE_DIR : '';
}

/** Absolute path of a BC ALM state file (config, lock, PROJECT.md) for this project. */
export function statePath(root: string, file: string, stateDir: string = stateDirOf(root)): string {
    return stateDir ? path.join(root, stateDir, file) : path.join(root, file);
}

// Not preceded by a path/word character, so URLs and already-rewritten paths never match.
const LB = '(?<![A-Za-z0-9_.\\\\/-])';
const NAMES = LAYOUT_SCRIPTS.join('|');
const FORWARD = new RegExp(
    `${LB}((?:\\.\\.?[/\\\\])*|\\$\\{workspaceFolder\\}[/\\\\])(?:scripts([/\\\\])(${NAMES})\\.ps1|template\\.(config|lock)\\.json|\\.templatesyncignore)`, 'g');
const REVERSE = new RegExp(
    `${LB}((?:\\.\\.?[/\\\\])*|\\$\\{workspaceFolder\\}[/\\\\](?:\\.\\.[/\\\\])*)\\.bc-alm[/\\\\](scripts[/\\\\](?:${NAMES})\\.ps1|template\\.(?:config|lock)\\.json|\\.templatesyncignore)`, 'g');

/**
 * Rewrite mentions of the template's root-level files (scripts/X.ps1, template.config.json,
 * template.lock.json, .templatesyncignore) to their .bc-alm/ location. `depth` is the number
 * of folders the file was relocated by (customizationsPath), so relative links still resolve.
 * Idempotent.
 */
export function toBcAlmLayout(text: string, depth = 0): string {
    return text.replace(FORWARD, (_m, prefix: string, scriptSep: string | undefined, script: string | undefined, kind: string | undefined) => {
        const sep = prefix.endsWith('\\') ? '\\' : '/';
        const up = depth > 0 && (prefix.startsWith('${workspaceFolder}') || prefix.startsWith('..')) ? `..${sep}`.repeat(depth) : '';
        const rest = script ? `scripts${scriptSep}${script}.ps1` : kind ? `template.${kind}.json` : '.templatesyncignore';
        return `${prefix}${up}.bc-alm${sep}${rest}`;
    });
}

/** Reverse of toBcAlmLayout (used when publishing a project file back to a template). */
export function fromBcAlmLayout(text: string, depth = 0): string {
    return text.replace(REVERSE, (_m, prefix: string, rest: string) => {
        let p = prefix;
        for (let i = 0; i < depth; i++) {
            const n = p.replace(/\.\.[/\\]$/, '');
            if (n === p) { break; }
            p = n;
        }
        return `${p}${rest}`;
    });
}

/** Folder depth of a project-relative destination path relocated under customizationsPath. */
export function relocationDepth(destRel: string, custRoot: string): number {
    return custRoot && destRel.startsWith(custRoot + '/') ? custRoot.split('/').filter(Boolean).length : 0;
}

/** A classic-layout, initialized project that should move its BC ALM files to .bc-alm/. */
export function needsMigration(root: string): boolean {
    if (stateDirOf(root)) { return false; }
    const text = readTextIfExists(path.join(root, 'template.config.json'));
    if (!text) { return false; }
    try { return !!JSON.parse(text.replace(/^\uFEFF/, '')).initialized; } catch { return false; }
}

export interface MigrationResult {
    moved: string[];
    /** lock keys renamed old -> new */
    renamed: Record<string, string>;
}

function moveFile(root: string, fromRel: string, toRel: string, moved: string[]): boolean {
    const from = path.join(root, ...fromRel.split('/'));
    if (!fs.existsSync(from)) { return false; }
    const to = path.join(root, ...toRel.split('/'));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
    moved.push(`${fromRel} -> ${toRel}`);
    return true;
}

/**
 * Move config, lock, scripts, .templatesyncignore and PROJECT.md into .bc-alm/ and rename the
 * matching lock keys. Same steps as Move-ToBcAlmLayout in the PowerShell scripts.
 */
export function migrateToBcAlm(root: string, custRoot = ''): MigrationResult {
    const moved: string[] = [];
    const renamed: Record<string, string> = {};
    moveFile(root, 'template.config.json', `${STATE_DIR}/template.config.json`, moved);
    moveFile(root, 'template.lock.json', `${STATE_DIR}/template.lock.json`, moved);
    if (moveFile(root, '.templatesyncignore', `${STATE_DIR}/.templatesyncignore`, moved)) {
        renamed['.templatesyncignore'] = `${STATE_DIR}/.templatesyncignore`;
    }
    if (!moveFile(root, 'PROJECT.md', `${STATE_DIR}/PROJECT.md`, moved) && custRoot) {
        moveFile(root, `${custRoot}/PROJECT.md`, `${STATE_DIR}/PROJECT.md`, moved);
    }
    for (const n of LAYOUT_SCRIPTS) {
        if (moveFile(root, `scripts/${n}.ps1`, `${STATE_DIR}/scripts/${n}.ps1`, moved)) {
            renamed[`scripts/${n}.ps1`] = `${STATE_DIR}/scripts/${n}.ps1`;
        }
    }
    const scriptsDir = path.join(root, 'scripts');
    if (fs.existsSync(scriptsDir) && fs.readdirSync(scriptsDir).length === 0) { fs.rmdirSync(scriptsDir); }

    const lockFile = path.join(root, STATE_DIR, 'template.lock.json');
    const lockText = readTextIfExists(lockFile);
    if (lockText) {
        const lock = JSON.parse(lockText.replace(/^\uFEFF/, ''));
        if (lock.files && typeof lock.files === 'object') {
            const files: Record<string, unknown> = {};
            const keys = Object.keys(lock.files).map(k => [renamed[k] ?? k, k]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
            for (const [nk, k] of keys) { files[nk] = lock.files[k]; }
            lock.files = files;
            fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2) + '\n', 'utf8');
        }
    }
    for (const readme of ['README.md', custRoot ? `${custRoot}/README.md` : '']) {
        if (!readme) { continue; }
        const f = path.join(root, ...readme.split('/'));
        const t = readTextIfExists(f);
        if (!t) { continue; }
        const up = readme.includes('/') ? '../'.repeat(readme.split('/').length - 1) : '';
        const n = t.replace(/\]\((?:\.\/)?PROJECT\.md\)/g, `](${up}${STATE_DIR}/PROJECT.md)`)
            .replace(/(?<![A-Za-z0-9_.\\/-])((?:\.\/)?)scripts\/Update-FromTemplate\.ps1/g, `$1${STATE_DIR}/scripts/Update-FromTemplate.ps1`);
        if (n !== t) { writeTextPreservingEol(f, n); moved.push(`${readme} (links)`); }
    }
    return { moved, renamed };
}

/**
 * After a migration: rewrite file references in tracked files that the user never edited
 * (local == installed baseline), so they match what the next template sync produces, and keep
 * their baseline hash in step. The sync workflow is fixed even when edited, since the old
 * script path no longer exists.
 */
export function rewriteTrackedForLayout(root: string, custRoot: string, isReparam: (srcRel: string) => boolean): string[] {
    const lockFile = path.join(root, STATE_DIR, 'template.lock.json');
    const lockText = readTextIfExists(lockFile);
    const lock = lockText ? JSON.parse(lockText.replace(/^\uFEFF/, '')) : undefined;
    const files: Record<string, { path: string; installedHash: string }> = lock?.files ?? {};
    const changed: string[] = [];
    for (const [dest, e] of Object.entries(files)) {
        const f = path.join(root, ...dest.split('/'));
        const t = readTextIfExists(f);
        if (t === undefined) { continue; }
        const unmodified = hashText(t) === e.installedHash;
        let n: string;
        if (e.path === '.github/workflows/template-sync.yml') {
            if (t.includes(`${STATE_DIR}/scripts/Update-FromTemplate.ps1`)) { continue; }
            n = normalizeText(t).replace(/(?<![A-Za-z0-9_.\\/-])\.\/scripts\/Update-FromTemplate\.ps1/g, `./${STATE_DIR}/scripts/Update-FromTemplate.ps1`);
        } else if (unmodified && isReparam(e.path)) {
            n = toBcAlmLayout(normalizeText(t), relocationDepth(dest, custRoot));
        } else { continue; }
        if (n === normalizeText(t)) { continue; }
        writeTextPreservingEol(f, n);
        if (unmodified) { e.installedHash = hashText(n); }
        changed.push(dest);
    }
    if (lock && changed.length) { fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2) + '\n', 'utf8'); }
    return changed;
}
