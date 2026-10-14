import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { classifySourceError } from '../src/core/access';
import { buildCatalog, Catalog } from '../src/core/catalog';
import { manifestOf, parseConfig, readProjectConfig, templateIdFromUrl } from '../src/core/config';
import { emptyLock, ensureSource, readLock, writeLock } from '../src/core/lock';
import { ProjectOps } from '../src/core/operations';
import { computeStatus, ProjectStatus } from '../src/core/status';
import { TemplateRepo } from '../src/core/templateRepo';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-alm-mt-'));
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
const VALUES = { appPrefix: 'ABC', ticketPrefix: 'ABC', objectIdFrom: 50100, objectIdTo: 50199, repoSlug: 'o/tpl', adoOrg: 'org', workItemSystem: 'ADO' };
const AGENT = (n: string) => `---\ndescription: ${n}. Use when: x.\ntools: ['read']\n---\n# ${n}\n`;
const SKILL = (n: string) => `---\nname: ${n}\ndescription: ${n}\n---\nbody\n`;

function makeTemplate(name: string, manifest: object | undefined, files: Record<string, string>): string {
    const dir = path.join(tmp, name);
    fs.mkdirSync(dir, { recursive: true });
    gitIn(dir, 'init', '-q', '-b', 'main');
    write(dir, 'template.config.json', JSON.stringify({ ...(manifest ? { template: manifest } : {}), values: VALUES }));
    for (const [rel, text] of Object.entries(files)) { write(dir, rel, text); }
    gitIn(dir, 'add', '-A');
    gitIn(dir, 'commit', '-q', '-m', 'init');
    return dir;
}

test('template manifest: parsed, slugified, and falls back to the repository name', () => {
    const cfg = parseConfig({ template: { id: 'BC Upgrade', name: 'BC Upgrade', version: 2, icon: '$(arrow-up)' }, values: VALUES });
    assert.deepEqual(cfg.template, { id: 'bc-upgrade', name: 'BC Upgrade', description: undefined, version: '2', icon: 'arrow-up' });
    assert.equal(manifestOf(cfg, 'https://github.com/o/whatever').id, 'bc-upgrade');

    const plain = parseConfig({ values: VALUES });
    assert.equal(plain.template, undefined);
    assert.deepEqual(manifestOf(plain, 'https://github.com/contoso/BC-Upgrade-Kit.git', 'Upgrade kit'), { id: 'bc-upgrade-kit', name: 'Upgrade kit' });
    assert.equal(templateIdFromUrl('C:\\templates\\My Template\\'), 'my-template');
    assert.equal(templateIdFromUrl('git@github.com:o/repo.git'), 'repo');
    assert.deepEqual(parseConfig({ values: { sync: { templates: { disabled: ['BC Upgrade', ''] } } } }).sync.templates.disabled, ['bc-upgrade']);
});

test('lock: source id/exclude and entry template round-trip in a stable order', () => {
    const root = path.join(tmp, 'lockproj');
    fs.mkdirSync(root, { recursive: true });
    const lock = emptyLock();
    ensureSource(lock, { url: 'https://x/a', ref: 'main', id: 'a', exclude: ['skill:z', 'agent:b', 'agent:b'] }, true);
    lock.files['.github/agents/x.agent.md'] = { source: 'https://x/a', template: 'a', path: '.github/agents/x.agent.md', commit: 'c', templateHash: 't', installedHash: 'i' };
    writeLock(root, lock);
    const text = fs.readFileSync(path.join(root, 'template.lock.json'), 'utf8');
    assert.ok(text.indexOf('"id"') < text.indexOf('"url"') && text.indexOf('"ref"') < text.indexOf('"exclude"'));
    assert.ok(text.indexOf('"source"') < text.indexOf('"template"') && text.indexOf('"template"') < text.indexOf('"path"'));
    const back = readLock(root)!;
    assert.deepEqual(back.sources[0], { name: undefined, id: 'a', url: 'https://x/a', ref: 'main', exclude: ['agent:b', 'skill:z'] });
    assert.equal(back.files['.github/agents/x.agent.md'].template, 'a');

    // Re-adding the source without a selection keeps the recorded id and exclude list.
    ensureSource(back, { url: 'https://x/a', ref: 'dev' });
    assert.deepEqual(back.sources[0].exclude, ['agent:b', 'skill:z']);
    assert.equal(back.sources[0].id, 'a');
    assert.equal(back.sources[0].ref, 'dev');
});

test('classifySourceError: access, ref, network and other', () => {
    const gh = 'https://github.com/contoso/private-tpl.git';
    const notFound = classifySourceError('git ls-remote https://github.com/contoso/private-tpl.git failed (128): remote: Repository not found.\nfatal: repository \'https://github.com/contoso/private-tpl.git/\' not found', gh);
    assert.equal(notFound.kind, 'access');
    assert.match(notFound.message, /contoso\/private-tpl/);
    assert.match(notFound.message, /gh auth login/);
    assert.equal(classifySourceError('git fetch failed (128): fatal: could not read Username for \'https://github.com\': terminal prompts disabled', gh).kind, 'access');
    assert.equal(classifySourceError('git fetch failed (128): fatal: unable to access \'https://github.com/x/y/\': The requested URL returned error: 403', gh).kind, 'access');
    const ref = classifySourceError('git fetch origin v9 failed (128): fatal: couldn\'t find remote ref v9', gh, 'v9');
    assert.equal(ref.kind, 'ref');
    assert.match(ref.message, /"v9"/);
    assert.equal(classifySourceError('git fetch failed (128): fatal: unable to access \'https://github.com/x/y/\': Could not resolve host: github.com', gh).kind, 'network');
    // A repository URL in the echoed command must not be mistaken for the error text.
    assert.equal(classifySourceError('git clone https://github.com/not-found/x failed (1): something odd happened', gh).kind, 'other');
});

test('templates: disable/enable a whole template, exclusions, and new components', async () => {
    const alm = makeTemplate('alm', { id: 'bc-alm', name: 'BC ALM' }, {
        '.github/agents/bc-dev.agent.md': AGENT('bc-dev'),
        '.github/agents/bc-pm.agent.md': AGENT('bc-pm'),
        '.github/skills/bc-ship/SKILL.md': SKILL('bc-ship'),
        'docs/workflow.md': '# workflow\n'
    });
    const upg = makeTemplate('bc-upgrade', undefined, {
        '.github/agents/bc-upgrade.agent.md': AGENT('bc-upgrade'),
        '.github/skills/bc-upgrade-scan/SKILL.md': SKILL('bc-upgrade-scan'),
        '.github/skills/bc-upgrade-fix/SKILL.md': SKILL('bc-upgrade-fix')
    });
    const proj = path.join(tmp, 'proj');
    write(proj, 'template.config.json', JSON.stringify({ initialized: true, values: VALUES }, null, 2));
    const cache = path.join(tmp, 'cache');

    async function load(): Promise<{ st: ProjectStatus; ops: ProjectOps; cats: Catalog[] }> {
        const project = readProjectConfig(proj)!;
        const cats: Catalog[] = [];
        for (const url of [alm, upg]) {
            const repo = new TemplateRepo({ url, ref: 'main' }, cache);
            await repo.ensure(0);
            cats.push(await buildCatalog(repo, await repo.resolve(), project));
        }
        const lock = readLock(proj);
        const st = await computeStatus({ root: proj, project, lock, catalogs: cats });
        return { st, ops: new ProjectOps(proj, project, lock, cats), cats };
    }
    const c = (st: ProjectStatus, id: string) => st.components.find(x => x.ref.id === id)!;

    let { st, ops, cats } = await load();
    assert.equal(cats[0].manifest.id, 'bc-alm');
    assert.equal(cats[1].manifest.id, 'bc-upgrade');
    assert.equal(c(st, 'agent:bc-dev').templateId, 'bc-alm');
    assert.equal(c(st, 'agent:bc-upgrade').templateId, 'bc-upgrade');

    for (const id of ['agent:bc-dev', 'agent:bc-pm', 'skill:bc-ship', 'doc:workflow', 'agent:bc-upgrade', 'skill:bc-upgrade-scan']) { ops.install(c(st, id)); }
    ops.setExclude(upg, ['skill:bc-upgrade-fix']);
    ops.save();
    const lock = readLock(proj)!;
    assert.equal(lock.files['.github/agents/bc-upgrade.agent.md'].template, 'bc-upgrade');
    assert.equal(lock.sources.find(s => s.url === upg)!.id, 'bc-upgrade');

    ({ st, ops } = await load());
    assert.equal(c(st, 'skill:bc-upgrade-fix').excluded, true);
    assert.equal(c(st, 'skill:bc-upgrade-fix').newInTemplate, false);

    // A new skill appears upstream -> flagged as new (not in the recorded selection).
    write(upg, '.github/skills/bc-upgrade-report/SKILL.md', SKILL('bc-upgrade-report'));
    gitIn(upg, 'add', '-A'); gitIn(upg, 'commit', '-q', '-m', 'new skill');
    ({ st, ops } = await load());
    assert.equal(c(st, 'skill:bc-upgrade-report').newInTemplate, true);
    assert.equal(c(st, 'skill:bc-upgrade-report').excluded, false);

    // Turn bc-pm off on its own, then switch the whole ALM template off.
    ops.disable(c(st, 'agent:bc-pm'));
    ({ st, ops } = await load());
    const affected = ops.disableTemplate('bc-alm', st.components);
    assert.deepEqual(affected.map(a => a.ref.id).sort(), ['agent:bc-dev', 'skill:bc-ship']);
    assert.ok(!exists(proj, '.github/agents/bc-dev.agent.md'));
    assert.ok(!exists(proj, '.github/skills/bc-ship/SKILL.md'));
    assert.ok(exists(proj, 'docs/workflow.md'), 'docs are not toggled with the template');
    assert.ok(exists(proj, '.github/agents/bc-upgrade.agent.md'));
    assert.deepEqual(readProjectConfig(proj)!.sync.templates.disabled, ['bc-alm']);

    ({ st, ops } = await load());
    assert.equal(c(st, 'agent:bc-dev').status, 'disabled');
    assert.equal(c(st, 'agent:bc-dev').templateDisabled, true);
    assert.equal(c(st, 'agent:bc-pm').templateDisabled, false, 'individually disabled stays individual');
    assert.equal(c(st, 'agent:bc-pm').disabled, true);
    assert.equal(c(st, 'doc:workflow').disabled, false);
    assert.equal(c(st, 'agent:bc-upgrade').disabled, false);
    assert.ok(ops.offByTemplate(c(st, 'agent:bc-dev')));

    // Enabling a single component of a disabled template only clears its own flag.
    ops.enable(c(st, 'agent:bc-pm'));
    assert.ok(!exists(proj, '.github/agents/bc-pm.agent.md'));

    // Re-disable bc-pm so it must stay off when the template comes back.
    ({ st, ops } = await load());
    ops.disable(c(st, 'agent:bc-pm'));
    ({ st, ops } = await load());
    const restored = ops.enableTemplate('bc-alm', st.components);
    assert.deepEqual(restored.map(r => r.ref.id).sort(), ['agent:bc-dev', 'skill:bc-ship']);
    assert.ok(exists(proj, '.github/agents/bc-dev.agent.md'));
    assert.ok(exists(proj, '.github/skills/bc-ship/SKILL.md'));
    assert.ok(!exists(proj, '.github/agents/bc-pm.agent.md'));
    assert.deepEqual(readProjectConfig(proj)!.sync.templates.disabled, []);

    ({ st } = await load());
    assert.equal(c(st, 'agent:bc-dev').status, 'current');
    assert.equal(c(st, 'agent:bc-pm').status, 'disabled');
    assert.equal(c(st, 'skill:bc-ship').status, 'current');
});
