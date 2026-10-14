import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    addChangelogEntry, bumpVersion, catalogTemplateFiles, changelogSection, compareSemver, LATEST_REF, pinnedVersion,
    suggestBump, templateTag, templateVersionTags, withTemplateVersion
} from '../src/core/catalogAuthoring';
import { buildCatalog } from '../src/core/catalog';
import { parseConfig } from '../src/core/config';
import { deliverChanges, pushTag } from '../src/core/publish';
import { TemplateRepo } from '../src/core/templateRepo';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-alm-auth-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function write(root: string, rel: string, text: string) {
    const p = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text, 'utf8');
}
function gitIn(cwd: string, ...args: string[]): string {
    return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: 'pipe' }).toString();
}
function commit(dir: string, msg: string) { gitIn(dir, 'add', '-A'); gitIn(dir, 'commit', '-q', '-m', msg); }
const VALUES = { appPrefix: 'ABC', ticketPrefix: 'ABC', objectIdFrom: 50100, objectIdTo: 50199, repoSlug: 'o/tpl', adoOrg: 'org', workItemSystem: 'ADO' };
const AGENT = (n: string, extra = '') => `---\ndescription: ${n}. Use when: x.\n---\n# ${n}\n${extra}`;

test('semver, bump suggestions and per-template tags', () => {
    assert.equal(bumpVersion('1.2.3', 'patch'), '1.2.4');
    assert.equal(bumpVersion('1.2.3', 'minor'), '1.3.0');
    assert.equal(bumpVersion('1.2.3', 'major'), '2.0.0');
    assert.equal(bumpVersion(undefined, 'patch'), '0.1.0');
    assert.ok(compareSemver('1.10.0', '1.9.9') > 0);
    assert.equal(suggestBump(['fix: a', 'docs: b']), 'patch');
    assert.equal(suggestBump(['fix: a', 'feat(bc-upgrade): add skill']), 'minor');
    assert.equal(suggestBump(['feat!: drop agent']), 'major');
    assert.equal(templateTag('bc-upgrade', 'v1.3.0'), 'bc-upgrade/v1.3.0');
    const tags = ['bc-upgrade/v1.2.0', 'bc-upgrade/v1.10.0', 'bc-alm/v2.0.0', 'bc-upgrade-x/v9.0.0', 'bc-upgrade/vnext', 'v1.0.0'];
    assert.deepEqual(templateVersionTags(tags, 'bc-upgrade').map(t => t.version), ['1.10.0', '1.2.0']);
    assert.equal(pinnedVersion('bc-upgrade/v1.2.0', 'bc-upgrade'), '1.2.0');
    assert.equal(pinnedVersion('main', 'bc-upgrade'), undefined);
    assert.equal(pinnedVersion('bc-alm/v1.0.0', 'bc-upgrade'), undefined);
});

test('changelog entries and version edits keep the file shape', () => {
    const created = addChangelogEntry(undefined, '0.1.0', ['Initial version.'], '2026-01-02');
    assert.equal(created, '# Changelog\n\n## [0.1.0] - 2026-01-02\n\n- Initial version.\n');
    const next = addChangelogEntry(created.replace(/\n/g, '\r\n'), '0.2.0', ['feat: add skill x', '- fix y'], '2026-02-03');
    assert.ok(/\r\n/.test(next) && !/(?<!\r)\n/.test(next));
    const lf = next.replace(/\r\n/g, '\n');
    assert.ok(lf.indexOf('## [0.2.0]') < lf.indexOf('## [0.1.0]'));
    assert.match(lf, /- feat: add skill x\n- fix y\n/);
    assert.equal(changelogSection(lf, '0.2.0'), '- feat: add skill x\n- fix y');
    assert.equal(changelogSection(lf, '9.9.9'), undefined);
    const headOnly = addChangelogEntry('# Changelog\n\nAll notable changes.\n', '1.0.0', [], '2026-01-01');
    assert.match(headOnly, /^# Changelog\n\n## \[1\.0\.0\] - 2026-01-01\n\n- Maintenance release\.\n\nAll notable changes\.\n$/);

    const cfgText = '{\r\n  "_readme": "x",\r\n  "template": { "id": "a", "name": "A", "version": "1.0.0" },\r\n  "values": {}\r\n}\r\n';
    const out = withTemplateVersion(cfgText, '1.1.0');
    assert.equal(JSON.parse(out).template.version, '1.1.0');
    assert.deepEqual(Object.keys(JSON.parse(out)), ['_readme', 'template', 'values']);
    assert.ok(out.endsWith('}\r\n'));
    assert.throws(() => withTemplateVersion('{}', '1.0.0'), /no "template" block/);
});

test('catalogTemplateFiles: plain template and variant scaffolds', () => {
    const plain = catalogTemplateFiles({ id: 'bc-upgrade', name: 'BC Upgrade', description: 'Upgrades', version: '0.1.0', maintainers: ['alice'] },
        [{ srcRel: '.github/agents/up.agent.md', text: AGENT('up'), changes: [] }], VALUES as never, '2026-01-01');
    const paths = plain.map(f => f.path);
    assert.deepEqual(paths, ['.templates/bc-upgrade/template.config.json', '.templates/bc-upgrade/README.md', '.templates/bc-upgrade/CHANGELOG.md', '.templates/bc-upgrade/.github/agents/up.agent.md']);
    const cfg = parseConfig(JSON.parse(plain[0].text));
    assert.equal(cfg.template!.id, 'bc-upgrade');
    assert.deepEqual(cfg.template!.maintainers, ['alice']);
    assert.equal(cfg.values.appPrefix, 'ABC');
    assert.match(plain[1].text, /agent `up`/);
    assert.match(plain[2].text, /## \[0\.1\.0\] - 2026-01-01/);

    const variant = catalogTemplateFiles({ id: 'bc-alm-lite', name: 'Lite', extends: 'bc-alm', remove: ['agent:bc-deploy'] }, [], VALUES as never);
    const raw = JSON.parse(variant[0].text);
    assert.equal(raw.template.extends, 'bc-alm');
    assert.deepEqual(raw.template.remove, ['agent:bc-deploy']);
    assert.ok(!('values' in raw), 'variants inherit the base values');
    assert.match(variant[1].text, /Variant of `bc-alm`/);
});

/** A bare "remote" plus a working clone used to push commits to it. */
function makeRemote(name: string): { remote: string; work: string } {
    const remote = path.join(tmp, `${name}.git`);
    const work = path.join(tmp, `${name}-work`);
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
    fs.mkdirSync(work, { recursive: true });
    gitIn(work, 'init', '-q', '-b', 'main');
    write(work, 'template.config.json', JSON.stringify({ template: { id: 'bc-alm', name: 'BC ALM', version: '1.0.0' }, values: VALUES }, null, 2) + '\n');
    write(work, '.github/agents/bc-plan.agent.md', AGENT('bc-plan'));
    write(work, '.github/agents/bc-deploy.agent.md', AGENT('bc-deploy'));
    write(work, '.templates/bc-upgrade/template.config.json', JSON.stringify({ template: { id: 'bc-upgrade', name: 'BC Upgrade', version: '1.2.0' }, values: VALUES }, null, 2) + '\n');
    write(work, '.templates/bc-upgrade/.github/agents/up.agent.md', AGENT('up'));
    write(work, '.templates/lite/template.config.json', JSON.stringify({ template: { id: 'lite', name: 'Lite', extends: 'bc-alm' } }));
    write(work, '.templates/lite/.github/agents/bc-plan.agent.md', AGENT('bc-plan', 'lite\n'));
    commit(work, 'init');
    gitIn(work, 'remote', 'add', 'origin', remote);
    gitIn(work, 'push', '-q', 'origin', 'main');
    return { remote, work };
}

test('tags: latest resolves per template, pinned sources write to the default branch', async () => {
    const { remote, work } = makeRemote('tags');
    gitIn(work, 'tag', 'bc-upgrade/v1.2.0');
    write(work, '.templates/bc-upgrade/.github/agents/up.agent.md', AGENT('up', 'v1.3\n'));
    commit(work, 'feat: up 1.3');
    gitIn(work, 'tag', 'bc-upgrade/v1.3.0');
    gitIn(work, 'tag', 'bc-alm/v9.0.0', 'HEAD~1');
    gitIn(work, 'push', '-q', 'origin', 'main', '--tags');
    const cache = path.join(tmp, 'cache-tags');
    const up = new TemplateRepo({ url: remote, ref: LATEST_REF, path: '.templates/bc-upgrade' }, cache);
    await up.ensure(0);
    assert.equal(await up.templateId(), 'bc-upgrade');
    assert.deepEqual((await up.versions()).map(v => v.version), ['1.3.0', '1.2.0']);
    const sha = await up.resolve();
    assert.equal(sha, gitIn(work, 'rev-parse', 'bc-upgrade/v1.3.0^{commit}').trim());
    assert.match((await up.readFile(sha, '.github/agents/up.agent.md'))!, /v1\.3/);
    assert.equal(await up.branchForWrites(), 'main');

    const root = new TemplateRepo({ url: remote, ref: 'bc-alm/v9.0.0' }, cache);
    assert.equal(await root.templateId(), 'bc-alm');
    assert.deepEqual((await root.versions()).map(v => v.tag), ['bc-alm/v9.0.0']);
    assert.equal(await root.branchForWrites(), 'main');
    assert.deepEqual(await root.mirror.branches(), ['main']);

    const none = new TemplateRepo({ url: remote, ref: LATEST_REF, path: '.templates/lite' }, cache);
    await assert.rejects(() => none.resolve(), /no released versions yet/);
});

test('variants: base changed after the override is reported', async () => {
    const { remote, work } = makeRemote('basechg');
    const cache = path.join(tmp, 'cache-bc');
    const lite = new TemplateRepo({ url: remote, ref: 'main', path: '.templates/lite' }, cache);
    await lite.ensure(0);
    let sha = await lite.resolve();
    assert.equal((await lite.baseChanged(sha)).size, 0);
    const base = await lite.baseRepo(sha);
    assert.equal(base?.root, '');
    assert.match((await base!.readFile(sha, '.github/agents/bc-plan.agent.md'))!, /^---/);
    assert.ok(!(await base!.readFile(sha, '.github/agents/bc-plan.agent.md'))!.includes('lite'));

    write(work, '.github/agents/bc-plan.agent.md', AGENT('bc-plan', 'base v2\n'));
    commit(work, 'fix: base plan');
    gitIn(work, 'push', '-q', 'origin', 'main');
    await lite.ensure(0);
    sha = await lite.resolve();
    assert.deepEqual([...await lite.baseChanged(sha)], ['agent:bc-plan']);
    const cat = await buildCatalog(lite, sha, parseConfig({ values: VALUES }));
    assert.deepEqual([...cat.variant!.baseChanged], ['agent:bc-plan']);
    assert.ok(!(await new TemplateRepo({ url: remote, ref: 'main' }, cache).baseRepo(sha)));
});

test('deliverChanges: direct commit with tag, deletions, and pull request branches', async () => {
    const { remote, work } = makeRemote('deliver');
    const cache = path.join(tmp, 'cache-del');
    const workRoot = path.join(tmp, 'work-del');
    const up = new TemplateRepo({ url: remote, ref: 'main', path: '.templates/bc-upgrade' }, cache);
    await up.ensure(0);
    const sha = await up.resolve();
    const cfgPath = up.writePath('template.config.json');
    const cfgText = (await up.mirror.readFile(sha, cfgPath))!;
    const res = await deliverChanges(up, [
        { path: cfgPath, text: withTemplateVersion(cfgText, '1.3.0') },
        { path: up.writePath('CHANGELOG.md'), text: addChangelogEntry(undefined, '1.3.0', ['release']) },
        { path: '.github/agents/bc-deploy.agent.md' }
    ], { workRoot, delivery: 'direct', message: 'chore(bc-upgrade): release v1.3.0', branchName: 'x', tag: 'bc-upgrade/v1.3.0' });
    assert.equal(res.branch, 'main');
    assert.equal(res.tag, 'bc-upgrade/v1.3.0');
    gitIn(work, 'pull', '-q', 'origin', 'main', '--tags');
    assert.equal(JSON.parse(fs.readFileSync(path.join(work, '.templates/bc-upgrade/template.config.json'), 'utf8')).template.version, '1.3.0');
    assert.ok(!fs.existsSync(path.join(work, '.github/agents/bc-deploy.agent.md')));
    assert.equal(gitIn(work, 'rev-parse', 'bc-upgrade/v1.3.0^{commit}').trim(), gitIn(work, 'rev-parse', 'HEAD').trim());
    assert.deepEqual(fs.readdirSync(workRoot), [], 'work clone is cleaned up');

    // A pinned source (tag) delivers a pull request branch against the default branch; a local remote has no PR URL.
    const pinned = new TemplateRepo({ url: remote, ref: 'bc-upgrade/v1.3.0', path: '.templates/bc-upgrade' }, cache);
    await pinned.ensure(0);
    const pr = await deliverChanges(pinned, [{ path: pinned.writePath('.github/agents/new.agent.md'), text: AGENT('new') }],
        { workRoot, delivery: 'pullRequest', message: 'feat(bc-upgrade): add new', branchName: 'agent new' });
    assert.equal(pr.base, 'main');
    assert.match(pr.branch, /^bc-alm\/agent-new-\d{8}-\d{6}$/);
    assert.equal(pr.prUrl, undefined);
    assert.match(gitIn(work, 'ls-remote', '--heads', 'origin'), /refs\/heads\/bc-alm\/agent-new-/);

    await assert.rejects(() => deliverChanges(up, [{ path: '../x', text: 'x' }], { workRoot, delivery: 'direct', message: 'm', branchName: 'x' }), /Invalid path/);
    await assert.rejects(() => deliverChanges(up, [{ path: '.github/agents/bc-plan.agent.md', text: AGENT('bc-plan') }], { workRoot, delivery: 'direct', message: 'm', branchName: 'x' }), /Nothing to publish/);

    // Tag an existing (merged) commit from the mirror.
    await up.ensure(0);
    const head = await up.resolve('main');
    await pushTag(up, head, 'bc-upgrade/v1.3.1');
    assert.ok((await up.mirror.tags()).includes('bc-upgrade/v1.3.1'));
});
