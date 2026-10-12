import { execFile, spawn } from 'child_process';

export interface ExecResult {
    stdout: string;
    stderr: string;
    code: number;
}

export class CommandError extends Error {
    constructor(message: string, public readonly result: ExecResult) {
        super(message);
    }
}

/** Run a process and capture output. Rejects on non-zero exit unless allowFailure. */
export function run(
    cmd: string,
    args: string[],
    opts: { cwd?: string; input?: string; allowFailure?: boolean; env?: NodeJS.ProcessEnv; onOutput?: (chunk: string) => void } = {}
): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, {
            cwd: opts.cwd,
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...opts.env },
            windowsHide: true
        });
        const out: Buffer[] = [];
        const err: Buffer[] = [];
        child.stdout.on('data', (d: Buffer) => { out.push(d); opts.onOutput?.(d.toString('utf8')); });
        child.stderr.on('data', (d: Buffer) => { err.push(d); opts.onOutput?.(d.toString('utf8')); });
        child.on('error', e => reject(e));
        child.on('close', code => {
            const result: ExecResult = {
                stdout: Buffer.concat(out).toString('utf8'),
                stderr: Buffer.concat(err).toString('utf8'),
                code: code ?? -1
            };
            if (result.code !== 0 && !opts.allowFailure) {
                reject(new CommandError(`${cmd} ${args.join(' ')} failed (${result.code}): ${result.stderr.trim() || result.stdout.trim()}`, result));
            } else {
                resolve(result);
            }
        });
        if (opts.input !== undefined) { child.stdin.write(opts.input); }
        child.stdin.end();
    });
}

export function git(args: string[], cwd?: string, opts: { input?: string; allowFailure?: boolean } = {}): Promise<ExecResult> {
    return run('git', args, { cwd, ...opts });
}

export async function commandExists(cmd: string, args: string[] = ['--version']): Promise<boolean> {
    return new Promise(resolve => {
        execFile(cmd, args, { windowsHide: true }, err => resolve(!err));
    });
}

/**
 * Read many blobs in one `git cat-file --batch` call.
 * specs are `<rev>:<path>` (or object ids). Missing objects map to undefined.
 */
export function catFileBatch(gitDir: string, specs: string[]): Promise<Map<string, string | undefined>> {
    return new Promise((resolve, reject) => {
        const result = new Map<string, string | undefined>();
        if (specs.length === 0) { resolve(result); return; }
        const child = spawn('git', ['--git-dir', gitDir, 'cat-file', '--batch'], { windowsHide: true });
        const chunks: Buffer[] = [];
        const err: Buffer[] = [];
        child.stdout.on('data', (d: Buffer) => chunks.push(d));
        child.stderr.on('data', (d: Buffer) => err.push(d));
        child.on('error', reject);
        child.on('close', code => {
            if (code !== 0) {
                reject(new Error(`git cat-file failed: ${Buffer.concat(err).toString('utf8')}`));
                return;
            }
            const buf = Buffer.concat(chunks);
            let pos = 0;
            for (const spec of specs) {
                const nl = buf.indexOf(0x0a, pos);
                if (nl < 0) { break; }
                const header = buf.subarray(pos, nl).toString('utf8');
                pos = nl + 1;
                if (header.endsWith(' missing') || header.endsWith(' ambiguous')) {
                    result.set(spec, undefined);
                    continue;
                }
                const parts = header.split(' ');
                const size = parseInt(parts[2], 10);
                const type = parts[1];
                const content = buf.subarray(pos, pos + size);
                pos += size + 1; // trailing LF
                result.set(spec, type === 'blob' ? content.toString('utf8') : undefined);
            }
            resolve(result);
        });
        child.stdin.write(specs.join('\n') + '\n');
        child.stdin.end();
    });
}
