import { manifestOf, ProjectConfig, TemplateManifest } from './config';
import { ComponentRef, componentOf, isManaged, resolveDest } from './paths';
import { TemplateRepo } from './templateRepo';
import { transformTemplateFile } from './transform';
import { hashText } from './util';

export interface CatalogFile {
    srcRel: string;
    destRel: string;
    component: ComponentRef;
    raw: string;
    rawHash: string;
    /** What this project should contain for this file (LF-normalized). */
    transformed: string;
}

export interface Catalog {
    repo: TemplateRepo;
    sha: string;
    files: Map<string, CatalogFile>; // keyed by destRel
    /** Identity of the template (manifest block or repository name). */
    manifest: TemplateManifest;
    /** Set when the template extends another template of its repository. */
    variant?: { base: string; overridden: Set<string>; removed: Set<string>; baseChanged: Set<string> };
}

/** Everything a template source would manage in this project at a given commit. */
export async function buildCatalog(repo: TemplateRepo, sha: string, project: ProjectConfig): Promise<Catalog> {
    const all = await repo.listFiles(sha);
    const managed = all.filter(p => isManaged(p, project.sync));
    const tplCfg = await repo.readConfig(sha);
    const manifest = manifestOf(tplCfg, repo.key, repo.spec.name);
    let variant: Catalog['variant'];
    if (manifest.extends) {
        const layout = await repo.layout(sha);
        variant = { base: manifest.extends, overridden: layout.overridden, removed: layout.removed, baseChanged: await repo.baseChanged(sha).catch(() => new Set<string>()) };
    }
    const from = tplCfg?.values ?? project.values;
    const blobs = await repo.readFiles(sha, managed);
    const files = new Map<string, CatalogFile>();
    for (const srcRel of managed) {
        const raw = blobs.get(srcRel);
        if (raw === undefined) { continue; }
        const destRel = resolveDest(srcRel, project.sync);
        files.set(destRel, {
            srcRel,
            destRel,
            component: componentOf(srcRel),
            raw,
            rawHash: hashText(raw),
            transformed: transformTemplateFile(srcRel, raw, { from, project })
        });
    }
    return { repo, sha, files, manifest, variant };
}

/** Transformed content of a template file at an arbitrary commit (used as merge base). */
export async function transformedAt(repo: TemplateRepo, sha: string, srcRel: string, project: ProjectConfig): Promise<string | undefined> {
    const raw = await repo.readFile(sha, srcRel);
    if (raw === undefined) { return undefined; }
    const cfg = await repo.readConfig(sha);
    return transformTemplateFile(srcRel, raw, { from: cfg?.values ?? project.values, project });
}
