import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ComponentPolicy, ProjectConfig, TEMPLATE_TOGGLE_KINDS, TemplatePolicy, writeComponentPolicy, writeTemplatePolicy } from './config';
import { Catalog, transformedAt } from './catalog';
import { run } from './exec';
import { emptyLock, ensureSource, LockFile, LockSource, writeLock } from './lock';
import { ComponentState, disabledPath, FileState } from './status';
import { hashText, insideRoot, normalizeText, readTextIfExists, removeEmptyParents, safeRemove, sameUrl, sourceKey, writeTextPreservingEol } from './util';

/** The lock-file source record of a catalog. */
export function lockSourceOf(cat: Catalog): LockSource {
    const s: LockSource = { name: cat.repo.spec.name, id: cat.manifest.id, url: cat.repo.spec.url, ref: cat.repo.spec.ref };
    if (cat.repo.root) { s.path = cat.repo.root; }
    return s;
}

/**
 * Mutating operations on a project. The lock semantics:
 *   templateHash  = hash of the raw template file at `commit`
 *   installedHash = hash of what the template produced for this project at `commit`
 * A local file whose hash differs from installedHash carries your own changes.
 */
export class ProjectOps {
    lock: LockFile;
    private dirty = false;

    constructor(readonly root: string, public project: ProjectConfig, lock: LockFile | undefined, readonly catalogs: Catalog[]) {
        this.lock = lock ?? emptyLock();
        if (!lock) {
            catalogs.forEach((c, i) => ensureSource(this.lock, lockSourceOf(c), i === 0));
        }
    }

    abs(destRel: string): string {
        return insideRoot(this.root, destRel);
    }

    catalogFor(st: FileState): Catalog | undefined {
        return this.catalogs.find(c => sameUrl(c.repo.key, st.source));
    }

    private record(st: FileState, cat: Catalog, installedText: string, commit = cat.sha, templateHash = st.template!.rawHash): void {
        ensureSource(this.lock, lockSourceOf(cat));
        this.lock.files[st.destRel] = {
            source: cat.repo.key,
            template: cat.manifest.id,
            path: st.srcRel,
            commit,
            templateHash,
            installedHash: hashText(installedText)
        };
        this.dirty = true;
    }

    /** Overwrite the local file with the template version (your values applied). */
    take(st: FileState): void {
        const cat = this.catalogFor(st);
        if (!cat || !st.template) { throw new Error(`${st.destRel} is not available from a loaded template source.`); }
        writeTextPreservingEol(this.abs(st.destRel), st.template.transformed);
        this.record(st, cat, st.template.transformed);
    }

    /** Keep the local content but mark the current template version as seen (future updates merge on top). */
    keepMine(st: FileState): void {
        const cat = this.catalogFor(st);
        if (!cat || !st.template) { return; }
        this.record(st, cat, st.template.transformed);
    }

    /** Merge base: what the template produced at the version the file was installed from. */
    async baseText(st: FileState): Promise<string | undefined> {
        const cat = this.catalogFor(st);
        if (!cat) { return undefined; }
        const commit = st.lock?.commit ?? st.inferred?.commit;
        if (!commit || !(await cat.repo.hasCommit(commit))) { return undefined; }
        return transformedAt(cat.repo, commit, st.srcRel, this.project);
    }

    /** 3-way merge (git merge-file). Writes the result; returns whether conflict markers remain. */
    async merge(st: FileState): Promise<{ conflicts: number; text: string }> {
        const cat = this.catalogFor(st);
        if (!cat || !st.template) { throw new Error(`${st.destRel} is not available from a loaded template source.`); }
        const localRaw = readTextIfExists(this.abs(st.destRel)) ?? '';
        const base = (await this.baseText(st)) ?? '';
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-alm-merge-'));
        try {
            const pMine = path.join(tmp, 'mine');
            const pBase = path.join(tmp, 'base');
            const pTheirs = path.join(tmp, 'template');
            fs.writeFileSync(pMine, normalizeText(localRaw), 'utf8');
            fs.writeFileSync(pBase, normalizeText(base), 'utf8');
            fs.writeFileSync(pTheirs, st.template.transformed, 'utf8');
            const r = await run('git', ['merge-file', '-p', '-L', 'yours', '-L', 'base', '-L', `template ${cat.sha.slice(0, 7)}`, pMine, pBase, pTheirs], { allowFailure: true });
            if (r.code < 0) { throw new Error(`git merge-file failed: ${r.stderr}`); }
            writeTextPreservingEol(this.abs(st.destRel), r.stdout);
            this.record(st, cat, st.template.transformed);
            return { conflicts: r.code, text: r.stdout };
        } finally {
            safeRemove(tmp);
        }
    }

    /** Record a baseline without touching the file (adopting an existing project). */
    adopt(st: FileState): boolean {
        const cat = this.catalogFor(st);
        if (!cat || !st.template) { return false; }
        if (st.status === 'current') {
            this.record(st, cat, st.template.transformed);
            return true;
        }
        if (st.inferred) {
            const local = readTextIfExists(this.abs(st.destRel));
            if (local === undefined) { return false; }
            this.record(st, cat, local, st.inferred.commit, st.inferred.templateHash);
            return true;
        }
        return false;
    }

    /** Record the local file as the installed baseline at the catalog head (fresh init/install by the scripts). */
    adoptLocal(st: FileState): boolean {
        const cat = this.catalogFor(st);
        const local = readTextIfExists(this.abs(st.destRel));
        if (!cat || !st.template || local === undefined) { return false; }
        this.record(st, cat, normalizeText(local) === st.template.transformed ? st.template.transformed : local);
        return true;
    }

    /** Stop tracking a file (it becomes your own). */
    forget(destRel: string): void {
        if (this.lock.files[destRel]) {
            delete this.lock.files[destRel];
            this.dirty = true;
        }
    }

    deleteLocal(destRel: string): void {
        const p = this.abs(destRel);
        if (fs.existsSync(p)) {
            fs.rmSync(p, { force: true });
            removeEmptyParents(p, this.root);
        }
        this.forget(destRel);
    }

    install(comp: ComponentState): number {
        let n = 0;
        for (const f of comp.files) {
            if (f.status === 'available' || f.status === 'new' || f.status === 'missing') {
                this.take(f);
                n++;
            }
        }
        return n;
    }

    /** Install a component from a specific source (when several sources offer it). */
    installFrom(comp: ComponentState, cat: Catalog): number {
        if (comp.source && sameUrl(comp.source, cat.repo.key)) { return this.install(comp); }
        let n = 0;
        for (const f of comp.files) {
            if (f.status !== 'available' && f.status !== 'new' && f.status !== 'missing') { continue; }
            const tf = cat.files.get(f.destRel);
            if (!tf) { continue; }
            this.take({ ...f, source: cat.repo.key, templateId: cat.manifest.id, template: tf, srcRel: tf.srcRel, lock: undefined });
            n++;
        }
        return n;
    }

    private policy(): ComponentPolicy {
        const c = this.project.sync.components;
        return { disabled: [...c.disabled], keepLocal: [...c.keepLocal] };
    }

    private savePolicy(p: ComponentPolicy): void {
        writeComponentPolicy(this.root, p);
        this.project.sync.components = p;
    }

    setKeepLocal(id: string, keep: boolean): void {
        const p = this.policy();
        p.keepLocal = keep ? [...new Set([...p.keepLocal, id])] : p.keepLocal.filter(x => x !== id);
        this.savePolicy(p);
    }

    /** Turn a component off: its files move to .bc-alm/disabled so they are kept but not discovered. */
    disable(comp: ComponentState): void {
        this.stash(comp.files);
        const p = this.policy();
        p.disabled = [...new Set([...p.disabled, comp.ref.id])];
        this.savePolicy(p);
    }

    /** Turn a component back on: restore stored files, install anything else from the template. */
    enable(comp: ComponentState): void {
        const p = this.policy();
        p.disabled = p.disabled.filter(x => x !== comp.ref.id);
        this.savePolicy(p);
        if (!this.offByTemplate(comp)) { this.unstash(comp.files); }
    }

    /** True when the component's template is switched off (it then stays stored until the template is enabled). */
    offByTemplate(comp: ComponentState): boolean {
        return !!comp.templateId && this.project.sync.templates.disabled.includes(comp.templateId) && TEMPLATE_TOGGLE_KINDS.includes(comp.ref.kind);
    }

    private stash(files: FileState[]): void {
        for (const f of files) {
            const src = this.abs(f.destRel);
            if (!fs.existsSync(src)) { continue; }
            const dst = disabledPath(this.root, f.destRel);
            fs.mkdirSync(path.dirname(dst), { recursive: true });
            if (fs.existsSync(dst)) { fs.rmSync(dst, { force: true }); }
            fs.renameSync(src, dst);
            removeEmptyParents(src, this.root);
        }
    }

    private unstash(files: FileState[]): void {
        for (const f of files) {
            const stored = disabledPath(this.root, f.destRel);
            const dst = this.abs(f.destRel);
            if (fs.existsSync(stored)) {
                fs.mkdirSync(path.dirname(dst), { recursive: true });
                if (!fs.existsSync(dst)) { fs.renameSync(stored, dst); } else { fs.rmSync(stored, { force: true }); }
                removeEmptyParents(stored, this.root);
            } else if (f.template && !fs.existsSync(dst)) {
                this.take(f);
            }
        }
    }

    /**
     * Switch a whole template off: the installed agents, skills, prompts and instructions it provides
     * move to .bc-alm/disabled (docs, workflows and scripts stay). Recorded in sync.templates.disabled.
     */
    disableTemplate(templateId: string, components: ComponentState[]): ComponentState[] {
        const individuallyOff = new Set(this.project.sync.components.disabled);
        const affected = components.filter(c => c.templateId === templateId && c.installed && !individuallyOff.has(c.ref.id) && TEMPLATE_TOGGLE_KINDS.includes(c.ref.kind));
        for (const c of affected) { this.stash(c.files); }
        const t = this.project.sync.templates;
        this.saveTemplatePolicy({ disabled: [...new Set([...t.disabled, templateId])] });
        return affected;
    }

    /** Switch a template back on; components you disabled one by one stay off. */
    enableTemplate(templateId: string, components: ComponentState[]): ComponentState[] {
        this.saveTemplatePolicy({ disabled: this.project.sync.templates.disabled.filter(x => x !== templateId) });
        const restore = components.filter(c => c.templateId === templateId && c.templateDisabled && !this.project.sync.components.disabled.includes(c.ref.id));
        for (const c of restore) { this.unstash(c.files); }
        return restore;
    }

    private saveTemplatePolicy(p: TemplatePolicy): void {
        writeTemplatePolicy(this.root, p);
        this.project.sync.templates = { disabled: [...new Set(p.disabled)].sort() };
    }

    /** Record which components of a source (by source key) you deliberately do not take (undefined = no selection made). */
    setExclude(url: string, exclude: string[] | undefined): void {
        const s = this.lock.sources.find(x => sameUrl(sourceKey(x), url));
        const cat = this.catalogs.find(c => sameUrl(c.repo.key, url));
        if (!s) {
            if (!cat) { throw new Error(`${url} is not a template source of this project.`); }
            ensureSource(this.lock, { ...lockSourceOf(cat), exclude });
        } else {
            s.exclude = exclude;
            if (!exclude) { delete s.exclude; }
            if (cat && !s.id) { s.id = cat.manifest.id; }
        }
        this.dirty = true;
    }

    /** Re-point a component to another template source (next update takes that source's version). */
    switchSource(comp: ComponentState, target: Catalog): FileState[] {
        const moved: FileState[] = [];
        for (const f of comp.files) {
            const tf = target.files.get(f.destRel);
            if (!tf) { continue; }
            const local = readTextIfExists(this.abs(f.destRel));
            const st: FileState = { ...f, source: target.repo.key, template: tf, lock: undefined, srcRel: tf.srcRel };
            if (local === undefined) {
                this.take(st);
            } else if (normalizeText(local) === tf.transformed) {
                this.record(st, target, tf.transformed);
            } else {
                // Keep your content; record the target's head as baseline so the difference shows as a local change to review.
                this.record(st, target, tf.transformed);
            }
            moved.push(st);
        }
        return moved;
    }

    save(): boolean {
        if (!this.dirty) { return false; }
        writeLock(this.root, this.lock);
        this.dirty = false;
        return true;
    }
}
