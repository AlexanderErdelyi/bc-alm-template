import * as fs from 'fs';
import * as path from 'path';
import { CONFIG_FILE, ProjectConfig, slugId, TemplateManifest, TemplateValues } from './config';
import { git } from './exec';
import { componentOf, srcFromDest } from './paths';
import { generalize } from './transform';
import { normalizeText, readTextIfExists, safeRemove } from './util';

/** Placeholder values of a new template; seeded components are generalized to these. */
export function placeholderValues(project: ProjectConfig | undefined, repoSlug: string): TemplateValues {
    return {
        appPrefix: 'ABC',
        ticketPrefix: 'ABC',
        appName: 'ABC App',
        publisher: 'ABC',
        objectIdFrom: 50100,
        objectIdTo: 50199,
        repoSlug,
        adoOrg: 'your-organization',
        adoProject: '',
        workItemSystem: project?.values.workItemSystem ?? 'ADO',
        defaultBranch: 'main'
    };
}

export interface SeedFile {
    srcRel: string;
    text: string;
    changes: string[];
}

/** Project files of the chosen components, generalized from the project's values to the template placeholders. */
export function seedFromProject(root: string, project: ProjectConfig, destFiles: string[], target: TemplateValues): SeedFile[] {
    const out: SeedFile[] = [];
    for (const destRel of destFiles) {
        const local = readTextIfExists(path.join(root, ...destRel.split('/')));
        if (local === undefined) { continue; }
        const srcRel = srcFromDest(destRel, project.sync);
        const g = generalize(srcRel, normalizeText(local), project, target);
        out.push({ srcRel, text: g.text, changes: g.changes });
    }
    return out;
}

function readme(m: TemplateManifest, seeded: SeedFile[]): string {
    const comps = [...new Set(seeded.map(f => componentOf(f.srcRel)).filter(r => r.kind !== 'file').map(r => `- ${r.kind} \`${r.name}\``))].sort();
    return [
        `# ${m.name}`,
        '',
        m.description ?? 'A Copilot template for Business Central projects.',
        '',
        'This repository is a template source for the [BC ALM VS Code extension](https://github.com/AlexanderErdelyi/bc-alm-template/tree/main/vscode-extension).',
        'Add it under **Template Sources**, choose **Use in This Project**, then pick the components you want.',
        '',
        '## Layout',
        '',
        '| Folder | Contents |',
        '| --- | --- |',
        '| `.github/agents/` | Custom agents (`<name>.agent.md`) |',
        '| `.github/skills/` | Agent skills (`<name>/SKILL.md`) |',
        '| `.github/prompts/` | Prompt files (`<name>.prompt.md`) |',
        '| `.github/instructions/` | Instructions (`<name>.instructions.md`) |',
        '',
        '`template.config.json` holds the template identity (`template` block) and the placeholder values',
        '(`values`) that projects replace with their own prefix, object range and repository.',
        ...(comps.length ? ['', '## Components', '', ...comps] : []),
        ''
    ].join('\n');
}

/** Write a new template repository into the empty folder `dir`. Returns the written paths. */
export function scaffoldTemplate(dir: string, manifest: TemplateManifest, values: TemplateValues, seeded: SeedFile[] = []): string[] {
    const written: string[] = [];
    const put = (rel: string, text: string) => {
        const abs = path.join(dir, ...rel.split('/'));
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, text, 'utf8');
        written.push(rel);
    };
    const config = {
        _readme: 'Template identity and placeholder values. Projects that use this template replace the values with their own; keep the template block id stable and unique.',
        template: { id: manifest.id, name: manifest.name, ...(manifest.description ? { description: manifest.description } : {}), version: manifest.version ?? '0.1.0', ...(manifest.icon ? { icon: manifest.icon } : {}) },
        initialized: false,
        values
    };
    put(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
    put('README.md', readme(manifest, seeded));
    for (const f of seeded) { put(f.srcRel, f.text); }
    for (const d of ['agents', 'skills', 'prompts', 'instructions']) {
        if (!seeded.some(f => f.srcRel.startsWith(`.github/${d}/`))) { put(`.github/${d}/.gitkeep`, ''); }
    }
    return written;
}

/** Set the "template" identity block of a template.config.json text, keeping everything else (and key order) intact. */
export function withManifest(configText: string, manifest: TemplateManifest): string {
    const raw = JSON.parse(configText.replace(/^\uFEFF/, ''));
    const block = { ...(raw.template ?? {}), id: manifest.id, name: manifest.name, ...(manifest.description ? { description: manifest.description } : {}), ...(manifest.version ? { version: manifest.version } : {}), ...(manifest.icon ? { icon: manifest.icon } : {}) };
    const out: Record<string, unknown> = {};
    let placed = false;
    for (const [k, v] of Object.entries(raw)) {
        if (k === 'template') { out.template = block; placed = true; continue; }
        if (!placed && k !== '_readme' && k !== '$schema') { out.template = block; placed = true; }
        out[k] = v;
    }
    if (!placed) { out.template = block; }
    const eol = /\r\n/.test(configText) ? '\r\n' : '\n';
    return JSON.stringify(out, null, 2).replace(/\n/g, eol) + eol;
}

async function commitAll(dir: string, message: string): Promise<void> {
    const ident = await git(['config', 'user.email'], dir, { allowFailure: true });
    const who = ident.stdout.trim() ? [] : ['-c', 'user.name=BC ALM', '-c', 'user.email=bc-alm@users.noreply.github.com'];
    await git(['add', '-A'], dir);
    await git([...who, 'commit', '--quiet', '-m', message], dir);
}

async function pushWithRetry(dir: string, remote: string, refspec: string): Promise<void> {
    let last = '';
    for (let i = 0; i < 5; i++) {
        const r = await git(['push', '--quiet', remote, refspec], dir, { allowFailure: true });
        if (r.code === 0) { return; }
        last = r.stderr.trim();
        await new Promise(res => setTimeout(res, 2000));
    }
    throw new Error(`Pushing to ${remote} failed. Check your git credentials ("gh auth setup-git").\n${last}`);
}

/** Commit the scaffolded folder and push it as `ref` to the (empty) repository `remoteUrl`. */
export async function pushNewTemplate(dir: string, remoteUrl: string, ref: string, log: (l: string) => void = () => undefined): Promise<void> {
    await git(['init', '--quiet', '-b', ref], dir);
    await commitAll(dir, 'chore: create Copilot template');
    log(`Pushing ${ref} to ${remoteUrl}…`);
    await pushWithRetry(dir, remoteUrl, `HEAD:refs/heads/${ref}`);
}

/** Give a copied template its own identity (so it does not collide with the template it came from). */
export async function setTemplateIdentity(url: string, ref: string, manifest: TemplateManifest, workRoot: string, log: (l: string) => void = () => undefined): Promise<boolean> {
    fs.mkdirSync(workRoot, { recursive: true });
    const dir = fs.mkdtempSync(path.join(workRoot, 'id-'));
    try {
        await git(['clone', '--quiet', '--depth', '1', '--branch', ref, url, dir]);
        const file = path.join(dir, CONFIG_FILE);
        const text = readTextIfExists(file);
        if (text === undefined) { log(`${CONFIG_FILE} not found - template identity not set.`); return false; }
        const next = withManifest(text, manifest);
        if (next === text) { return false; }
        fs.writeFileSync(file, next, 'utf8');
        await commitAll(dir, `chore: set template identity "${manifest.id}"`);
        log(`Setting template identity "${manifest.id}"…`);
        await pushWithRetry(dir, 'origin', `HEAD:refs/heads/${ref}`);
        return true;
    } finally {
        safeRemove(dir, log);
    }
}

export function manifestFromInput(name: string, description?: string, icon?: string): TemplateManifest {
    return { id: slugId(name), name: name.trim(), ...(description?.trim() ? { description: description.trim() } : {}), version: '0.1.0', ...(icon ? { icon } : {}) };
}
