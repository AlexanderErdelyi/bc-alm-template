import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as os from 'os';
import * as path from 'path';
import { classifySourceError } from '../src/core/access';
import { CommandError, redactSecrets, run, spawnError } from '../src/core/exec';
import { insideRoot } from '../src/core/util';

test('redactSecrets masks URL credentials and GitHub tokens', () => {
    assert.equal(redactSecrets('fatal: unable to access \'https://me:s3cr3t@github.com/o/r.git/\''), 'fatal: unable to access \'https://***@github.com/o/r.git/\'');
    assert.equal(redactSecrets('git clone https://x-access-token:abc@github.com/o/r'), 'git clone https://***@github.com/o/r');
    assert.equal(redactSecrets(`token ghp_${'a'.repeat(36)} and github_pat_${'B_1'.repeat(10)}`), 'token *** and ***');
    const plain = 'https://github.com/AlexanderErdelyi/bc-alm-template.git git@github.com:o/r.git';
    assert.equal(redactSecrets(plain), plain);
});

test('spawnError gives install hints for missing tools', () => {
    const enoent = (cmd: string) => Object.assign(new Error(`spawn ${cmd} ENOENT`), { code: 'ENOENT' });
    assert.match(spawnError('git', enoent('git')).message, /git-scm\.com/);
    assert.match(spawnError('gh', enoent('gh')).message, /cli\.github\.com.*gh auth login/);
    assert.match(spawnError('C:\\Tools\\PWSH.EXE', enoent('pwsh')).message, /bcAlm\.powershellPath/);
    assert.match(spawnError('foo', enoent('foo')).message, /"foo" was not found/);
    const other = Object.assign(new Error('EACCES https://u:p@h/x'), { code: 'EACCES' });
    assert.equal(spawnError('git', other).message, 'EACCES https://***@h/x');
});

test('run rejects with a friendly error when the executable is missing', async () => {
    await assert.rejects(run('bc-alm-no-such-tool-xyz', ['--version'], { input: 'x' }), /"bc-alm-no-such-tool-xyz" was not found/);
});

test('run redacts credentials in command errors', async () => {
    const err = await run(process.execPath, ['-e', 'console.error("fatal: https://me:tok@example.com/r"); process.exit(3)'])
        .then(() => undefined, e => e as CommandError);
    assert.ok(err instanceof CommandError);
    assert.doesNotMatch(err.message, /me:tok/);
    assert.match(err.message, /https:\/\/\*\*\*@example\.com/);
    assert.doesNotMatch(err.result.stderr, /me:tok/);
});

test('classifySourceError never echoes credentials', () => {
    const p = classifySourceError('git fetch failed (128): fatal: something odd at https://me:tok@example.com/r', 'https://me:tok@example.com/r');
    assert.doesNotMatch(p.detail + p.message, /me:tok/);
});

test('insideRoot refuses paths that escape the project folder', () => {
    const root = path.join(os.tmpdir(), 'bc-alm-root');
    assert.equal(insideRoot(root, '.github/agents/a.agent.md'), path.join(root, '.github', 'agents', 'a.agent.md'));
    assert.equal(insideRoot(root, 'sub/../x.md'), path.join(root, 'x.md'));
    assert.equal(insideRoot(root, '..foo/x.md'), path.join(root, '..foo', 'x.md'));
    assert.throws(() => insideRoot(root, '../outside.md'), /outside the project folder/);
    assert.throws(() => insideRoot(root, 'a/../../outside.md'), /outside the project folder/);
    assert.throws(() => insideRoot(root, ''), /outside the project folder/);
});
