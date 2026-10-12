import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildCatalog } from '../src/core/catalog';
import { readProjectConfig } from '../src/core/config';
import { readLock } from '../src/core/lock';
import { ProjectOps } from '../src/core/operations';
import { computeStatus, ProjectStatus } from '../src/core/status';
import { TemplateRepo } from '../src/core/templateRepo';

/**
 * End-to-end against a throwaway local git "template": install, upstream update, local edit
 * (conflict + 3-way merge), disable/enable and keepLocal - all through the core engine.
 */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-alm-test-'));
const tplDir = path.join(tmp, 'template');
const projDir = path.join(tmp, 'project');
const cacheDir = path.join(tmp, 'cache');

function write(root: string, rel: string, text: string) {
    const p = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text, 'utf8');
}
function read(root: string, rel: string) {
    return fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8');
}
function git(...args: string[]) {
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...args], { cwd: tplDir, stdio: 'pipe' });
}

const AGENT = (extra: string) => `---\ndescription: ABC developer. Use when: coding.\ntools: ['read']\n---\n# ABC dev\n\nline one\nline two\nline three\nline four\nline five\n${extra}`;

async function status(): Promise<{ st: ProjectStatus; ops: ProjectOps }> {
    const project = readProjectConfig(projDir)!;
    const repo = new TemplateRepo({ url: tplDir, ref: 'main' }, cacheDir);
    await repo.ensure(0);
    const cat = await buildCatalog(repo, await repo.resolve(), project);
    const lock = readLock(projDir);
    const st = await computeStatus({ root: projDir, project, lock, catalogs: [cat] });
    return { st, ops: new ProjectOps(projDir, project, lock, [cat]) };
}
const comp = (st: ProjectStatus, id: string) => st.components.find(c => c.ref.id === id)!;

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('install, update, conflict, merge, disable/enable, keepLocal', async () => {
    fs.mkdirSync(tplDir, { recursive: true });
    git('init', '-q', '-b', 'main');
    write(tplDir, 'template.config.json', JSON.stringify({ values: { appPrefix: 'ABC', ticketPrefix: 'ABC', objectIdFrom: 50100, objectIdTo: 50199, repoSlug: 'o/tpl', adoOrg: 'org', workItemSystem: 'ADO' } }));
    write(tplDir, '.github/agents/bc-dev.agent.md', AGENT(''));
    write(tplDir, '.github/agents/bc-pm.agent.md', AGENT(''));
    write(tplDir, '.github/skills/bc-x/SKILL.md', '---\nname: bc-x\ndescription: x\n---\nABC\n');
    git('add', '-A'); git('commit', '-q', '-m', 'init');

    write(projDir, 'template.config.json', JSON.stringify({ initialized: true, values: { appPrefix: 'XYZ', ticketPrefix: 'XYZ', objectIdFrom: 60000, objectIdTo: 60099, repoSlug: 'c/app', adoOrg: 'org', workItemSystem: 'ADO' } }, null, 2));

    // 1. Nothing installed yet -> everything is available; install two agents.
    let { st, ops } = await status();
    assert.equal(comp(st, 'agent:bc-dev').status, 'available');
    ops.install(comp(st, 'agent:bc-dev'));
    ops.install(comp(st, 'agent:bc-pm'));
    assert.ok(ops.save());
    assert.match(read(projDir, '.github/agents/bc-dev.agent.md'), /XYZ developer/);
    ({ st, ops } = await status());
    assert.equal(comp(st, 'agent:bc-dev').status, 'current');
    assert.equal(comp(st, 'skill:bc-x').status, 'available');
    assert.equal(Object.keys(readLock(projDir)!.files).length, 2);

    // 2. Upstream changes both agents (at the end); the user edits bc-pm (at the top).
    write(tplDir, '.github/agents/bc-dev.agent.md', AGENT('upstream ABC tip\n'));
    write(tplDir, '.github/agents/bc-pm.agent.md', AGENT('upstream ABC tip\n'));
    git('commit', '-q', '-am', 'upstream');
    write(projDir, '.github/agents/bc-pm.agent.md', read(projDir, '.github/agents/bc-pm.agent.md').replace('# XYZ dev', '# XYZ dev (ours)'));
    ({ st, ops } = await status());
    assert.equal(comp(st, 'agent:bc-dev').status, 'update');
    assert.equal(comp(st, 'agent:bc-pm').status, 'conflict');

    // 3. Take the safe update, 3-way merge the edited one.
    ops.take(comp(st, 'agent:bc-dev').files[0]);
    const m = await ops.merge(comp(st, 'agent:bc-pm').files[0]);
    ops.save();
    assert.equal(m.conflicts, 0);
    const merged = read(projDir, '.github/agents/bc-pm.agent.md');
    assert.match(merged, /\(ours\)/);
    assert.match(merged, /upstream XYZ tip/);
    ({ st, ops } = await status());
    assert.equal(comp(st, 'agent:bc-dev').status, 'current');
    assert.equal(comp(st, 'agent:bc-pm').status, 'modified');

    // 4. Disable moves files out of discovery and records the policy; enable restores them.
    ops.disable(comp(st, 'agent:bc-dev'));
    assert.ok(!fs.existsSync(path.join(projDir, '.github/agents/bc-dev.agent.md')));
    assert.ok(fs.existsSync(path.join(projDir, '.bc-alm/disabled/.github/agents/bc-dev.agent.md')));
    assert.deepEqual(readProjectConfig(projDir)!.sync.components.disabled, ['agent:bc-dev']);
    ({ st, ops } = await status());
    assert.equal(comp(st, 'agent:bc-dev').status, 'disabled');
    ops.enable(comp(st, 'agent:bc-dev'));
    ({ st, ops } = await status());
    assert.equal(comp(st, 'agent:bc-dev').status, 'current');
    assert.deepEqual(readProjectConfig(projDir)!.sync.components.disabled, []);

    // 5. keepLocal is persisted in template.config.json and surfaced on the component.
    ops.setKeepLocal('agent:bc-pm', true);
    ({ st } = await status());
    assert.equal(comp(st, 'agent:bc-pm').keepLocal, true);

    // 6. A local-only agent is reported as custom.
    write(projDir, '.github/agents/my-own.agent.md', '---\ndescription: mine\n---\n');
    ({ st } = await status());
    assert.equal(comp(st, 'agent:my-own').status, 'custom');
});
