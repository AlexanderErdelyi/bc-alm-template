import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildCatalog, Catalog } from '../src/core/catalog';
import { parseConfig, readProjectConfig } from '../src/core/config';
import { statePath } from '../src/core/layout';
import { emptyLock, ensureSource, readLock, writeLock } from '../src/core/lock';
import { ProjectOps } from '../src/core/operations';
import { computeStatus } from '../src/core/status';
import { TemplateRepo, TemplateRepoRegistry } from '../src/core/templateRepo';
import { normalizeUrl, sameSource, sameUrl, sourceKey, splitSourceKey, templatePath } from '../src/core/util';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-alm-cat-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function write(root: string, rel: string, text: string) {
    const p = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text, 'utf8');
}
const exists = (root: string, rel: string) => fs.existsSync(path.join(root, ...rel.split('/')));
function gitIn(cwd: string, ...args: string[]) {
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: 'pipe' });
}
function commit(dir: string, msg: string) { gitIn(dir, 'add', '-A'); gitIn(dir, 'commit', '-q', '-m', msg); }
const VALUES = { appPrefix: 'ABC', ticketPrefix: 'ABC', objectIdFrom: 50100, objectIdTo: 50199, repoSlug: 'o/tpl', adoOrg: 'org', workItemSystem: 'ADO' };
const AGENT = (n: string, extra = '') => `---\ndescription: ${n}. Use when: x.\ntools: ['read']\n---\n# ${n}\n${extra}`;
const SKILL = (n: string) => `---\nname: ${n}\ndescription: ${n}\n---\nbody\n`;
const cfg = (template: object, values = true) => JSON.stringify({ template, ...(values ? { values: VALUES } : {}) });

/** A catalog repository: BC ALM at the root, BC Upgrade and a lite variant under .templates/. */
function makeCatalog(name: string): string {
    const dir = path.join(tmp, name);
    fs.mkdirSync(dir, { recursive: true });
    gitIn(dir, 'init', '-q', '-b', 'main');
    write(dir, 'template.config.json', cfg({ id: 'bc-alm', name: 'BC ALM' }));
    write(dir, 'README.md', '# catalog\n');
    write(dir, '.github/agents/bc-dev.agent.md', AGENT('bc-dev'));
    write(dir, '.github/agents/bc-plan.agent.md', AGENT('bc-plan'));
    write(dir, '.github/agents/bc-deploy.agent.md', AGENT('bc-deploy'));
    write(dir, '.github/skills/bc-ship/SKILL.md', SKILL('bc-ship'));
    write(dir, '.github/skills/bc-ship/reference.md', 'ref\n');
    write(dir, '.templates/bc-upgrade/template.config.json', cfg({ id: 'bc-upgrade', name: 'BC Upgrade', version: '1.0.0' }));
    write(dir, '.templates/bc-upgrade/.github/agents/bc-upgrade.agent.md', AGENT('bc-upgrade'));
    write(dir, '.templates/bc-upgrade/.github/skills/bc-upgrade-scan/SKILL.md', SKILL('bc-upgrade-scan'));
    write(dir, '.templates/bc-alm-lite/template.config.json', cfg({ id: 'bc-alm-lite', name: 'BC ALM Lite', extends: 'bc-alm', remove: ['agent:bc-deploy'], maintainers: ['@alice'] }, false));
    write(dir, '.templates/bc-alm-lite/.github/agents/bc-plan.agent.md', AGENT('bc-plan', 'lite\n'));
    write(dir, '.templates/Wrong Name/template.config.json', cfg({ id: 'something-else', name: 'X' }));
    write(dir, '.templates/no-block/template.config.json', JSON.stringify({ values: VALUES }));
    write(dir, '.templates/broken/template.config.json', '{ nope');
    commit(dir, 'init');
    return dir;
}

test('source keys: path-aware identity, normalization and splitting', () => {
    assert.equal(templatePath('./.templates/bc-upgrade/'), '.templates/bc-upgrade');
    assert.equal(templatePath('\\.templates\\x\\'), '.templates/x');
    assert.equal(templatePath(undefined), '');
    assert.equal(sourceKey({ url: 'https://github.com/o/r.git' }), 'https://github.com/o/r.git');
    assert.equal(sourceKey({ url: 'https://github.com/o/r.git', path: '.templates/bc-upgrade/' }), 'https://github.com/o/r.git#.templates/bc-upgrade');
    assert.deepEqual(splitSourceKey('https://github.com/o/r.git#.templates/x'), { url: 'https://github.com/o/r.git', path: '.templates/x' });
    assert.deepEqual(splitSourceKey('https://github.com/o/r.git'), { url: 'https://github.com/o/r.git', path: '' });
    assert.ok(sameSource({ url: 'https://github.com/O/R', path: '.templates/X' }, { url: 'https://github.com/o/r.git', path: './.templates/x/' }));
    assert.ok(!sameSource({ url: 'https://github.com/o/r' }, { url: 'https://github.com/o/r', path: '.templates/x' }));
    assert.ok(sameUrl('https://github.com/o/r.git#.templates/x', 'https://github.com/O/r#.templates/X'));
    assert.equal(normalizeUrl('https://github.com/o/r'), normalizeUrl('https://github.com/o/r.git'));
});

test('manifest: extends, remove and maintainers are parsed only when present', () => {
    const c = parseConfig({ template: { id: 'Lite', name: 'Lite', extends: 'BC ALM', remove: ['agent:bc-deploy', ''], maintainers: ['@alice', 'bob'] } });
    assert.equal(c.template!.extends, 'bc-alm');
    assert.deepEqual(c.template!.remove, ['agent:bc-deploy']);
    assert.deepEqual(c.template!.maintainers, ['alice', 'bob']);
    assert.ok(!('extends' in parseConfig({ template: { id: 'a', name: 'a' } }).template!));
});

test('catalog: lists templates with warnings; root template excludes .templates', async () => {
    const url = makeCatalog('list');
    const reg = new TemplateRepoRegistry(path.join(tmp, 'cache-list'));
    const m = reg.mirror(url);
    await m.ensure(0);
    const sha = await m.resolve('main');
    const { templates, warnings } = await m.listTemplates(sha);
    assert.deepEqual(templates.map(t => [t.id, t.path]), [['bc-alm', ''], ['bc-alm-lite', '.templates/bc-alm-lite'], ['bc-upgrade', '.templates/bc-upgrade']]);
    assert.equal(warnings.length, 3);
    assert.ok(warnings.some(w => /Wrong Name.*does not match/.test(w)));
    assert.ok(warnings.some(w => /no-block.*no "template" block/.test(w)));
    assert.ok(warnings.some(w => /broken.*not valid JSON/.test(w)));

    const root = reg.get({ url, ref: 'main' });
    const files = await root.listFiles(sha);
    assert.ok(files.includes('.github/agents/bc-dev.agent.md'));
    assert.ok(!files.some(f => f.startsWith('.templates/')));

    const upg = reg.get({ url, ref: 'main', path: './.templates/bc-upgrade/' });
    assert.equal(upg.root, '.templates/bc-upgrade');
    assert.equal(upg.key, `${url}#.templates/bc-upgrade`);
    assert.equal(upg.gitDir, root.gitDir, 'templates of one repository share the mirror');
    assert.deepEqual((await upg.listFiles(sha)).sort(), ['.github/agents/bc-upgrade.agent.md', '.github/skills/bc-upgrade-scan/SKILL.md', 'template.config.json']);
    assert.equal((await upg.readConfig(sha))!.template!.id, 'bc-upgrade');
    assert.equal(await upg.readFile(sha, '.github/agents/bc-upgrade.agent.md'), AGENT('bc-upgrade'));
    assert.equal(upg.writePath('.github/agents/x.agent.md'), '.templates/bc-upgrade/.github/agents/x.agent.md');
    assert.throws(() => new TemplateRepo({ url, ref: 'main', path: '.templates/../x' }, path.join(tmp, 'cache-list')), /Invalid template path/);
});

test('variants: inherit the base, override whole components, remove components, inherit values', async () => {
    const url = makeCatalog('variant');
    const reg = new TemplateRepoRegistry(path.join(tmp, 'cache-variant'));
    const lite = reg.get({ url, ref: 'main', path: '.templates/bc-alm-lite' });
    await lite.ensure(0);
    const sha = await lite.resolve();
    const layout = await lite.layout(sha);
    assert.deepEqual(layout.layers.map(l => l.id), ['bc-alm', 'bc-alm-lite']);
    assert.deepEqual([...layout.overridden], ['agent:bc-plan']);
    assert.deepEqual([...layout.removed], ['agent:bc-deploy']);
    const files = (await lite.listFiles(sha)).sort();
    assert.ok(files.includes('.github/agents/bc-dev.agent.md'));
    assert.ok(files.includes('.github/skills/bc-ship/reference.md'));
    assert.ok(!files.includes('.github/agents/bc-deploy.agent.md'));
    assert.equal(layout.files.get('.github/agents/bc-plan.agent.md'), '.templates/bc-alm-lite/.github/agents/bc-plan.agent.md');
    assert.equal(layout.files.get('.github/agents/bc-dev.agent.md'), '.github/agents/bc-dev.agent.md');
    assert.equal(await lite.readFile(sha, '.github/agents/bc-plan.agent.md'), AGENT('bc-plan', 'lite\n'));
    const c = (await lite.readConfig(sha))!;
    assert.equal(c.template!.id, 'bc-alm-lite');
    assert.equal(c.values.appPrefix, 'ABC', 'values come from the base');

    const project = parseConfig({ initialized: true, values: VALUES });
    const cat = await buildCatalog(lite, sha, project);
    assert.equal(cat.manifest.id, 'bc-alm-lite');
    assert.equal(cat.variant?.base, 'bc-alm');
    assert.ok(cat.variant?.overridden.has('agent:bc-plan'));
    assert.ok(cat.variant?.removed.has('agent:bc-deploy'));

    // History follows changes in the base layer too, and ignores other templates.
    const before = (await lite.log(sha)).length;
    write(url, '.github/agents/bc-dev.agent.md', AGENT('bc-dev', 'v2\n'));
    commit(url, 'base change');
    write(url, '.templates/bc-upgrade/.github/agents/bc-upgrade.agent.md', AGENT('bc-upgrade', 'v2\n'));
    commit(url, 'other template');
    await lite.ensure(0);
    const sha2 = await lite.resolve();
    const log = await lite.log(sha2);
    assert.equal(log.length, before + 1);
    assert.equal(log[0].subject, 'base change');
    const hist = await lite.fileHistory(sha2, new Set(['.github/agents/bc-dev.agent.md', '.github/agents/bc-plan.agent.md']));
    assert.equal(hist.get('.github/agents/bc-dev.agent.md')?.length, 2);
    assert.equal(hist.get('.github/agents/bc-plan.agent.md')?.length, 1);

    const root = reg.get({ url, ref: 'main' });
    const rootLog = await root.log(sha2);
    assert.ok(!rootLog.some(l => l.subject === 'other template'), 'the root template ignores .templates changes');

    // Export: variant files land at template-relative paths.
    const out = path.join(tmp, 'export-lite');
    await lite.exportTo(sha2, out);
    assert.ok(exists(out, '.github/agents/bc-dev.agent.md'));
    assert.ok(!exists(out, '.github/agents/bc-deploy.agent.md'));
    assert.equal(fs.readFileSync(path.join(out, '.github', 'agents', 'bc-plan.agent.md'), 'utf8').replace(/\r\n/g, '\n'), AGENT('bc-plan', 'lite\n'));
    assert.ok(!exists(out, '.templates'));
    const outRoot = path.join(tmp, 'export-root');
    await root.exportTo(sha2, outRoot);
    assert.ok(exists(outRoot, '.github/agents/bc-deploy.agent.md'));
    assert.ok(!exists(outRoot, '.templates'), 'the root export leaves other templates out');
});

test('variants: missing base and inheritance cycles fail clearly', async () => {
    const dir = path.join(tmp, 'cycle');
    fs.mkdirSync(dir, { recursive: true });
    gitIn(dir, 'init', '-q', '-b', 'main');
    write(dir, '.templates/a/template.config.json', cfg({ id: 'a', name: 'A', extends: 'b' }));
    write(dir, '.templates/b/template.config.json', cfg({ id: 'b', name: 'B', extends: 'a' }));
    write(dir, '.templates/c/template.config.json', cfg({ id: 'c', name: 'C', extends: 'nope' }));
    commit(dir, 'init');
    const reg = new TemplateRepoRegistry(path.join(tmp, 'cache-cycle'));
    const a = reg.get({ url: dir, ref: 'main', path: '.templates/a' });
    await a.ensure(0);
    const sha = await a.resolve();
    await assert.rejects(a.layout(sha), /cycle: a → b → a/);
    await assert.rejects(reg.get({ url: dir, ref: 'main', path: '.templates/c' }).layout(sha), /extends "nope"/);
});

test('install from a catalog template: lock records path and source key; legacy locks still load', async () => {
    const url = makeCatalog('install');
    const cache = path.join(tmp, 'cache-install');
    const proj = path.join(tmp, 'proj-install');
    write(proj, 'template.config.json', JSON.stringify({ initialized: true, values: { ...VALUES, appPrefix: 'NOB' } }, null, 2));

    const load = async () => {
        const project = readProjectConfig(proj)!;
        const cats: Catalog[] = [];
        for (const p of ['', '.templates/bc-upgrade']) {
            const repo = new TemplateRepo({ url, ref: 'main', ...(p ? { path: p } : {}) }, cache);
            await repo.ensure(0);
            cats.push(await buildCatalog(repo, await repo.resolve(), project));
        }
        const lock = readLock(proj);
        const st = await computeStatus({ root: proj, project, lock, catalogs: cats });
        return { st, ops: new ProjectOps(proj, project, lock, cats), cats };
    };
    let { st, ops, cats } = await load();
    assert.deepEqual(cats.map(c => c.manifest.id), ['bc-alm', 'bc-upgrade']);
    const comp = (id: string) => st.components.find(x => x.ref.id === id)!;
    assert.equal(comp('agent:bc-upgrade').templateId, 'bc-upgrade');
    assert.ok(!comp('agent:bc-upgrade').files.some(f => f.destRel.startsWith('.templates')));
    ops.install(comp('agent:bc-upgrade'));
    ops.install(comp('agent:bc-dev'));
    ops.setExclude(`${url}#.templates/bc-upgrade`, ['skill:bc-upgrade-scan']);
    ops.save();

    assert.ok(exists(proj, '.github/agents/bc-upgrade.agent.md'));
    const lock = readLock(proj)!;
    const e = lock.files['.github/agents/bc-upgrade.agent.md'];
    assert.equal(e.source, `${url}#.templates/bc-upgrade`);
    assert.equal(e.path, '.github/agents/bc-upgrade.agent.md');
    assert.equal(lock.files['.github/agents/bc-dev.agent.md'].source, url);
    const src = lock.sources.find(s => s.path === '.templates/bc-upgrade')!;
    assert.equal(src.url, url);
    assert.equal(src.id, 'bc-upgrade');
    assert.deepEqual(src.exclude, ['skill:bc-upgrade-scan']);
    assert.equal(lock.sources.filter(s => s.url === url).length, 2, 'one lock source per template of the repository');
    const text = fs.readFileSync(statePath(proj, 'template.lock.json'), 'utf8');
    const keys = Object.keys(JSON.parse(text).sources.find((s: { path?: string }) => s.path));
    assert.ok(keys.indexOf('url') < keys.indexOf('path') && keys.indexOf('path') < keys.indexOf('ref'), keys.join());

    ({ st } = await load());
    assert.equal(st.components.find(x => x.ref.id === 'agent:bc-upgrade')!.status, 'current');
    assert.equal(st.components.find(x => x.ref.id === 'skill:bc-upgrade-scan')!.excluded, true);

    // A legacy lock (no path) still matches the root template.
    const legacy = emptyLock();
    ensureSource(legacy, { url, ref: 'main' }, true);
    ensureSource(legacy, { url, ref: 'main', path: '.templates/bc-upgrade' });
    assert.equal(legacy.sources.length, 2);
    ensureSource(legacy, { url: url + '/', ref: 'dev' });
    assert.equal(legacy.sources.length, 2);
    assert.equal(legacy.sources[0].ref, 'dev');
    fs.mkdirSync(path.join(tmp, 'legacy'), { recursive: true });
    writeLock(path.join(tmp, 'legacy'), legacy);
    assert.ok(!('path' in readLock(path.join(tmp, 'legacy'))!.sources[0]));
});
