import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { forkBlocker } from '../src/core/github';
import { pushHistory, syncFromUpstream } from '../src/core/publish';
import { safeRemove, sweepStale } from '../src/core/util';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-alm-tpl-test-'));
const work = path.join(tmp, 'work');
test.after(() => safeRemove(tmp));

function sh(cwd: string, ...args: string[]): string {
    return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: 'pipe' }).toString().trim();
}
function commit(dir: string, rel: string, text: string, msg: string) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text, 'utf8');
    sh(dir, 'add', '-A');
    sh(dir, 'commit', '-q', '-m', msg);
}
function bare(name: string): string {
    const p = path.join(tmp, name + '.git');
    sh(tmp, 'init', '-q', '--bare', '-b', 'main', p);
    return p;
}
function clone(url: string, name: string): string {
    const d = path.join(tmp, name);
    sh(tmp, 'clone', '-q', url, d);
    return d;
}
const head = (gitDir: string, ref = 'main') => sh(tmp, '--git-dir', gitDir, 'rev-parse', ref);
const show = (gitDir: string, spec: string) => sh(tmp, '--git-dir', gitDir, 'show', spec);

test('safeRemove deletes trees with read-only files (git pack files) and never throws', () => {
    const d = path.join(tmp, 'ro');
    fs.mkdirSync(path.join(d, 'objects', 'pack'), { recursive: true });
    const f = path.join(d, 'objects', 'pack', 'pack-1.idx');
    fs.writeFileSync(f, 'x');
    fs.chmodSync(f, 0o444);
    assert.equal(safeRemove(d), true);
    assert.equal(fs.existsSync(d), false);
    assert.equal(safeRemove(path.join(tmp, 'does-not-exist')), true);
});

test('sweepStale removes only old leftover folders', () => {
    const root = path.join(tmp, 'sweep');
    fs.mkdirSync(path.join(root, 'pub-old'), { recursive: true });
    fs.mkdirSync(path.join(root, 'pub-new'), { recursive: true });
    const old = new Date(Date.now() - 2 * 86_400_000);
    fs.utimesSync(path.join(root, 'pub-old'), old, old);
    assert.equal(sweepStale(root, 'pub-', 86_400_000), 1);
    assert.deepEqual(fs.readdirSync(root), ['pub-new']);
    assert.equal(sweepStale(path.join(tmp, 'missing'), '', 0), 0);
});

test('forkBlocker: owner of the upstream and existing forks cannot fork again', () => {
    assert.equal(forkBlocker('A/tpl', 'AlexanderErdelyi', 'alexandererdelyi')?.kind, 'owner');
    const ex = forkBlocker('A/tpl', 'A', 'colleague', 'colleague/tpl-fork');
    assert.equal(ex?.kind, 'existing');
    assert.equal(ex?.kind === 'existing' && ex.fork, 'colleague/tpl-fork');
    assert.equal(forkBlocker('A/tpl', 'A', 'my-org'), undefined);
});

test('duplicate keeps history, then upstream sync fast-forwards, merges and opens a branch on conflict', async () => {
    // Upstream template with one commit.
    const upstream = bare('upstream');
    const up = clone(upstream, 'up-wc');
    commit(up, '.github/agents/bc-dev.agent.md', 'v1\n', 'init');
    sh(up, 'push', '-q', 'origin', 'HEAD:main');

    // Duplicate into an empty repo: same history.
    const copy = bare('copy');
    await pushHistory(upstream, 'main', copy, work);
    assert.equal(head(copy), head(upstream));

    // Nothing new upstream.
    let r = await syncFromUpstream({ url: copy, ref: 'main', upstream, workRoot: work });
    assert.equal(r.status, 'upToDate');

    // Upstream moves on, copy untouched -> fast-forward.
    commit(up, '.github/agents/bc-dev.agent.md', 'v2\n', 'v2');
    sh(up, 'push', '-q', 'origin', 'HEAD:main');
    r = await syncFromUpstream({ url: copy, ref: 'main', upstream, workRoot: work });
    assert.equal(r.status, 'fastForward');
    assert.equal(head(copy), head(upstream));

    // Both sides change different files -> merge commit pushed to main.
    const team = clone(copy, 'team-wc');
    commit(team, '.github/agents/bc-upgrade.agent.md', 'team\n', 'team agent');
    sh(team, 'push', '-q', 'origin', 'HEAD:main');
    commit(up, '.github/skills/bc-x/SKILL.md', 'skill\n', 'new skill');
    sh(up, 'push', '-q', 'origin', 'HEAD:main');
    r = await syncFromUpstream({ url: copy, ref: 'main', upstream, workRoot: work });
    assert.equal(r.status, 'merged');
    assert.equal(show(copy, 'main:.github/skills/bc-x/SKILL.md'), 'skill');
    assert.equal(show(copy, 'main:.github/agents/bc-upgrade.agent.md'), 'team');

    // Same file changed on both sides -> main untouched, upstream pushed as a sync branch.
    sh(team, 'pull', '-q', '--no-rebase', 'origin', 'main');
    commit(team, '.github/agents/bc-dev.agent.md', 'team version\n', 'team edit');
    sh(team, 'push', '-q', 'origin', 'HEAD:main');
    commit(up, '.github/agents/bc-dev.agent.md', 'v3\n', 'v3');
    sh(up, 'push', '-q', 'origin', 'HEAD:main');
    const before = head(copy);
    r = await syncFromUpstream({ url: copy, ref: 'main', upstream, workRoot: work });
    assert.equal(r.status, 'branch');
    assert.match(r.branch!, /^bc-alm\/upstream-sync-/);
    assert.equal(head(copy), before);
    assert.equal(head(copy, r.branch!), head(upstream));
    assert.equal(fs.readdirSync(work).length, 0, 'work folders are cleaned up');
});

test('sync explains unrelated histories (copies made with "Use this template")', async () => {
    const a = bare('unrel-a');
    const b = bare('unrel-b');
    const wa = clone(a, 'unrel-a-wc');
    commit(wa, 'x.md', 'a\n', 'a');
    sh(wa, 'push', '-q', 'origin', 'HEAD:main');
    const wb = clone(b, 'unrel-b-wc');
    commit(wb, 'x.md', 'b\n', 'b');
    sh(wb, 'push', '-q', 'origin', 'HEAD:main');
    await assert.rejects(syncFromUpstream({ url: b, ref: 'main', upstream: a, workRoot: work }), /shares no history/);
});
