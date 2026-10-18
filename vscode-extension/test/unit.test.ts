import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { modelKey, parseConfig } from '../src/core/config';
import { parseFeed } from '../src/core/changelog';
import { parseFrontmatter, setFrontmatterScalar } from '../src/core/frontmatter';
import { componentOf, implicitlyKeptLocal, isManaged, resolveDest, srcFromDest } from '../src/core/paths';
import { githubSlug, renamePath } from '../src/core/publish';
import { aggregateStatus, FileState } from '../src/core/status';
import { addTools, applyModel, generalize, reparameterize, transformTemplateFile, trimAzureDevOpsTools } from '../src/core/transform';
import { hashText, normalizeText, sameUrl } from '../src/core/util';
import { validateFile } from '../src/core/validator';

const tplValues = { appPrefix: 'ABC', ticketPrefix: 'ABC', objectIdFrom: 50100, objectIdTo: 50199, repoSlug: 'AlexanderErdelyi/bc-alm-template', adoOrg: 'your-org', workItemSystem: 'ADO' };

function project(values: Record<string, unknown> = {}, sync: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
    return parseConfig({ initialized: true, values: { ...tplValues, ...values, sync, ...extra } });
}

test('hashText is line-ending and BOM agnostic', () => {
    assert.equal(hashText('a\r\nb\r\n'), hashText('a\nb\n'));
    assert.equal(normalizeText('\uFEFFx\r\n'), 'x\n');
    assert.ok(sameUrl('https://github.com/O/R.git', 'https://github.com/o/r'));
});

test('componentOf maps template paths to component ids', () => {
    assert.equal(componentOf('.github/agents/bc-dev.agent.md').id, 'agent:bc-dev');
    assert.equal(componentOf('.github/skills/bc-spec-author/SKILL.md').id, 'skill:bc-spec-author');
    assert.equal(componentOf('.github/skills/bc-spec-author/templates/brief.md').id, 'skill:bc-spec-author');
    assert.equal(componentOf('.github/prompts/onboard-app.prompt.md').id, 'prompt:onboard-app');
    assert.equal(componentOf('.github/instructions/al-coding-standards.instructions.md').id, 'instruction:al-coding-standards');
    assert.equal(componentOf('.github/workflows/issue-intake.yml').id, 'workflow:issue-intake');
    assert.equal(componentOf('docs/branching-strategy.md').id, 'doc:branching-strategy');
    assert.equal(componentOf('scripts/Update-FromTemplate.ps1').id, 'file:scripts/Update-FromTemplate.ps1');
});

test('customizationsPath relocates customizations but not workflows', () => {
    const p = project({}, { customizationsPath: 'app' });
    assert.equal(resolveDest('.github/agents/bc-dev.agent.md', p.sync), 'app/.github/agents/bc-dev.agent.md');
    assert.equal(resolveDest('.github/workflows/template-sync.yml', p.sync), '.github/workflows/template-sync.yml');
    assert.equal(srcFromDest('app/.github/skills/x/SKILL.md', p.sync), '.github/skills/x/SKILL.md');
});

test('include switches control which files are managed', () => {
    const on = project();
    const off = project({}, { include: { issueOps: false, referenceDocs: false } });
    assert.ok(isManaged('.github/agents/bc-dev.agent.md', off.sync));
    assert.ok(isManaged('.github/ISSUE_ORCHESTRATION.md', on.sync));
    assert.ok(!isManaged('.github/ISSUE_ORCHESTRATION.md', off.sync));
    assert.ok(!isManaged('app/src/Foo.al', on.sync));
});

test('legacy toggles imply keepLocal', () => {
    const p = project({}, { updateInstructions: false, updateExtensions: false });
    assert.ok(implicitlyKeptLocal('instruction:al-coding-standards', p.sync));
    assert.ok(implicitlyKeptLocal('file:.vscode/extensions.json', p.sync));
    assert.ok(!implicitlyKeptLocal('agent:bc-dev', p.sync));
});

test('parseConfig reads the component policy', () => {
    const p = project({}, { components: { disabled: ['agent:bc-deploy'], keepLocal: 'skill:bc-ship-release' } });
    assert.deepEqual(p.sync.components.disabled, ['agent:bc-deploy']);
    assert.deepEqual(p.sync.components.keepLocal, ['skill:bc-ship-release']);
});

test('reparameterize swaps prefix, ticket ids, range and repo slug on word boundaries', () => {
    const to = { ...tplValues, appPrefix: 'XYZ', ticketPrefix: 'PRJ', objectIdFrom: 60000, objectIdTo: 60099, repoSlug: 'contoso/bc-app', workItemSystem: 'GitHub' };
    const s = reparameterize('ABC Sales (ABCCustomerExt, xABC) 50100–50199 ABC-12 AB#7 AlexanderErdelyi/bc-alm-template', tplValues as any, to as any);
    assert.equal(s, 'XYZ Sales (XYZCustomerExt, xABC) 60000-60099 PRJ-12 #7 contoso/bc-app');
});

test('transformTemplateFile applies models, trims ADO tools and merges extra tools', () => {
    const p = project({ workItemSystem: 'GitHub' }, {}, { extraTools: { all: ['al/*'], agents: { 'bc-dev': ['my/tool'] } } });
    p.models['bc-dev'] = 'Claude Sonnet 4';
    const raw = "---\ndescription: x\nmodel: GPT-5\ntools: ['read', 'azure-devops/*', 'edit']\n---\nABC body\n";
    const out = transformTemplateFile('.github/agents/bc-dev.agent.md', raw, { from: tplValues as any, project: p });
    assert.match(out, /^model: "Claude Sonnet 4"$/m);
    assert.match(out, /^tools: \['read', 'edit', 'al\/\*', 'my\/tool'\]$/m);
});

test('model fallback lists are parsed from config and written as a YAML array', () => {
    const p = parseConfig({ models: { _readme: 'x', 'bc-dev': ['Claude Sonnet 5.5', 'Claude Sonnet 5'], 'bc-pr': 'Claude Opus 5.5', 'bc-doc': [] } });
    assert.deepEqual(p.models['bc-dev'], ['Claude Sonnet 5.5', 'Claude Sonnet 5']);
    assert.equal(p.models['bc-pr'], 'Claude Opus 5.5');
    assert.equal(p.models['bc-doc'], undefined);
    assert.equal(applyModel('model: "X"', p.models['bc-dev']), 'model: ["Claude Sonnet 5.5", "Claude Sonnet 5"]');
    assert.equal(applyModel('model: ["A", "B"]', 'Claude Opus 5.5'), 'model: "Claude Opus 5.5"');
    assert.equal(modelKey('A'), modelKey(['A']));
    assert.notEqual(modelKey(['A', 'B']), modelKey(['B', 'A']));
});

test('addTools is idempotent and trimAzureDevOpsTools handles every position', () => {
    const t = "tools: ['a']";
    assert.equal(addTools(addTools(t, ['b']), ['b']), "tools: ['a', 'b']");
    assert.equal(trimAzureDevOpsTools("['azure-devops/*', 'x']"), "['x']");
    assert.equal(trimAzureDevOpsTools("['x', 'azure-devops/*']"), "['x']");
});

test('generalize reverses project values and drops project-only tools', () => {
    const p = project({ appPrefix: 'XYZ', repoSlug: 'contoso/bc-app' }, {}, { extraTools: { all: ['al/*'] } });
    const local = "---\ntools: ['read', 'al/*']\n---\nXYZ agent for contoso/bc-app\n";
    const g = generalize('.github/agents/x.agent.md', local, p, tplValues as any);
    assert.equal(g.text, "---\ntools: ['read']\n---\nABC agent for AlexanderErdelyi/bc-alm-template\n");
    assert.equal(g.changes.length, 2);
});

test('frontmatter parsing and scalar update', () => {
    const text = "---\nname: x\ndescription: 'Does things. Use when: y'\ntools: ['a', \"b\"]\n---\nbody\n";
    const fm = parseFrontmatter(text);
    assert.equal(fm.present, true);
    assert.equal(fm.data['description'], 'Does things. Use when: y');
    assert.deepEqual(fm.data['tools'], ['a', 'b']);
    assert.match(setFrontmatterScalar(text, 'name', 'z'), /^name: "z"$/m);
});

test('validator flags retired keys, bad skill names and legacy chat modes', () => {
    const ctx = { knownAgents: new Set<string>() };
    const agent = validateFile('.github/agents/a.agent.md', '---\ndescription: hi\ninfer: false\n---\nx\n', ctx);
    assert.ok(agent.some(f => f.code === 'agent-infer-retired' && f.fix?.kind === 'removeKeyLine'));
    const noDesc = validateFile('.github/agents/a.agent.md', '---\nname: a\n---\nx\n', ctx);
    assert.ok(noDesc.some(f => f.code === 'agent-description' && f.severity === 'error'));
    const skill = validateFile('.github/skills/My_Skill/SKILL.md', '---\nname: My_Skill\ndescription: d\n---\nx\n', ctx);
    assert.ok(skill.some(f => f.severity !== 'info'), JSON.stringify(skill));
    const mode = validateFile('.github/chatmodes/m.chatmode.md', '---\ndescription: d\n---\n', ctx);
    assert.ok(mode.some(f => f.code === 'legacy-chatmode'));
    assert.deepEqual(validateFile('README.md', 'x', ctx), []);
});

test('aggregateStatus ranks conflicts first and ignores not-installed files', () => {
    const f = (status: FileState['status']) => ({ status } as FileState);
    assert.equal(aggregateStatus([f('current'), f('update'), f('conflict')]), 'conflict');
    assert.equal(aggregateStatus([f('current'), f('available')]), 'current');
    assert.equal(aggregateStatus([f('available'), f('available')]), 'available');
    assert.equal(aggregateStatus([f('current'), f('new')]), 'new');
});

test('publish helpers', () => {
    assert.deepEqual(githubSlug('https://github.com/contoso/my-template.git'), { owner: 'contoso', repo: 'my-template' });
    assert.equal(githubSlug('C:\\repos\\tpl'), undefined);
    assert.equal(renamePath('.github/agents/bc-dev.agent.md', 'bc-dev', 'bc-dev-acme'), '.github/agents/bc-dev-acme.agent.md');
    assert.equal(renamePath('.github/skills/bc-x/SKILL.md', 'bc-x', 'acme-x'), '.github/skills/acme-x/SKILL.md');
});

test('parseFeed filters RSS items by keyword', () => {
    const xml = `<rss><channel>
<item><title>Custom agents now support handoffs</title><link>https://a</link><pubDate>Mon, 01 Jun 2026 10:00:00 GMT</pubDate><description><![CDATA[<p>New &amp; improved</p>]]></description></item>
<item><title>Billing update</title><link>https://b</link><description>nothing</description></item>
</channel></rss>`;
    const items = parseFeed(xml, ['agent']);
    assert.equal(items.length, 1);
    assert.equal(items[0].link, 'https://a');
    assert.equal(items[0].summary, 'New & improved');
    assert.equal(parseFeed(xml, []).length, 2);
});
