#!/usr/bin/env node
/**
 * Validate a template catalog repository (root template + .templates/<id>/ templates).
 *
 *   node out/src/cli/validate.js [--root <repo>] [--base <git ref>] [--verbose]
 *
 * --base   also require a version bump + CHANGELOG entry for every catalog template changed since the
 *          merge base with <ref> (e.g. origin/main in a pull request).
 * Exits 1 when any error is found. In GitHub Actions the findings are emitted as annotations.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { CatalogIssue, checkVersionBumps, RepoSnapshot, validateCatalog } from '../core/catalogValidate';

function gitOut(root: string, args: string[]): string {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

function lines(s: string): string[] {
    return s.split('\n').map(x => x.trim()).filter(Boolean);
}

function diskSnapshot(root: string): RepoSnapshot {
    const files = lines(gitOut(root, ['ls-files', '--cached', '--others', '--exclude-standard']))
        .filter(f => fs.existsSync(path.join(root, f)));
    return {
        files,
        read: p => { try { return fs.readFileSync(path.join(root, p), 'utf8'); } catch { return undefined; } }
    };
}

function commitSnapshot(root: string, sha: string): RepoSnapshot {
    return {
        files: lines(gitOut(root, ['ls-tree', '-r', '--name-only', sha])),
        read: p => { try { return gitOut(root, ['show', `${sha}:${p}`]); } catch { return undefined; } }
    };
}

function parseArgs(argv: string[]): { root: string; base?: string; verbose: boolean } {
    const out = { root: process.cwd(), base: undefined as string | undefined, verbose: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--root') { out.root = path.resolve(argv[++i]); }
        else if (a === '--base') { out.base = argv[++i]; }
        else if (a === '--verbose' || a === '-v') { out.verbose = true; }
        else if (a === '--help' || a === '-h') {
            console.log('Usage: node out/src/cli/validate.js [--root <repo>] [--base <git ref>] [--verbose]');
            process.exit(0);
        } else { throw new Error(`Unknown argument: ${a}`); }
    }
    return out;
}

function report(issues: CatalogIssue[], verbose: boolean): void {
    const gha = !!process.env.GITHUB_ACTIONS;
    for (const i of issues) {
        if (i.severity === 'info' && !verbose) { continue; }
        const loc = i.line !== undefined ? `${i.file}:${i.line + 1}` : i.file;
        if (gha && i.severity !== 'info') {
            const props = [`file=${i.file}`, ...(i.line !== undefined ? [`line=${i.line + 1}`] : [])].join(',');
            console.log(`::${i.severity} ${props}::${i.message.replace(/%/g, '%25').replace(/\r?\n/g, '%0A')}`);
        } else {
            console.log(`${i.severity.toUpperCase().padEnd(7)} ${loc}  ${i.message}`);
        }
    }
}

function main(): number {
    const args = parseArgs(process.argv.slice(2));
    const head = diskSnapshot(args.root);
    const issues = validateCatalog(head);
    if (args.base) {
        const mergeBase = gitOut(args.root, ['merge-base', args.base, 'HEAD']).trim();
        const changed = lines(gitOut(args.root, ['diff', '--name-only', mergeBase]));
        const untracked = lines(gitOut(args.root, ['ls-files', '--others', '--exclude-standard']));
        issues.push(...checkVersionBumps([...new Set([...changed, ...untracked])], commitSnapshot(args.root, mergeBase), head));
    }
    report(issues, args.verbose);
    const errors = issues.filter(i => i.severity === 'error').length;
    const warnings = issues.filter(i => i.severity === 'warning').length;
    console.log(`\nTemplate catalog: ${errors} error(s), ${warnings} warning(s).`);
    return errors ? 1 : 0;
}

try {
    process.exitCode = main();
} catch (e) {
    console.error((e as Error).message);
    process.exitCode = 2;
}
