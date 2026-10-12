import { parseFrontmatter } from './frontmatter';
import { ComponentRef, componentOf } from './paths';

const BUILTIN_PROMPT_AGENTS = new Set(['ask', 'agent', 'plan', 'edit']);

/**
 * Components referenced by a customization file: linked skills/agents/prompts/instructions,
 * handoff targets and a prompt's custom agent. Paths are template-relative (srcRel).
 */
export function referencedComponents(srcRel: string, text: string): string[] {
    const self = componentOf(srcRel);
    const out = new Set<string>();
    const fm = parseFrontmatter(text);
    const handoffs = fm.data['handoffs'];
    if (Array.isArray(handoffs)) {
        for (const h of handoffs) {
            const a = h && typeof h === 'object' ? (h as Record<string, unknown>)['agent'] : undefined;
            if (typeof a === 'string' && a) { out.add(`agent:${a}`); }
        }
    }
    if (self.kind === 'prompt') {
        const a = fm.data['agent'] ?? fm.data['mode'];
        if (typeof a === 'string' && a && !BUILTIN_PROMPT_AGENTS.has(a)) { out.add(`agent:${a}`); }
    }
    const dir = srcRel.split('/').slice(0, -1);
    const linkRe = /\]\(([^)\s#]+)(?:#[^)]*)?\)/g;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(text)) !== null) {
        const target = m[1];
        if (/^[a-z]+:/i.test(target) || target.startsWith('/')) { continue; }
        const parts = [...dir];
        for (const seg of decodeURIComponent(target).split('/')) {
            if (seg === '..') { parts.pop(); } else if (seg && seg !== '.') { parts.push(seg); }
        }
        const ref = componentOf(parts.join('/'));
        if (ref.kind !== 'file' && ref.kind !== 'doc' && ref.id !== self.id) { out.add(ref.id); }
    }
    out.delete(self.id);
    return [...out];
}

export class DependencyGraph {
    readonly uses = new Map<string, Set<string>>();
    readonly usedBy = new Map<string, Set<string>>();

    add(from: ComponentRef | string, deps: string[]): void {
        const id = typeof from === 'string' ? from : from.id;
        const set = this.uses.get(id) ?? new Set<string>();
        for (const d of deps) {
            set.add(d);
            const rev = this.usedBy.get(d) ?? new Set<string>();
            rev.add(id);
            this.usedBy.set(d, rev);
        }
        this.uses.set(id, set);
    }

    /** Transitive dependencies of `id` (excluding itself). */
    closure(id: string): string[] {
        const seen = new Set<string>();
        const stack = [...(this.uses.get(id) ?? [])];
        while (stack.length) {
            const d = stack.pop()!;
            if (seen.has(d) || d === id) { continue; }
            seen.add(d);
            stack.push(...(this.uses.get(d) ?? []));
        }
        return [...seen];
    }

    dependents(id: string): string[] {
        return [...(this.usedBy.get(id) ?? [])];
    }
}
