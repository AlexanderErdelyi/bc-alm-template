import { SyncConfig, custRoot } from './config';

export type ComponentKind = 'agent' | 'skill' | 'prompt' | 'instruction' | 'workflow' | 'doc' | 'file';

export const KIND_LABELS: Record<ComponentKind, string> = {
    agent: 'Agents',
    skill: 'Skills',
    prompt: 'Prompts',
    instruction: 'Instructions',
    workflow: 'Workflows',
    doc: 'Docs',
    file: 'Other files'
};

export const KIND_ORDER: ComponentKind[] = ['agent', 'skill', 'prompt', 'instruction', 'workflow', 'doc', 'file'];

/** Discoverable customization trees (relocated under customizationsPath). Mirrors $customTrees. */
export const CUSTOM_TREES = ['.github/agents', '.github/skills', '.github/prompts', '.github/instructions'];

/** Core files always refreshed. Mirrors $rootFiles in Update-FromTemplate.ps1. */
export const CORE_ROOT_FILES = [
    'scripts/Initialize-Template.ps1',
    'scripts/Add-BCQuality.ps1',
    'scripts/Start-ALLanguageServer.ps1',
    'scripts/Update-FromTemplate.ps1',
    'scripts/Enable-CopilotCustomizations.ps1',
    'scripts/Install-IntoExistingRepo.ps1',
    '.vscode/tasks.json'
];

export const META_DOCS = ['.github/AGENT-ARCHITECTURE.md', '.github/WHEN-TO-USE.md', '.github/SKILLS.md'];

export const ISSUE_OPS_FILES = [
    '.github/ISSUE_ORCHESTRATION.md',
    '.github/workflows/issue-implementation.yml',
    '.github/workflows/issue-orchestrator.yml',
    '.github/workflows/issue-planning.yml'
];

/** Prose root files that get project values re-applied. Mirrors $proseRootFiles. */
export const PROSE_ROOT_FILES = [
    '.github/AGENT-ARCHITECTURE.md', '.github/WHEN-TO-USE.md', '.github/SKILLS.md',
    '.github/ISSUE_ORCHESTRATION.md', '.github/PULL_REQUEST_TEMPLATE.md', '.vscode/tasks.json'
];

const REPARAM_EXT = ['.md', '.json', '.jsonc', '.yml', '.yaml', '.txt'];

function rootTrees(sync: SyncConfig): string[] {
    const t: string[] = [];
    if (sync.include.referenceDocs) { t.push('docs'); }
    if (sync.include.specs) { t.push('specs/_TEMPLATE'); }
    if (sync.include.issueOps) { t.push('.github/ISSUE_TEMPLATE'); }
    return t;
}

function rootFiles(sync: SyncConfig): string[] {
    const f = [...CORE_ROOT_FILES];
    if (sync.syncWorkflow) { f.push('.github/workflows/template-sync.yml', '.templatesyncignore'); }
    if (sync.include.metaDocs) { f.push(...META_DOCS); }
    if (sync.include.issueOps) { f.push(...ISSUE_OPS_FILES); }
    if (sync.include.prTemplate) { f.push('.github/PULL_REQUEST_TEMPLATE.md'); }
    // .vscode/extensions.json is always tracked; when updateExtensions=false it is implicitly pinned.
    f.push('.vscode/extensions.json');
    return f;
}

function under(rel: string, dir: string): boolean {
    return rel.startsWith(dir + '/');
}

/** Is a template (source) path managed by the sync, given the project's sync config? */
export function isManaged(srcRel: string, sync: SyncConfig): boolean {
    if (CUSTOM_TREES.some(t => under(srcRel, t))) { return true; }
    if (rootTrees(sync).some(t => under(srcRel, t))) { return true; }
    return rootFiles(sync).includes(srcRel);
}

/** Map a template-relative path to the project-relative destination. Mirrors Resolve-Dest. */
export function resolveDest(srcRel: string, sync: SyncConfig): string {
    const cr = custRoot(sync);
    if (cr && (/^\.github\/(agents|skills|prompts|instructions)(\/|$)/.test(srcRel)
        || /^specs(\/|$)/.test(srcRel) || /^\.vscode(\/|$)/.test(srcRel) || META_DOCS.includes(srcRel))) {
        return `${cr}/${srcRel}`;
    }
    return srcRel;
}

/** Inverse of resolveDest for customization paths (used to classify local-only files). */
export function srcFromDest(destRel: string, sync: SyncConfig): string {
    const cr = custRoot(sync);
    if (cr && destRel.startsWith(cr + '/')) {
        const rest = destRel.slice(cr.length + 1);
        if (/^\.github\/(agents|skills|prompts|instructions)(\/|$)/.test(rest) || /^specs(\/|$)/.test(rest)
            || /^\.vscode(\/|$)/.test(rest) || META_DOCS.includes(rest)) {
            return rest;
        }
    }
    return destRel;
}

/** Should project values be re-applied to this (template-relative) path? Mirrors Reparameterize targets. */
export function isReparamTarget(srcRel: string, sync: SyncConfig): boolean {
    if (PROSE_ROOT_FILES.includes(srcRel)) { return true; }
    const lower = srcRel.toLowerCase();
    const extOk = REPARAM_EXT.some(e => lower.endsWith(e));
    if (!extOk) { return false; }
    const trees = [...CUSTOM_TREES.filter(t => t !== '.github/instructions' || sync.updateInstructions), ...rootTrees(sync)];
    return trees.some(t => under(srcRel, t));
}

export interface ComponentRef {
    id: string;
    kind: ComponentKind;
    name: string;
}

/** Component id for a template-relative path, e.g. agent:bc-dev, skill:bc-spec-author, file:scripts/x.ps1. */
export function componentOf(srcRel: string): ComponentRef {
    let m = /^\.github\/agents\/([^/]+)\.agent\.md$/.exec(srcRel);
    if (m) { return { id: `agent:${m[1]}`, kind: 'agent', name: m[1] }; }
    m = /^\.github\/skills\/([^/]+)\/.+$/.exec(srcRel);
    if (m) { return { id: `skill:${m[1]}`, kind: 'skill', name: m[1] }; }
    m = /^\.github\/prompts\/([^/]+)\.prompt\.md$/.exec(srcRel);
    if (m) { return { id: `prompt:${m[1]}`, kind: 'prompt', name: m[1] }; }
    m = /^\.github\/instructions\/([^/]+)\.instructions\.md$/.exec(srcRel);
    if (m) { return { id: `instruction:${m[1]}`, kind: 'instruction', name: m[1] }; }
    m = /^\.github\/workflows\/([^/]+)\.ya?ml$/.exec(srcRel);
    if (m) { return { id: `workflow:${m[1]}`, kind: 'workflow', name: m[1] }; }
    m = /^docs\/([^/]+?)(\.md)?(\/.*)?$/.exec(srcRel);
    if (m) { return { id: `doc:${m[1]}`, kind: 'doc', name: m[1] }; }
    return { id: `file:${srcRel}`, kind: 'file', name: srcRel };
}

export function parseComponentId(id: string): ComponentRef {
    const i = id.indexOf(':');
    const kind = id.slice(0, i) as ComponentKind;
    return { id, kind, name: id.slice(i + 1) };
}

/** Main (entry) template-relative path of a component, for opening/validating. */
export function primaryPath(ref: ComponentRef): string {
    switch (ref.kind) {
        case 'agent': return `.github/agents/${ref.name}.agent.md`;
        case 'skill': return `.github/skills/${ref.name}/SKILL.md`;
        case 'prompt': return `.github/prompts/${ref.name}.prompt.md`;
        case 'instruction': return `.github/instructions/${ref.name}.instructions.md`;
        case 'workflow': return `.github/workflows/${ref.name}.yml`;
        case 'doc': return `docs/${ref.name}.md`;
        default: return ref.name;
    }
}

/** Is this component id implicitly pinned by a legacy sync toggle? */
export function implicitlyKeptLocal(id: string, sync: SyncConfig): boolean {
    if (!sync.updateInstructions && id.startsWith('instruction:')) { return true; }
    if (!sync.updateExtensions && id === 'file:.vscode/extensions.json') { return true; }
    return false;
}

/** Customization roots scanned for local-only (custom) components. */
export function customScanRoots(sync: SyncConfig): string[] {
    return CUSTOM_TREES.map(t => resolveDest(t, sync));
}
