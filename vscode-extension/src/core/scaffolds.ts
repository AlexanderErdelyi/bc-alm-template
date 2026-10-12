import { ComponentKind } from './paths';

export interface ScaffoldInput {
    kind: Extract<ComponentKind, 'agent' | 'skill' | 'prompt' | 'instruction'>;
    name: string;
    description: string;
    /** For agents: the skill that holds the procedure (optional). For prompts: the agent to run. */
    link?: string;
    applyTo?: string;
    model?: string;
}

export function scaffoldPath(kind: ScaffoldInput['kind'], name: string): string {
    switch (kind) {
        case 'agent': return `.github/agents/${name}.agent.md`;
        case 'skill': return `.github/skills/${name}/SKILL.md`;
        case 'prompt': return `.github/prompts/${name}.prompt.md`;
        case 'instruction': return `.github/instructions/${name}.instructions.md`;
    }
}

function q(s: string): string {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Starter content that already follows the current best practices (see guidance/best-practices.md). */
export function scaffold(input: ScaffoldInput): string {
    const { name, description } = input;
    switch (input.kind) {
        case 'agent': {
            const fm = ['---', `description: ${q(description)}`];
            if (input.model) { fm.push(`model: ${q(input.model)}`); }
            fm.push(`tools: ['search/codebase', 'search/textSearch', 'edit/editFiles', 'edit/createFile', 'web/fetch']`, '---', '');
            const skill = input.link
                ? ['> **Backing skill:** your authoritative procedure is', `> [\`.github/skills/${input.link}/SKILL.md\`](../skills/${input.link}/SKILL.md). Read it first.`, '']
                : ['<!-- Tip: keep agents short (role, boundaries, handoffs) and put the step-by-step procedure in a skill under .github/skills/. -->', ''];
            return [
                ...fm,
                `You are the **${name}** agent.`,
                '',
                ...skill,
                '## Responsibilities',
                '',
                '- …',
                '',
                '## Boundaries',
                '',
                '- Do not …',
                ''
            ].join('\n');
        }
        case 'skill':
            return [
                '---',
                `name: ${name}`,
                `description: ${q(description)}`,
                '---',
                '',
                `# ${name}`,
                '',
                '<!-- The description above is all the model sees until it decides to load this skill: say WHAT it does and WHEN to use it ("Use when: …"). -->',
                '<!-- Keep this file under ~500 lines. Put long references, examples and scripts next to it and link them with relative paths. -->',
                '',
                '## 1 — …',
                '',
                '## 2 — …',
                ''
            ].join('\n');
        case 'prompt':
            return [
                '---',
                `agent: '${input.link || 'agent'}'`,
                `description: '${description.replace(/'/g, "''")}'`,
                '---',
                '',
                `# ${name}`,
                '',
                'Use ${input:topic} / ${selection} / ${file} variables to parameterize this prompt.',
                ''
            ].join('\n');
        case 'instruction':
            return [
                '---',
                `applyTo: ${q(input.applyTo || '**/*.al')}`,
                `description: ${q(description)}`,
                '---',
                '',
                `# ${name}`,
                '',
                '- Rule …',
                ''
            ].join('\n');
    }
}

export function isValidComponentName(kind: ScaffoldInput['kind'], name: string): string | undefined {
    if (!name) { return 'Enter a name.'; }
    if (kind === 'skill' && (name.length > 64 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name))) {
        return 'Skill names: 1-64 chars, lowercase letters, digits and single hyphens.';
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) { return 'Use letters, digits, ".", "_" or "-".'; }
    return undefined;
}
