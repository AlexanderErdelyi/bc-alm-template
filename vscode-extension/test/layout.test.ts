import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findAppJson, guessPrefixFromAl, parseRemote } from '../src/core/detect';
import { fromBcAlmLayout, migrateToBcAlm, needsMigration, relocationDepth, stateDirOf, toBcAlmLayout } from '../src/core/layout';
import { hashText } from '../src/core/util';

function tmpDir(): string {
    return fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'bc-alm-layout-')));
}

function write(root: string, rel: string, text: string): void {
    const p = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text, 'utf8');
}

test('toBcAlmLayout rewrites root file references and is idempotent', () => {
    const src = [
        'Run `scripts/Update-FromTemplate.ps1` or ./scripts/Add-BCQuality.ps1.',
        'See [config](../template.config.json) and template.lock.json and .templatesyncignore.',
        '"command": "${workspaceFolder}/scripts/Start-ALLanguageServer.ps1"',
        'Keep scripts/MyOwn.ps1 and https://x/scripts/Update-FromTemplate.ps1 unchanged.'
    ].join('\n');
    const out = toBcAlmLayout(src);
    assert.match(out, /`\.bc-alm\/scripts\/Update-FromTemplate\.ps1`/);
    assert.match(out, /\.\/\.bc-alm\/scripts\/Add-BCQuality\.ps1/);
    assert.match(out, /\(\.\.\/\.bc-alm\/template\.config\.json\)/);
    assert.match(out, / \.bc-alm\/template\.lock\.json /);
    assert.match(out, / \.bc-alm\/\.templatesyncignore\./);
    assert.match(out, /\$\{workspaceFolder\}\/\.bc-alm\/scripts\/Start-ALLanguageServer\.ps1/);
    assert.match(out, /scripts\/MyOwn\.ps1/);
    assert.match(out, /https:\/\/x\/scripts\/Update-FromTemplate\.ps1/);
    assert.equal(toBcAlmLayout(out), out);
    assert.equal(fromBcAlmLayout(out), src);
});

test('toBcAlmLayout adds ../ for files relocated under customizationsPath', () => {
    assert.equal(toBcAlmLayout('${workspaceFolder}/scripts/Add-BCQuality.ps1', 1), '${workspaceFolder}/../.bc-alm/scripts/Add-BCQuality.ps1');
    assert.equal(toBcAlmLayout('[c](../template.config.json)', 1), '[c](../../.bc-alm/template.config.json)');
    assert.equal(toBcAlmLayout('scripts/Update-FromTemplate.ps1', 1), '.bc-alm/scripts/Update-FromTemplate.ps1');
    assert.equal(fromBcAlmLayout('[c](../../.bc-alm/template.config.json)', 1), '[c](../template.config.json)');
    assert.equal(relocationDepth('app/.github/agents/x.agent.md', 'app'), 1);
    assert.equal(relocationDepth('.github/agents/x.agent.md', 'app'), 0);
});

test('migrateToBcAlm moves bookkeeping files and renames lock keys', () => {
    const root = tmpDir();
    try {
        write(root, 'template.config.json', JSON.stringify({ initialized: true, values: {} }));
        write(root, 'template.lock.json', JSON.stringify({ version: 1, sources: [], files: {
            'scripts/Update-FromTemplate.ps1': { source: 's', path: 'scripts/Update-FromTemplate.ps1', commit: 'c', templateHash: 'h', installedHash: 'h' },
            '.github/agents/a.agent.md': { source: 's', path: '.github/agents/a.agent.md', commit: 'c', templateHash: 'h', installedHash: 'h' }
        } }));
        write(root, 'scripts/Update-FromTemplate.ps1', '# x');
        write(root, 'scripts/Mine.ps1', '# mine');
        write(root, 'PROJECT.md', '# p');
        write(root, 'README.md', 'See [PROJECT.md](PROJECT.md) and run ./scripts/Update-FromTemplate.ps1');
        assert.ok(needsMigration(root));
        const r = migrateToBcAlm(root);
        assert.equal(stateDirOf(root), '.bc-alm');
        assert.ok(!needsMigration(root));
        assert.ok(fs.existsSync(path.join(root, '.bc-alm', 'scripts', 'Update-FromTemplate.ps1')));
        assert.ok(fs.existsSync(path.join(root, '.bc-alm', 'PROJECT.md')));
        assert.ok(fs.existsSync(path.join(root, 'scripts', 'Mine.ps1')), 'user scripts stay');
        assert.equal(r.renamed['scripts/Update-FromTemplate.ps1'], '.bc-alm/scripts/Update-FromTemplate.ps1');
        const lock = JSON.parse(fs.readFileSync(path.join(root, '.bc-alm', 'template.lock.json'), 'utf8'));
        assert.deepEqual(Object.keys(lock.files), ['.bc-alm/scripts/Update-FromTemplate.ps1', '.github/agents/a.agent.md']);
        const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
        assert.equal(readme, 'See [PROJECT.md](.bc-alm/PROJECT.md) and run ./.bc-alm/scripts/Update-FromTemplate.ps1');
        assert.ok(hashText(readme));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('parseRemote recognizes Azure DevOps and GitHub remotes', () => {
    assert.deepEqual(parseRemote('https://cosmo@dev.azure.com/cosmo/RMG%20Messtechnik/_git/RMG-Base-App'), { kind: 'ADO', adoOrg: 'cosmo', adoProject: 'RMG Messtechnik' });
    assert.deepEqual(parseRemote('git@ssh.dev.azure.com:v3/cosmo/Proj/Repo'), { kind: 'ADO', adoOrg: 'cosmo', adoProject: 'Proj' });
    assert.deepEqual(parseRemote('https://cosmo.visualstudio.com/DefaultCollection/Proj/_git/Repo'), { kind: 'ADO', adoOrg: 'cosmo', adoProject: 'Proj' });
    assert.deepEqual(parseRemote('cosmo@vs-ssh.visualstudio.com:v3/cosmo/Proj/Repo'), { kind: 'ADO', adoOrg: 'cosmo', adoProject: 'Proj' });
    assert.deepEqual(parseRemote('https://github.com/Owner/my.repo.git'), { kind: 'GitHub', repoSlug: 'Owner/my.repo' });
    assert.deepEqual(parseRemote('git@github.com:Owner/repo.git'), { kind: 'GitHub', repoSlug: 'Owner/repo' });
    assert.equal(parseRemote('https://gitlab.com/a/b'), undefined);
});

test('findAppJson prefers the production app over the test app; prefix guessed from AL names', () => {
    const root = tmpDir();
    try {
        write(root, 'test/app.json', JSON.stringify({ name: 'RMG-Base-App - Tests', idRanges: [{ from: 50900, to: 50999 }] }));
        write(root, 'app/app.json', JSON.stringify({ name: 'RMG-Base-App', publisher: 'Cosmo Consult', idRanges: [{ from: 50100, to: 50899 }] }));
        write(root, 'app/src/a.Table.al', 'table 50100 "RMG Setup"\n{\n}\n');
        write(root, 'app/src/b.Page.al', 'page 50101 "RMG Setup Card"\n{\n}\n');
        write(root, 'app/src/c.Codeunit.al', 'codeunit 50102 "RMG Mgt."\n{\n}\n');
        write(root, 'app/src/d.TableExt.al', 'tableextension 50103 "Customer Ext" extends Customer\n{\n}\n');
        assert.equal(findAppJson(root), path.join(root, 'app', 'app.json'));
        assert.equal(findAppJson(root, path.join(root, 'test')), path.join(root, 'app', 'app.json'));
        assert.equal(guessPrefixFromAl(path.join(root, 'app')), 'RMG');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
