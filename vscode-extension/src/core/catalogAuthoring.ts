import { CONFIG_FILE, slugId, TemplateManifest, TemplateValues } from './config';
import { componentOf } from './paths';
import type { SeedFile } from './newTemplate';

/** Folder of a catalog repository that holds additional templates (one sub-folder per template id). */
export const CATALOG_DIR = '.templates';

/** Ref value that follows the newest released version (`<id>/v*` tag) of a template. */
export const LATEST_REF = 'latest';

export type Bump = 'patch' | 'minor' | 'major';

export function parseSemver(v: string | undefined): [number, number, number] | undefined {
    const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec((v ?? '').trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

export function compareSemver(a: string, b: string): number {
    const x = parseSemver(a) ?? [0, 0, 0];
    const y = parseSemver(b) ?? [0, 0, 0];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

export function bumpVersion(v: string | undefined, kind: Bump): string {
    const s = parseSemver(v);
    if (!s) { return kind === 'major' ? '1.0.0' : '0.1.0'; }
    if (kind === 'major') { return `${s[0] + 1}.0.0`; }
    if (kind === 'minor') { return `${s[0]}.${s[1] + 1}.0`; }
    return `${s[0]}.${s[1]}.${s[2] + 1}`;
}

/** Conventional-commit based suggestion: breaking -> major, feat -> minor, anything else -> patch. */
export function suggestBump(subjects: string[]): Bump {
    if (subjects.some(s => /^\w+(\([^)]*\))?!:/.test(s) || /BREAKING CHANGE/.test(s))) { return 'major'; }
    if (subjects.some(s => /^feat(\([^)]*\))?:/.test(s))) { return 'minor'; }
    return 'patch';
}

export function templateTag(id: string, version: string): string {
    return `${id}/v${version.replace(/^v/, '')}`;
}

export interface VersionTag { tag: string; version: string }

/** Released versions of template `id` (tags `<id>/v<semver>`), newest first. Tags of other templates are ignored. */
export function templateVersionTags(tags: string[], id: string): VersionTag[] {
    const prefix = `${id}/v`;
    return tags.filter(t => t.startsWith(prefix) && parseSemver(t.slice(prefix.length)))
        .map(t => ({ tag: t, version: t.slice(prefix.length) }))
        .sort((a, b) => compareSemver(b.version, a.version));
}

/** The version a ref pins to when it is a release tag of template `id`. */
export function pinnedVersion(ref: string, id: string): string | undefined {
    const prefix = `${id}/v`;
    return ref.startsWith(prefix) && parseSemver(ref.slice(prefix.length)) ? ref.slice(prefix.length) : undefined;
}

/** Set template.version in a template.config.json text (keeps key order and line endings). */
export function withTemplateVersion(configText: string, version: string): string {
    const raw = JSON.parse(configText.replace(/^\uFEFF/, ''));
    if (!raw.template || typeof raw.template !== 'object') { throw new Error(`${CONFIG_FILE} has no "template" block.`); }
    raw.template.version = version;
    const eol = /\r\n/.test(configText) ? '\r\n' : '\n';
    return JSON.stringify(raw, null, 2).replace(/\n/g, eol) + eol;
}

export function today(): string {
    return new Date().toISOString().slice(0, 10);
}

/** Add a "## [version] - date" section at the top of a CHANGELOG.md (creating it when missing). */
export function addChangelogEntry(text: string | undefined, version: string, lines: string[], date = today()): string {
    const eol = text && /\r\n/.test(text) ? '\r\n' : '\n';
    const body = (lines.length ? lines : ['Maintenance release.']).map(l => `- ${l.replace(/^[-*]\s+/, '')}`);
    const entry = [`## [${version}] - ${date}`, '', ...body, ''];
    const src = (text ?? '# Changelog\n').replace(/\r\n/g, '\n');
    const all = src.split('\n');
    const first = all.findIndex(l => /^##\s/.test(l));
    let out: string[];
    if (first >= 0) {
        out = [...all.slice(0, first), ...entry, ...all.slice(first)];
    } else {
        const head = all.findIndex(l => /^#\s/.test(l));
        out = head >= 0 ? [...all.slice(0, head + 1), '', ...entry, ...all.slice(head + 1)] : ['# Changelog', '', ...entry, ...all];
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n*$/, '\n').replace(/\n/g, eol);
}

/** The body of the "## [version]" section of a CHANGELOG.md. */
export function changelogSection(text: string | undefined, version: string): string | undefined {
    if (!text) { return undefined; }
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const start = lines.findIndex(l => new RegExp(`^##\\s+\\[?v?${version.replace(/\./g, '\\.')}\\]?(\\s|$)`).test(l));
    if (start < 0) { return undefined; }
    const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
    return lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim() || undefined;
}

/** A file to write into a repository (repository-relative path). */
export interface RepoFile { path: string; text: string }

/** Folder of catalog template `id` in its repository. */
export function catalogFolder(id: string): string {
    return `${CATALOG_DIR}/${slugId(id)}`;
}

function templateReadme(m: TemplateManifest, folder: string, comps: string[]): string {
    return [
        `# ${m.name}`,
        '',
        m.description ?? 'A Copilot template for Business Central projects.',
        '',
        ...(m.extends ? [`Variant of \`${m.extends}\`: it uses all of its components, ${m.remove?.length ? `except ${m.remove.map(r => `\`${r}\``).join(', ')}, ` : ''}and replaces the components that have files in this folder.`, ''] : []),
        `Template id \`${m.id}\` in \`${folder}/\`. Add it in the BC ALM extension under **Template Sources** (the repository lists its templates),`,
        'choose **Use in This Project**, then pick the components you want.',
        ...(m.maintainers?.length ? ['', `Maintainers: ${m.maintainers.map(x => `@${x}`).join(', ')}`] : []),
        ...(comps.length ? ['', '## Components', '', ...comps] : []),
        ''
    ].join('\n');
}

/**
 * Files of a new template in a catalog repository (`.templates/<id>/`): template.config.json, README.md,
 * CHANGELOG.md and the seeded component files. A variant (`manifest.extends`) has no own values, so it
 * inherits its base's placeholders; seeded files must then be generalized to the base's values.
 */
export function catalogTemplateFiles(manifest: TemplateManifest, seeded: SeedFile[] = [], values?: TemplateValues, date = today()): RepoFile[] {
    const folder = catalogFolder(manifest.id);
    const template: Record<string, unknown> = {
        id: manifest.id,
        name: manifest.name,
        ...(manifest.description ? { description: manifest.description } : {}),
        version: manifest.version ?? '0.1.0',
        ...(manifest.icon ? { icon: manifest.icon } : {}),
        ...(manifest.extends ? { extends: manifest.extends } : {}),
        ...(manifest.remove?.length ? { remove: manifest.remove } : {}),
        ...(manifest.maintainers?.length ? { maintainers: manifest.maintainers } : {})
    };
    const config = {
        _readme: manifest.extends
            ? 'Variant template: starts from the "extends" template, drops the "remove" component ids and replaces every component that has files in this folder. Placeholder values are inherited from the base.'
            : 'Template identity and placeholder values. Projects that use this template replace the values with their own; keep the template id equal to the folder name.',
        template,
        ...(values && !manifest.extends ? { values } : {})
    };
    const comps = [...new Set(seeded.map(f => componentOf(f.srcRel)).filter(r => r.kind !== 'file').map(r => `- ${r.kind} \`${r.name}\``))].sort();
    const out: RepoFile[] = [
        { path: `${folder}/${CONFIG_FILE}`, text: JSON.stringify(config, null, 2) + '\n' },
        { path: `${folder}/README.md`, text: templateReadme(manifest, folder, comps) },
        { path: `${folder}/CHANGELOG.md`, text: addChangelogEntry(undefined, String(template.version), [manifest.extends ? `Initial version (variant of ${manifest.extends}).` : 'Initial version.'], date) }
    ];
    for (const f of seeded) { out.push({ path: `${folder}/${f.srcRel}`, text: f.text }); }
    return out;
}
