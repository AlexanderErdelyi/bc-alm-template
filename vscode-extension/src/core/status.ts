import * as fs from 'fs';
import * as path from 'path';
import { ProjectConfig, TEMPLATE_TOGGLE_KINDS, templateIdFromUrl } from './config';
import { Catalog, CatalogFile } from './catalog';
import { LockEntry, LockFile } from './lock';
import { ComponentKind, ComponentRef, componentOf, customScanRoots, implicitlyKeptLocal, KIND_ORDER, srcFromDest } from './paths';
import { transformTemplateFile } from './transform';
import { hashText, insideRoot, listFilesRecursive, normalizeText, readTextIfExists, sameUrl, sourceKey, joinRel } from './util';

export const DISABLED_DIR = '.bc-alm/disabled';

export type FileStatus =
    | 'current'     // matches the template (after your values are applied)
    | 'update'      // template changed, you did not -> safe to take
    | 'modified'    // you changed it, template did not
    | 'conflict'    // both changed -> merge
    | 'missing'     // tracked, but deleted locally
    | 'new'         // new template file inside a component you already have
    | 'available'   // template component you have not installed
    | 'custom'      // your own file, not from any template source
    | 'removed'     // tracked, but no longer in the template
    | 'disabled';   // component turned off in this project

export interface FileState {
    destRel: string;
    srcRel: string;
    component: ComponentRef;
    status: FileStatus;
    /** Source key (URL, plus #path for a catalog template) this file is tracked from / would be installed from. */
    source?: string;
    /** Template id of that source. */
    templateId?: string;
    template?: CatalogFile;
    lock?: LockEntry;
    /** Baseline inferred from template history when there is no lock entry. */
    inferred?: { commit: string; templateHash: string };
    /** Local file exists but no template version produced it (and no lock). */
    unknownBase?: boolean;
    localHash?: string;
}

export interface ComponentState {
    ref: ComponentRef;
    files: FileState[];
    status: FileStatus;
    disabled: boolean;
    keepLocal: boolean;
    /** keepLocal comes from a legacy sync toggle (updateInstructions/updateExtensions). */
    implicitKeep: boolean;
    source?: string;
    /** Template id the component belongs to (undefined = your own, local-only component). */
    templateId?: string;
    /** Switched off because its whole template is disabled (sync.templates.disabled). */
    templateDisabled: boolean;
    /** Not installed and deliberately left out via "Manage Components". */
    excluded: boolean;
    /** Not installed, and the template gained it after you last chose its components. */
    newInTemplate: boolean;
    /** Other sources that also offer this component. */
    alsoIn: string[];
    installed: boolean;
}

export interface ProjectStatus {
    files: FileState[];
    components: ComponentState[];
    /** True when there is no template.lock.json yet (statuses are inferred). */
    noLock: boolean;
}

const STATUS_RANK: FileStatus[] = ['conflict', 'modified', 'missing', 'update', 'new', 'removed', 'current', 'custom', 'available', 'disabled'];

export function aggregateStatus(files: FileState[]): FileStatus {
    if (files.length === 0) { return 'current'; }
    if (files.every(f => f.status === 'available')) { return 'available'; }
    if (files.every(f => f.status === 'custom')) { return 'custom'; }
    if (files.every(f => f.status === 'disabled')) { return 'disabled'; }
    if (files.every(f => f.status === 'removed')) { return 'removed'; }
    const present = files.filter(f => f.status !== 'available' && f.status !== 'custom');
    for (const s of STATUS_RANK) {
        if (present.some(f => f.status === s)) { return s; }
    }
    return 'current';
}

export interface StatusInput {
    root: string;
    project: ProjectConfig;
    lock: LockFile | undefined;
    /** Loaded catalogs, primary first. */
    catalogs: Catalog[];
}

function localPath(root: string, destRel: string): string {
    return path.join(root, ...destRel.split('/'));
}

export function disabledPath(root: string, destRel: string): string {
    return insideRoot(root, `${DISABLED_DIR}/${destRel}`);
}

/**
 * For files with no lock entry that differ from the template head, walk the template history to
 * find the version they were installed from. If one matches, the file is a clean (older) copy.
 */
async function inferBaselines(states: FileState[], catalogs: Catalog[], project: ProjectConfig, localText: Map<string, string>): Promise<void> {
    for (const cat of catalogs) {
        const candidates = states.filter(s => !s.lock && s.template && sameUrl(s.source, cat.repo.key) && s.unknownBase);
        if (candidates.length === 0) { continue; }
        const history = await cat.repo.fileHistory(cat.sha, new Set(candidates.map(c => c.srcRel)));
        const specs: { st: FileState; commit: string }[] = [];
        for (const st of candidates) {
            for (const c of (history.get(st.srcRel) ?? []).slice(0, 40)) { specs.push({ st, commit: c }); }
        }
        const byCommit = new Map<string, string[]>();
        for (const s of specs) {
            const l = byCommit.get(s.commit) ?? [];
            l.push(s.st.srcRel);
            byCommit.set(s.commit, l);
        }
        const versions = new Map<string, string>(); // `${commit}:${path}` -> transformed
        const rawHashes = new Map<string, string>();
        for (const [commit, paths] of byCommit) {
            const blobs = await cat.repo.readFiles(commit, paths);
            const cfg = await cat.repo.readConfig(commit);
            for (const p of paths) {
                const raw = blobs.get(p);
                if (raw === undefined) { continue; }
                versions.set(`${commit}:${p}`, transformTemplateFile(p, raw, { from: cfg?.values ?? project.values, project }));
                rawHashes.set(`${commit}:${p}`, hashText(raw));
            }
        }
        for (const st of candidates) {
            const local = localText.get(st.destRel);
            for (const commit of (history.get(st.srcRel) ?? []).slice(0, 40)) {
                const k = `${commit}:${st.srcRel}`;
                if (local !== undefined && versions.get(k) === local) {
                    st.inferred = { commit, templateHash: rawHashes.get(k)! };
                    st.unknownBase = false;
                    st.status = 'update';
                    break;
                }
            }
        }
    }
}

export async function computeStatus(input: StatusInput): Promise<ProjectStatus> {
    const { root, project, lock, catalogs } = input;
    const policy = project.sync.components;
    const disabledIds = new Set(policy.disabled);
    const keepIds = new Set(policy.keepLocal);
    const disabledTemplates = new Set(project.sync.templates?.disabled ?? []);
    const templateOf = (url: string | undefined, entry?: LockEntry): string | undefined => {
        if (!url) { return undefined; }
        const cat = catalogs.find(c => sameUrl(c.repo.key, url));
        if (cat) { return cat.manifest.id; }
        return entry?.template ?? lock?.sources.find(s => sameUrl(sourceKey(s), url))?.id ?? templateIdFromUrl(url);
    };
    const offByTemplate = (ref: ComponentRef, tpl: string | undefined) => !!tpl && disabledTemplates.has(tpl) && TEMPLATE_TOGGLE_KINDS.includes(ref.kind);

    // Which catalog file each destination is tracked from.
    const tracked = new Map<string, { cat: Catalog; file: CatalogFile }>();
    const alsoIn = new Map<string, Set<string>>();
    for (const cat of catalogs) {
        for (const [dest, file] of cat.files) {
            const set = alsoIn.get(file.component.id) ?? new Set<string>();
            set.add(cat.repo.key);
            alsoIn.set(file.component.id, set);
            const le = lock?.files[dest];
            const existing = tracked.get(dest);
            if (le) {
                if (sameUrl(le.source, cat.repo.key)) { tracked.set(dest, { cat, file }); }
                else if (!existing && !catalogs.some(c => sameUrl(c.repo.key, le.source))) { tracked.set(dest, { cat, file }); }
            } else if (!existing) {
                tracked.set(dest, { cat, file });
            }
        }
    }

    // Components that the project "has": any local file, lock entry, or disabled copy.
    const installedComponents = new Set<string>();
    const localText = new Map<string, string>();
    for (const [dest, { file }] of tracked) {
        const t = readTextIfExists(localPath(root, dest));
        if (t !== undefined) {
            localText.set(dest, normalizeText(t));
            installedComponents.add(file.component.id);
        }
    }
    for (const [dest, le] of Object.entries(lock?.files ?? {})) {
        installedComponents.add(componentOf(le.path).id);
        if (!localText.has(dest)) {
            const t = readTextIfExists(localPath(root, dest));
            if (t !== undefined) { localText.set(dest, normalizeText(t)); }
        }
    }
    for (const id of disabledIds) { installedComponents.add(id); }
    const isOff = (ref: ComponentRef, tpl: string | undefined) => disabledIds.has(ref.id) || (offByTemplate(ref, tpl) && installedComponents.has(ref.id));

    const states: FileState[] = [];
    for (const [dest, { cat, file }] of tracked) {
        const ref = file.component;
        const le = lock?.files[dest] && sameUrl(lock.files[dest].source, cat.repo.key) ? lock.files[dest] : undefined;
        const st: FileState = { destRel: dest, srcRel: file.srcRel, component: ref, status: 'current', source: cat.repo.key, templateId: cat.manifest.id, template: file, lock: le };
        const local = localText.get(dest);
        if (local !== undefined) { st.localHash = hashText(local); }

        if (isOff(ref, cat.manifest.id)) {
            st.status = 'disabled';
        } else if (local === undefined) {
            if (le) { st.status = 'missing'; }
            else if (installedComponents.has(ref.id)) { st.status = 'new'; }
            else { st.status = 'available'; }
        } else if (local === file.transformed) {
            st.status = 'current';
        } else if (le) {
            // installedHash = what the template produced for you at lock.commit. If the file still has
            // that content, anything different now (template change or new config values) is a safe update.
            const upstreamChanged = le.templateHash !== file.rawHash;
            const localModified = st.localHash !== le.installedHash;
            st.status = !localModified ? 'update' : upstreamChanged ? 'conflict' : 'modified';
        } else {
            st.status = 'modified';
            st.unknownBase = true;
        }
        states.push(st);
    }

    await inferBaselines(states, catalogs, project, localText);

    // Lock entries whose template file is gone upstream.
    for (const [dest, le] of Object.entries(lock?.files ?? {})) {
        if (tracked.has(dest)) { continue; }
        const srcCat = catalogs.find(c => sameUrl(c.repo.key, le.source));
        if (!srcCat) { continue; } // source not loaded -> unknown, leave alone
        const ref = componentOf(le.path);
        const exists = localText.has(dest) || fs.existsSync(disabledPath(root, dest));
        if (!exists) { continue; }
        const tpl = templateOf(le.source, le);
        states.push({
            destRel: dest, srcRel: le.path, component: ref, lock: le, source: le.source, templateId: tpl,
            status: isOff(ref, tpl) ? 'disabled' : 'removed',
            localHash: localText.has(dest) ? hashText(localText.get(dest)!) : undefined
        });
    }

    // Local-only customizations (your own agents/skills/prompts/instructions).
    const known = new Set(states.map(s => s.destRel));
    for (const scanRoot of customScanRoots(project.sync)) {
        for (const rel of listFilesRecursive(localPath(root, scanRoot))) {
            const dest = joinRel(scanRoot, rel);
            if (known.has(dest)) { continue; }
            const srcRel = srcFromDest(dest, project.sync);
            const ref = componentOf(srcRel);
            if (ref.kind === 'file') { continue; }
            states.push({ destRel: dest, srcRel, component: ref, status: 'custom', localHash: undefined });
            known.add(dest);
        }
    }

    // Disabled components that only exist in the disabled store (e.g. custom ones).
    const disabledRoot = path.join(root, ...DISABLED_DIR.split('/'));
    for (const rel of listFilesRecursive(disabledRoot)) {
        if (known.has(rel)) { continue; }
        const srcRel = srcFromDest(rel, project.sync);
        const ref = componentOf(srcRel);
        const le = lock?.files[rel];
        const tpl = le ? templateOf(le.source, le) : undefined;
        if (!isOff(ref, tpl)) { continue; }
        states.push({ destRel: rel, srcRel, component: ref, status: 'disabled', source: le?.source, templateId: tpl, lock: le });
        known.add(rel);
    }

    // Group into components.
    const groups = new Map<string, FileState[]>();
    for (const s of states) {
        const g = groups.get(s.component.id) ?? [];
        g.push(s);
        groups.set(s.component.id, g);
    }
    const components: ComponentState[] = [];
    for (const [id, files] of groups) {
        files.sort((a, b) => a.destRel.localeCompare(b.destRel));
        const implicitKeep = implicitlyKeptLocal(id, project.sync);
        const srcCounts = new Map<string, number>();
        for (const f of files) { if (f.source) { srcCounts.set(f.source, (srcCounts.get(f.source) ?? 0) + 1); } }
        const source = [...srcCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        const ref = files[0].component;
        const templateId = files.find(f => f.source && sameUrl(f.source, source))?.templateId ?? templateOf(source);
        const installed = installedComponents.has(id) || files.some(f => f.status === 'custom');
        const templateDisabled = !disabledIds.has(id) && installed && offByTemplate(ref, templateId);
        const status = aggregateStatus(files);
        const exclude = status === 'available' ? lock?.sources.find(s => sameUrl(sourceKey(s), source))?.exclude : undefined;
        const excluded = !!exclude?.includes(id);
        components.push({
            ref,
            files,
            status,
            disabled: disabledIds.has(id) || templateDisabled,
            keepLocal: keepIds.has(id) || implicitKeep,
            implicitKeep,
            source,
            templateId,
            templateDisabled,
            excluded,
            newInTemplate: !!exclude && !excluded,
            alsoIn: [...(alsoIn.get(id) ?? [])].filter(u => !sameUrl(u, source)),
            installed
        });
    }
    components.sort((a, b) => KIND_ORDER.indexOf(a.ref.kind) - KIND_ORDER.indexOf(b.ref.kind) || a.ref.name.localeCompare(b.ref.name));
    return { files: states, components, noLock: !lock };
}

export function componentsByKind(status: ProjectStatus): Map<ComponentKind, ComponentState[]> {
    const m = new Map<ComponentKind, ComponentState[]>();
    for (const k of KIND_ORDER) { m.set(k, []); }
    for (const c of status.components) { m.get(c.ref.kind)!.push(c); }
    return m;
}

export const STATUS_LABEL: Record<FileStatus, string> = {
    current: 'up to date',
    update: 'update available',
    modified: 'modified locally',
    conflict: 'changed locally and in template',
    missing: 'deleted locally',
    new: 'new file in template',
    available: 'not installed',
    custom: 'your own',
    removed: 'removed from template',
    disabled: 'disabled'
};
