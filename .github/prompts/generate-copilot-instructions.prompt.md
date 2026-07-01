---
mode: 'agent'
description: 'Analyze this repository and generate or refresh .github/copilot-instructions.md plus path-scoped .github/instructions/*.instructions.md files.'
tools: ['search/codebase', 'search/textSearch', 'edit/editFiles', 'web/githubRepo', 'web/fetch', 'github/*']
---

# Generate Repository Custom Instructions

Create or update this repo's [custom instructions](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions) so Copilot has grounded, always-on context. Base everything on the **actual code** — read before you write, and confirm anything you're unsure of instead of inventing it.

## 1. Discover
Inspect the repository to learn how it really works:
- Languages/stacks, project layout, and build/test/deploy commands (for AL: `app.json`, `.vscode/tasks.json`, `docs/al-agent-tools.md`).
- Existing conventions: `.github/instructions/*.instructions.md`, `template.config.json` (prefix, ID range, branching, commit convention, work-item system, BC version), `docs/`, and representative source files.
- Any current `.github/copilot-instructions.md` — treat it as the baseline to improve, not replace wholesale.

## 2. Write `.github/copilot-instructions.md`
Repo-wide guidance that applies to every Copilot chat/agent request. Keep it concise and high-signal:
- **What this repository is** — one short paragraph.
- **Conventions to always follow** — the non-negotiable rules (naming/prefix, object-ID range, spec-first, branching, commit convention, testing), each stated as a short imperative and linking the authoritative file rather than restating it.
- **When responding** — how to behave (name the right agent for a stage, follow matching skills, ask when the ID range or a decision is unknown).
Do not paste large code blocks or duplicate the path-scoped rules — reference them.

## 3. Write path-scoped `.github/instructions/*.instructions.md`
For each area with its own rules, create a focused file with YAML frontmatter:
```markdown
---
applyTo: '**/*.al'
description: 'AL coding standards'
---
```
- Use a precise `applyTo` glob so the rules only load for matching files (e.g. `**/*.al`, `test/**`, `.github/workflows/**`).
- One concern per file; keep each rule testable and specific.
- Reuse/extend the existing `al-coding-standards.instructions.md` rather than duplicating it.

## 4. Report
List every file created or changed, and flag any rule you inferred that I should confirm. Recommend running the **`/onboarding-plan`** prompt for new team members once the instructions land.
