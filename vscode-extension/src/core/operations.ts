import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ComponentPolicy, ProjectConfig, writeComponentPolicy } from './config';
import { Catalog, transformedAt } from './catalog';
import { run } from './exec';
import { emptyLock, ensureSource, LockFile, writeLock } from './lock';
import { ComponentState, disabledPath, FileState } from './status';
import { hashText, normalizeText, readTextIfExists, removeEmptyParents, sameUrl, writeTextPreservingEol } from './util';

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
            catalogs.forEach((c, i) => ensureSource(this.lock, { name: c.repo.spec.name, url: c.repo.spec.url, ref: c.repo.spec.ref }, i === 0));
        }
    }

    abs(destRel: string): string {
        return path.join(this.root, ...destRel.split('/'));
    }

    catalogFor(st: FileState): Catalog | undefined {
        return this.catalogs.find(c => sameUrl(c.repo.spec.url, st.source));
    }

    private record(st: FileState, cat: Catalog, installedText: string, commit = cat.sha, templateHash = st.template!.rawHash): void {
        ensureSource(this.lock, { name: cat.repo.spec.name, url: cat.repo.spec.url, ref: cat.repo.spec.ref });
        this.lock.files[st.destRel] = {
            source: cat.repo.spec.url,
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
            fs.rmSync(tmp, { recursive: true, force: true });
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
        for (const f of comp.files) {
            const src = this.abs(f.destRel);
            if (!fs.existsSync(src)) { continue; }
            const dst = disabledPath(this.root, f.destRel);
            fs.mkdirSync(path.dirname(dst), { recursive: true });
            fs.renameSync(src, dst);
            removeEmptyParents(src, this.root);
        }
        const p = this.policy();
        p.disabled = [...new Set([...p.disabled, comp.ref.id])];
        this.savePolicy(p);
    }

    /** Turn a component back on: restore stored files, install anything else from the template. */
    enable(comp: ComponentState): void {
        const p = this.policy();
        p.disabled = p.disabled.filter(x => x !== comp.ref.id);
        this.savePolicy(p);
        for (const f of comp.files) {
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

    /** Re-point a component to another template source (next update takes that source's version). */
    switchSource(comp: ComponentState, target: Catalog): FileState[] {
        const moved: FileState[] = [];
        for (const f of comp.files) {
            const tf = target.files.get(f.destRel);
            if (!tf) { continue; }
            const local = readTextIfExists(this.abs(f.destRel));
            const st: FileState = { ...f, source: target.repo.spec.url, template: tf, lock: undefined, srcRel: tf.srcRel };
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
