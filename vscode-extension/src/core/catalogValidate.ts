import { CONFIG_FILE, parseConfig, ProjectConfig, slugId, TemplateManifest } from './config';
import { CATALOG_DIR, changelogSection, compareSemver, parseSemver } from './catalogAuthoring';
import { componentOf } from './paths';
import { customizationKind, Finding, validateFile } from './validator';

/** Read-only view of a repository tree (at a commit or on disk). Paths are repository-relative, posix. */
export interface RepoSnapshot {
    files: string[];
    read(path: string): string | undefined;
}

export interface CatalogIssue {
    file: string;
    /** 0-based */
    line?: number;
    severity: 'error' | 'warning' | 'info';
    message: string;
}

interface Entry {
    id: string;
    /** '' = root template. */
    path: string;
    manifest: TemplateManifest;
    configFile: string;
}

const join = (root: string, rel: string) => root ? `${root}/${rel}` : rel;

function parseConfigText(text: string): ProjectConfig {
    return parseConfig(JSON.parse(text.replace(/^\uFEFF/, '')));
}

/** Template-relative files of the template at `root` (the root template never includes .templates/). */
function filesOf(all: string[], root: string): string[] {
    if (!root) { return all.filter(f => !f.startsWith(CATALOG_DIR + '/')); }
    return all.filter(f => f.startsWith(root + '/')).map(f => f.slice(root.length + 1));
}

/** Templates of the repository plus manifest problems (bad JSON, id/folder mismatch, duplicates, missing version). */
function readEntries(snap: RepoSnapshot, issues: CatalogIssue[]): Entry[] {
    const entries: Entry[] = [];
    const rootText = snap.files.includes(CONFIG_FILE) ? snap.read(CONFIG_FILE) : undefined;
    if (rootText !== undefined) {
        try {
            const cfg = parseConfigText(rootText);
            if (cfg.template) {
                entries.push({ id: cfg.template.id, path: '', manifest: cfg.template, configFile: CONFIG_FILE });
                if (cfg.template.version !== undefined && !parseSemver(cfg.template.version)) {
                    issues.push({ file: CONFIG_FILE, severity: 'error', message: `template.version "${cfg.template.version}" is not a semantic version (x.y.z).` });
                }
            }
        } catch (e) {
            issues.push({ file: CONFIG_FILE, severity: 'error', message: `Not valid JSON: ${(e as Error).message}` });
        }
    }
    const folders = new Set<string>();
    for (const f of snap.files) {
        const m = new RegExp(`^${CATALOG_DIR}/([^/]+)/`).exec(f);
        if (m) { folders.add(m[1]); }
    }
    for (const folder of [...folders].sort()) {
        const where = `${CATALOG_DIR}/${folder}`;
        const configFile = `${where}/${CONFIG_FILE}`;
        const text = snap.files.includes(configFile) ? snap.read(configFile) : undefined;
        if (text === undefined) {
            issues.push({ file: where, severity: 'error', message: `${where}/ has no ${CONFIG_FILE}. Every catalog template needs one with a "template" block.` });
            continue;
        }
        let cfg: ProjectConfig;
        try { cfg = parseConfigText(text); } catch (e) {
            issues.push({ file: configFile, severity: 'error', message: `Not valid JSON: ${(e as Error).message}` });
            continue;
        }
        const t = cfg.template;
        if (!t) {
            issues.push({ file: configFile, severity: 'error', message: 'Missing the "template" block ({ "id", "name", "version", ... }).' });
            continue;
        }
        const rawId = typeof cfg.raw?.template?.id === 'string' ? cfg.raw.template.id : '';
        if (rawId !== folder || folder !== slugId(folder)) {
            issues.push({ file: configFile, severity: 'error', message: `template.id "${rawId}" must equal the folder name "${folder}" (lowercase letters, digits, dots, hyphens).` });
            continue;
        }
        if (!t.name?.trim()) {
            issues.push({ file: configFile, severity: 'error', message: 'template.name is required.' });
        }
        if (!t.version) {
            issues.push({ file: configFile, severity: 'error', message: 'template.version is required for catalog templates (start with "0.1.0").' });
        } else if (!parseSemver(t.version)) {
            issues.push({ file: configFile, severity: 'error', message: `template.version "${t.version}" is not a semantic version (x.y.z).` });
        }
        const dup = entries.find(e => e.id === t.id);
        if (dup) {
            issues.push({ file: configFile, severity: 'error', message: `Duplicate template id "${t.id}" (also used by ${dup.configFile}).` });
            continue;
        }
        entries.push({ id: t.id, path: where, manifest: t, configFile });
    }
    return entries;
}

/** Base chain of `e` (base first, `e` last), or undefined when it has a missing base or a cycle (reported once). */
function chainOf(e: Entry, byId: Map<string, Entry>, issues: CatalogIssue[]): Entry[] | undefined {
    const chain: Entry[] = [e];
    let cur = e;
    while (cur.manifest.extends) {
        const base = byId.get(cur.manifest.extends);
        if (!base) {
            if (cur === e) { issues.push({ file: e.configFile, severity: 'error', message: `template.extends "${e.manifest.extends}" is not a template of this repository.` }); }
            return undefined;
        }
        if (chain.includes(base)) {
            if (base === e) { issues.push({ file: e.configFile, severity: 'error', message: `template.extends forms a cycle: ${[...chain].reverse().map(c => c.id).join(' -> ')} -> ${e.id}.` }); }
            return undefined;
        }
        chain.unshift(base);
        cur = base;
    }
    return chain;
}

/** Component ids a chain (base first) delivers: union of layer components minus each layer's `remove`. */
function componentsOf(chain: Entry[], all: string[]): Set<string> {
    const ids = new Set<string>();
    for (const layer of chain) {
        for (const id of layer.manifest.remove ?? []) { ids.delete(id); }
        for (const f of filesOf(all, layer.path)) {
            if (f === CONFIG_FILE || /^(README|CHANGELOG)\.md$/i.test(f)) { continue; }
            ids.add(componentOf(f).id);
        }
    }
    return ids;
}

function fromFinding(f: Finding, repoPath: string): CatalogIssue {
    return { file: repoPath, line: f.line, severity: f.severity, message: `[${f.code}] ${f.message}` };
}

/**
 * Validate every template of a (catalog) repository: manifests, variant `extends`/`remove`, and the Copilot
 * customization files of each template (frontmatter, descriptions, skill names, handoff targets).
 */
export function validateCatalog(snap: RepoSnapshot): CatalogIssue[] {
    const issues: CatalogIssue[] = [];
    const entries = readEntries(snap, issues);
    const byId = new Map(entries.map(e => [e.id, e]));
    for (const e of entries) {
        if (!e.path && e.manifest.extends) {
            issues.push({ file: e.configFile, severity: 'error', message: 'The root template cannot extend another template.' });
            continue;
        }
        const chain = e.manifest.extends ? chainOf(e, byId, issues) : [e];
        if (!chain) { continue; }
        if (e.manifest.remove?.length) {
            if (!e.manifest.extends) {
                issues.push({ file: e.configFile, severity: 'warning', message: 'template.remove only applies to variants (templates with "extends").' });
            } else {
                const base = componentsOf(chain.slice(0, -1), snap.files);
                for (const id of e.manifest.remove) {
                    if (!base.has(id)) { issues.push({ file: e.configFile, severity: 'error', message: `template.remove "${id}" is not a component of "${e.manifest.extends}".` }); }
                }
            }
        }
        const known = new Set<string>();
        const effective = componentsOf(chain, snap.files);
        for (const id of effective) { if (id.startsWith('agent:')) { known.add(id.slice('agent:'.length)); } }
        for (const rel of filesOf(snap.files, e.path)) {
            if (!customizationKind(rel)) { continue; }
            const repoPath = join(e.path, rel);
            const text = snap.read(repoPath);
            if (text === undefined) { continue; }
            for (const f of validateFile(rel, text, { knownAgents: known })) { issues.push(fromFinding(f, repoPath)); }
        }
    }
    return issues;
}

/**
 * Changed catalog templates (`.templates/<id>/...`) must bump template.version and add a CHANGELOG.md
 * section for it. README-only changes are exempt. New templates only need a changelog entry.
 */
export function checkVersionBumps(changed: string[], base: RepoSnapshot, head: RepoSnapshot): CatalogIssue[] {
    const issues: CatalogIssue[] = [];
    const byFolder = new Map<string, string[]>();
    for (const f of changed) {
        const m = new RegExp(`^${CATALOG_DIR}/([^/]+)/(.+)$`).exec(f);
        if (m) { byFolder.set(m[1], [...(byFolder.get(m[1]) ?? []), m[2]]); }
    }
    const version = (snap: RepoSnapshot, file: string) => {
        if (!snap.files.includes(file)) { return undefined; }
        try { return parseConfigText(snap.read(file) ?? '').template?.version; } catch { return undefined; }
    };
    for (const [folder, rels] of byFolder) {
        const where = `${CATALOG_DIR}/${folder}`;
        const configFile = `${where}/${CONFIG_FILE}`;
        if (!head.files.includes(configFile)) { continue; }
        if (rels.every(r => /^README\.md$/i.test(r))) { continue; }
        const now = version(head, configFile);
        if (!now || !parseSemver(now)) { continue; }
        const before = version(base, configFile);
        if (before && compareSemver(now, before) <= 0) {
            issues.push({ file: configFile, severity: 'error', message: `"${folder}" changed but template.version is still ${now}. Bump it (patch for fixes, minor for new components, major for breaking changes).` });
        }
        const changelog = `${where}/CHANGELOG.md`;
        if (!changelogSection(head.files.includes(changelog) ? head.read(changelog) : undefined, now)) {
            issues.push({ file: changelog, severity: 'error', message: `Add a "## [${now}] - <date>" section to ${changelog} describing the change.` });
        }
    }
    return issues;
}
