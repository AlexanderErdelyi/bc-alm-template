import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildCatalog, Catalog } from '../src/core/catalog';
import { parseConfig, readProjectConfig } from '../src/core/config';
import { readLock } from '../src/core/lock';
import { manifestFromInput, placeholderValues, pushNewTemplate, scaffoldTemplate, seedFromProject, setTemplateIdentity, withManifest } from '../src/core/newTemplate';
import { ProjectOps } from '../src/core/operations';
import { computeStatus } from '../src/core/status';
import { TemplateRepo } from '../src/core/templateRepo';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-alm-nt-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function write(root: string, rel: string, text: string) {
    const p = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text, 'utf8');
}
const read = (root: string, rel: string) => fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8');
function git(cwd: string, ...args: string[]): string {
    return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: 'pipe' }).toString();
}
const VALUES = { appPrefix: 'ABC', ticketPrefix: 'ABC', objectIdFrom: 50100, objectIdTo: 50199, repoSlug: 'o/tpl', adoOrg: 'org', workItemSystem: 'ADO' };

test('manifestFromInput and withManifest keep the config intact', () => {
    const m = manifestFromInput(' BC Upgrade ', 'Upgrade helpers', 'arrow-up');
    assert.deepEqual(m, { id: 'bc-upgrade', name: 'BC Upgrade', description: 'Upgrade helpers', version: '0.1.0', icon: 'arrow-up' });

    const text = '{\r\n  "_readme": "x",\r\n  "initialized": false,\r\n  "values": { "appPrefix": "ABC" }\r\n}\r\n';
    const out = withManifest(text, { id: 'bc-upgrade', name: 'BC Upgrade' });
    assert.ok(out.includes('\r\n'), 'keeps CRLF');
    const keys = Object.keys(JSON.parse(out));
    assert.deepEqual(keys, ['_readme', 'template', 'initialized', 'values']);
    assert.equal(parseConfig(JSON.parse(out)).template?.id, 'bc-upgrade');

    const replaced = withManifest(out, { id: 'other', name: 'Other', version: '2.0.0' });
    const tpl = JSON.parse(replaced).template;
    assert.equal(tpl.id, 'other');
    assert.equal(tpl.version, '2.0.0');
    assert.deepEqual(Object.keys(JSON.parse(replaced)), ['_readme', 'template', 'initialized', 'values']);
});

test('scaffold + seed: generalized components, placeholders, readable as a template', async () => {
    const proj = path.join(tmp, 'proj');
    write(proj, 'template.config.json', JSON.stringify({ initialized: true, values: { ...VALUES, appPrefix: 'NOB', repoSlug: 'contoso/app' } }, null, 2));
    write(proj, '.github/agents/bc-upgrade.agent.md', '---\ndescription: Upgrade NOB objects. Use when: upgrade.\ntools: [\'read\']\n---\nWorks on NOB apps in contoso/app.\n');
    const project = readProjectConfig(proj)!;
    const values = placeholderValues(project, 'me/bc-upgrade-template');
    const seeded = seedFromProject(proj, project, ['.github/agents/bc-upgrade.agent.md', '.github/agents/missing.agent.md'], values);
    assert.equal(seeded.length, 1);
    assert.match(seeded[0].text, /ABC objects/);
    assert.match(seeded[0].text, /me\/bc-upgrade-template/);
    assert.ok(!seeded[0].text.includes('NOB'));

    const dir = path.join(tmp, 'scaffold');
    fs.mkdirSync(dir);
    const m = manifestFromInput('BC Upgrade', 'Upgrade helpers', 'arrow-up');
    const written = scaffoldTemplate(dir, m, values, seeded);
    assert.ok(written.includes('template.config.json'));
    assert.ok(written.includes('.github/skills/.gitkeep'));
    assert.ok(!written.includes('.github/agents/.gitkeep'), 'no placeholder where seeded content exists');
    assert.match(read(dir, 'README.md'), /# BC Upgrade/);
    assert.match(read(dir, 'README.md'), /agent `bc-upgrade`/);

    // Publish to a bare "remote" and read it back as a template source.
    const remote = path.join(tmp, 'remote.git');
    git(tmp, 'init', '-q', '--bare', '-b', 'main', remote);
    await pushNewTemplate(dir, remote, 'main');
    const repo = new TemplateRepo({ url: remote, ref: 'main' }, path.join(tmp, 'cache'));
    await repo.ensure(0);
    const cat = await buildCatalog(repo, await repo.resolve(), project);
    assert.equal(cat.manifest.id, 'bc-upgrade');
    assert.equal(cat.manifest.name, 'BC Upgrade');
    assert.ok([...cat.files.values()].some(f => f.component.id === 'agent:bc-upgrade'));

    // A copied template gets its own identity.
    assert.equal(await setTemplateIdentity(remote, 'main', { id: 'bc-upgrade-2', name: 'BC Upgrade 2' }, path.join(tmp, 'work')), true);
    assert.equal(await setTemplateIdentity(remote, 'main', { id: 'bc-upgrade-2', name: 'BC Upgrade 2' }, path.join(tmp, 'work')), false, 'no-op when unchanged');
    const head = JSON.parse(git(tmp, '--git-dir', remote, 'show', 'main:template.config.json'));
    assert.equal(head.template.id, 'bc-upgrade-2');
    assert.equal(head.template.icon, 'arrow-up', 'other manifest fields kept');
});

test('installFrom takes a component from the chosen source when several offer it', async () => {
    const mk = (name: string, body: string) => {
        const dir = path.join(tmp, name);
        fs.mkdirSync(dir, { recursive: true });
        git(dir, 'init', '-q', '-b', 'main');
        write(dir, 'template.config.json', JSON.stringify({ template: { id: name, name }, values: VALUES }));
        write(dir, '.github/agents/shared.agent.md', `---\ndescription: shared. Use when: x.\n---\n${body}\n`);
        git(dir, 'add', '-A');
        git(dir, 'commit', '-q', '-m', 'init');
        return dir;
    };
    const a = mk('tpl-a', 'from A');
    const b = mk('tpl-b', 'from B');
    const proj = path.join(tmp, 'proj2');
    write(proj, 'template.config.json', JSON.stringify({ initialized: true, values: VALUES }, null, 2));
    const project = readProjectConfig(proj)!;
    const cats: Catalog[] = [];
    for (const url of [a, b]) {
        const repo = new TemplateRepo({ url, ref: 'main' }, path.join(tmp, 'cache2'));
        await repo.ensure(0);
        cats.push(await buildCatalog(repo, await repo.resolve(), project));
    }
    const st = await computeStatus({ root: proj, project, lock: undefined, catalogs: cats });
    const comp = st.components.find(c => c.ref.id === 'agent:shared')!;
    assert.equal(comp.source, a);
    const ops = new ProjectOps(proj, project, undefined, cats);
    assert.equal(ops.installFrom(comp, cats[1]), 1);
    ops.save();
    assert.match(read(proj, '.github/agents/shared.agent.md'), /from B/);
    const e = readLock(proj)!.files['.github/agents/shared.agent.md'];
    assert.equal(e.source, b);
    assert.equal(e.template, 'tpl-b');
});
