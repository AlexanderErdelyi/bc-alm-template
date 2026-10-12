import * as fs from 'fs';
import * as path from 'path';
import { ProjectConfig } from './config';
import { Frontmatter, parseFrontmatter } from './frontmatter';
import { parseToolsLine } from './transform';

export type Severity = 'error' | 'warning' | 'info';

export type QuickFix =
    | { kind: 'renameKey'; from: string; to: string; title: string }
    | { kind: 'setScalar'; key: string; value: string; title: string }
    | { kind: 'removeKeyLine'; key: string; title: string }
    | { kind: 'renameFile'; to: string; title: string };

export interface Finding {
    file: string;          // project-relative (posix)
    line: number;          // 0-based
    severity: Severity;
    code: string;
    message: string;
    docUrl?: string;
    fix?: QuickFix;
}

export const DOCS = {
    agentsGitHub: 'https://docs.github.com/en/copilot/reference/custom-agents-configuration',
    agentsVsCode: 'https://code.visualstudio.com/docs/copilot/customization/custom-agents',
    skillsVsCode: 'https://code.visualstudio.com/docs/copilot/customization/agent-skills',
    skillsSpec: 'https://agentskills.io/specification',
    prompts: 'https://code.visualstudio.com/docs/copilot/customization/prompt-files',
    instructions: 'https://code.visualstudio.com/docs/copilot/customization/custom-instructions',
    skillsGitHub: 'https://docs.github.com/en/copilot/concepts/agents/about-agent-skills'
};

export const AGENT_BODY_MAX = 30000;
const SKILL_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const BUILTIN_PROMPT_AGENTS = ['ask', 'agent', 'plan', 'edit'];

export type CustomizationKind = 'agent' | 'skill' | 'prompt' | 'instruction' | 'chatmode';

export function customizationKind(file: string): CustomizationKind | undefined {
    const f = file.toLowerCase();
    if (f.endsWith('.agent.md')) { return 'agent'; }
    if (f.endsWith('.chatmode.md')) { return 'chatmode'; }
    if (f.endsWith('.prompt.md')) { return 'prompt'; }
    if (f.endsWith('.instructions.md')) { return 'instruction'; }
    if (/(^|\/)skills\/[^/]+\/skill\.md$/.test(f)) { return 'skill'; }
    return undefined;
}

function keyLine(fm: Frontmatter, key: string): number {
    return fm.keys.find(k => k.key === key)?.line ?? 0;
}

export interface ValidationContext {
    project?: ProjectConfig;
    /** Names of agents available in the workspace (for handoffs / prompt agent checks). */
    knownAgents: Set<string>;
    /** Check that relative links resolve (needs the project root). */
    root?: string;
}

export function validateFile(file: string, text: string, ctx: ValidationContext): Finding[] {
    const kind = customizationKind(file);
    if (!kind) { return []; }
    const out: Finding[] = [];
    const add = (line: number, severity: Severity, code: string, message: string, docUrl?: string, fix?: QuickFix) =>
        out.push({ file, line, severity, code, message, docUrl, fix });
    const fm = parseFrontmatter(text);
    const base = path.posix.basename(file);

    if (kind === 'chatmode') {
        const newName = base.replace(/\.chatmode\.md$/i, '.agent.md');
        add(0, 'warning', 'legacy-chatmode', 'Chat modes were renamed to custom agents. Move this file to .github/agents/ with the .agent.md extension.',
            DOCS.agentsVsCode, { kind: 'renameFile', to: newName, title: `Rename to ${newName}` });
    }
    if (fm.error) {
        add(0, 'error', 'frontmatter', fm.error);
        return out;
    }

    if (kind === 'agent' || kind === 'chatmode') {
        const name = base.replace(/\.(agent|chatmode)\.md$/i, '');
        if (!fm.present) {
            add(0, 'warning', 'agent-no-frontmatter', 'Custom agents should start with YAML frontmatter (at least a description).', DOCS.agentsGitHub);
        } else {
            const desc = fm.data['description'];
            if (typeof desc !== 'string' || !desc.trim()) {
                add(0, 'error', 'agent-description', 'Custom agents need a `description` — it is how Copilot and users decide when to pick this agent.', DOCS.agentsGitHub);
            } else if (!/use (it )?when|use for/i.test(desc)) {
                add(keyLine(fm, 'description'), 'info', 'agent-description-triggers', 'Tip: include "Use when: …" trigger phrases in the description so the agent is picked for the right requests.', DOCS.agentsVsCode);
            }
            if ('infer' in fm.data) {
                add(keyLine(fm, 'infer'), 'warning', 'agent-infer-retired', '`infer` is retired. Use `disable-model-invocation: true` (keep it out of automatic delegation) and/or `user-invocable: false` (hide from the picker).',
                    DOCS.agentsGitHub, { kind: 'removeKeyLine', key: 'infer', title: 'Remove retired `infer`' });
            }
            const target = fm.data['target'];
            if (target !== undefined && target !== 'vscode' && target !== 'github-copilot') {
                add(keyLine(fm, 'target'), 'error', 'agent-target', '`target` must be `vscode` or `github-copilot` (omit it to use the agent everywhere).', DOCS.agentsGitHub);
            }
            if (target === 'github-copilot') {
                for (const k of ['handoffs', 'argument-hint']) {
                    if (k in fm.data) { add(keyLine(fm, k), 'info', 'agent-ignored-key', `\`${k}\` is a VS Code feature and is ignored by the GitHub.com coding agent.`, DOCS.agentsGitHub); }
                }
            }
            if (target === 'vscode') {
                for (const k of ['mcp-servers', 'metadata']) {
                    if (k in fm.data) { add(keyLine(fm, k), 'info', 'agent-ignored-key', `\`${k}\` is only used by the GitHub.com coding agent and is ignored in VS Code.`, DOCS.agentsVsCode); }
                }
            }
            const handoffs = fm.data['handoffs'];
            if (Array.isArray(handoffs)) {
                for (const h of handoffs) {
                    const a = h && typeof h === 'object' ? (h as Record<string, unknown>)['agent'] : undefined;
                    if (typeof a === 'string' && a && ctx.knownAgents.size && !ctx.knownAgents.has(a) && !BUILTIN_PROMPT_AGENTS.includes(a)) {
                        add(keyLine(fm, 'handoffs'), 'warning', 'agent-handoff-target', `Handoff target agent \`${a}\` was not found in this workspace (disabled or renamed?).`, DOCS.agentsVsCode);
                    }
                }
            }
            const project = ctx.project;
            if (project) {
                const model = fm.data['model'];
                const pinned = project.models[name];
                if (pinned && typeof model === 'string' && model !== pinned && !project.sync.updateModels) {
                    add(keyLine(fm, 'model'), 'info', 'agent-model-pinned', `template.config.json pins this agent to "${pinned}"; the next template sync re-applies it. Change it in template.config.json → models instead.`,
                        undefined, { kind: 'setScalar', key: 'model', value: pinned, title: `Use pinned model "${pinned}"` });
                }
                if (project.values.workItemSystem === 'GitHub' && (parseToolsLine(text) ?? []).includes('azure-devops/*')) {
                    add(keyLine(fm, 'tools'), 'info', 'agent-ado-tools', 'This project tracks work in GitHub Issues; the `azure-devops/*` tool group is unused here (the template sync trims it).');
                }
            }
        }
        if (fm.body.length > AGENT_BODY_MAX) {
            add(fm.bodyStartLine, 'error', 'agent-body-length', `Agent prompt is ${fm.body.length} characters; the maximum is ${AGENT_BODY_MAX}. Move procedures into a skill and link to it.`, DOCS.agentsGitHub);
        }
    }

    if (kind === 'skill') {
        const folder = path.posix.basename(path.posix.dirname(file));
        if (!fm.present) {
            add(0, 'error', 'skill-no-frontmatter', 'SKILL.md must start with YAML frontmatter containing `name` and `description`.', DOCS.skillsSpec);
        } else {
            const name = fm.data['name'];
            if (typeof name !== 'string' || !name) {
                add(0, 'error', 'skill-name', 'Skills need a `name` (lowercase letters, digits and hyphens, matching the folder name).', DOCS.skillsSpec,
                    { kind: 'setScalar', key: 'name', value: folder, title: `Set name to "${folder}"` });
            } else {
                if (name.length > 64 || !SKILL_NAME_RE.test(name)) {
                    add(keyLine(fm, 'name'), 'error', 'skill-name-format', 'Skill `name` must be 1-64 characters of a-z, 0-9 and single hyphens (no leading/trailing hyphen).', DOCS.skillsSpec);
                }
                if (name !== folder) {
                    add(keyLine(fm, 'name'), 'warning', 'skill-name-folder', `Skill \`name\` ("${name}") should match its folder name ("${folder}").`, DOCS.skillsSpec,
                        { kind: 'setScalar', key: 'name', value: folder, title: `Set name to "${folder}"` });
                }
            }
            const desc = fm.data['description'];
            if (typeof desc !== 'string' || !desc.trim()) {
                add(0, 'error', 'skill-description', 'Skills need a `description` saying what the skill does and when to use it — it is the only text the model sees before loading the skill.', DOCS.skillsSpec);
            } else {
                if (desc.length > 1024) {
                    add(keyLine(fm, 'description'), 'error', 'skill-description-length', `Skill description is ${desc.length} characters; the maximum is 1024.`, DOCS.skillsSpec);
                }
                if (!/use (it )?when|use for|when /i.test(desc)) {
                    add(keyLine(fm, 'description'), 'info', 'skill-description-triggers', 'Tip: say when to use the skill ("Use when: …") so it is loaded for the right requests.', DOCS.skillsVsCode);
                }
            }
            const compat = fm.data['compatibility'];
            if (typeof compat === 'string' && compat.length > 500) {
                add(keyLine(fm, 'compatibility'), 'warning', 'skill-compatibility-length', '`compatibility` should be at most 500 characters.', DOCS.skillsSpec);
            }
        }
        const lines = text.split(/\r?\n/).length;
        if (lines > 500) {
            add(0, 'info', 'skill-length', `SKILL.md has ${lines} lines. Keep the main file under ~500 lines and move detail into referenced files (progressive disclosure).`, DOCS.skillsSpec);
        }
    }

    if (kind === 'prompt') {
        if ('mode' in fm.data) {
            add(keyLine(fm, 'mode'), 'warning', 'prompt-mode', 'The prompt-file key `mode` was renamed to `agent`.', DOCS.prompts,
                { kind: 'renameKey', from: 'mode', to: 'agent', title: 'Rename `mode` to `agent`' });
        }
        const a = fm.data['agent'] ?? fm.data['mode'];
        if (typeof a === 'string' && a && !BUILTIN_PROMPT_AGENTS.includes(a) && ctx.knownAgents.size && !ctx.knownAgents.has(a)) {
            add(keyLine(fm, 'agent' in fm.data ? 'agent' : 'mode'), 'warning', 'prompt-agent', `Agent \`${a}\` is not a built-in agent (ask, agent, plan) or a custom agent in this workspace.`, DOCS.prompts);
        }
        if (fm.present && !fm.data['description']) {
            add(0, 'info', 'prompt-description', 'Add a `description` so the prompt is easy to find in the / picker.', DOCS.prompts);
        }
    }

    if (kind === 'instruction') {
        if (!fm.present || !fm.data['applyTo']) {
            add(0, 'info', 'instruction-applyto', 'No `applyTo` glob: these instructions are only used when attached manually (or matched by description). Add `applyTo: "**/*.al"` (for example) to apply them automatically.', DOCS.instructions);
        }
    }

    if (ctx.root) {
        const dir = path.join(ctx.root, ...path.posix.dirname(file).split('/'));
        const lines = text.split(/\r?\n/);
        let inFence = false;
        lines.forEach((l, i) => {
            if (/^\s*(```|~~~)/.test(l)) { inFence = !inFence; return; }
            if (inFence) { return; }
            const re = /\]\(([^)\s]+?)(?:\s+"[^"]*")?\)/g;
            let m: RegExpExecArray | null;
            while ((m = re.exec(l)) !== null) {
                const target = m[1].split('#')[0];
                if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/') || target.startsWith('<')) { continue; }
                let decoded = target;
                try { decoded = decodeURIComponent(target); } catch { /* keep raw */ }
                if (!fs.existsSync(path.join(dir, decoded))) {
                    add(i, 'warning', 'broken-link', `Link target "${target}" does not exist (component disabled, renamed, or not installed?).`);
                }
            }
        });
    }
    return out;
}

/** Apply a quick fix to file text (renameFile is handled by the caller). */
export function applyFix(text: string, fix: QuickFix): string {
    const eol = /\r\n/.test(text) ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    const fm = parseFrontmatter(text);
    switch (fix.kind) {
        case 'renameKey': {
            const k = fm.keys.find(x => x.key === fix.from);
            if (k) { lines[k.line] = lines[k.line].replace(new RegExp(`^${fix.from}(\\s*:)`), `${fix.to}$1`); }
            return lines.join(eol);
        }
        case 'removeKeyLine': {
            const k = fm.keys.find(x => x.key === fix.key);
            if (k) { lines.splice(k.line, 1); }
            return lines.join(eol);
        }
        case 'setScalar': {
            const k = fm.keys.find(x => x.key === fix.key);
            const q = `"${fix.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
            if (k) { lines[k.line] = `${fix.key}: ${q}`; } else if (fm.present) { lines.splice(1, 0, `${fix.key}: ${q}`); }
            return lines.join(eol);
        }
        default:
            return text;
    }
}
