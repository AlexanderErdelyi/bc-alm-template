# Copilot customization best practices (BC ALM)

This guide ships with the BC ALM extension. It summarizes the current GitHub / VS Code guidance
for agents, skills, prompts and instructions, and how the BC ALM template applies it.
The **Validate Copilot Customizations** command and the live diagnostics check most of these
rules. Each finding links to the official page it comes from.

> Copilot customization moves fast. The **Guidance & What's New** view lists recent
> GitHub changelog entries about agents, skills, prompts and MCP. When something here
> disagrees with the official docs, the docs win. Please open an issue or a PR on the template.

## Pick the right building block

| You want… | Use | Lives in | Loaded |
|---|---|---|---|
| Always-on rules for certain files (coding standards) | **Instruction** | `.github/instructions/*.instructions.md` (+ `copilot-instructions.md` for repo-wide) | Automatically, when a matching file is in context (`applyTo`) |
| A repeatable procedure ("how we spec a feature") with optional scripts/resources | **Skill** | `.github/skills/<name>/SKILL.md` | On demand: the model sees only `name` + `description` until it decides the skill is relevant |
| A persona with its own tools, model and handoffs | **Custom agent** | `.github/agents/<name>.agent.md` | When picked in the agent picker, delegated to, or reached through a handoff |
| An explicit, parameterized `/command` | **Prompt file** | `.github/prompts/<name>.prompt.md` | Only when the user types `/name` |

Rules of thumb:

- **Procedure goes in a skill, role goes in an agent.** BC ALM agents are thin. Each one
  states its role, boundaries and handoffs, then points at a backing skill (`bc-*`)
  that holds the steps. Skills also work on the GitHub.com coding agent and in the Copilot CLI,
  so the procedure is written once and reused everywhere.
- **Instructions are for rules, not workflows.** Keep them short and declarative. Long
  instructions consume context on every request that matches `applyTo`.
- **Prompts are for things a human starts on purpose** (onboarding, generating instructions).
  Don't duplicate a skill in a prompt. Have the prompt run an agent that uses the skill.

## Agents (`*.agent.md`)

- `description` is **required**. Write it for the model: what the agent does and
  `Use when: …` trigger phrases. Copilot uses it to choose agents for delegation.
- Keep the body well under the **30,000 character** limit. If you are close, move procedures into a skill.
- `tools`: list only what the agent needs. Prefer tool sets (`search/*`, `edit/*`) and
  MCP server groups (`azure-devops/*`, `github/*`). Fewer tools means better tool choice.
- `handoffs` (VS Code) chain agents: plan → spec → dev → PR. Make sure each target
  agent exists. A disabled agent breaks the handoff, and the validator warns about it.
- `target: vscode | github-copilot` restricts where the agent is used. Omit it to use the agent everywhere.
  `handoffs`/`argument-hint` are VS Code only; `mcp-servers`/`metadata` are GitHub.com only.
- `infer` is **retired**. Use `disable-model-invocation: true` to keep an agent out of
  automatic delegation, and `user-invocable: false` to hide it from the picker.
- `model`: BC ALM pins models per agent in `template.config.json → models`, so a template
  sync keeps your choice. Change the model there, not in the agent file.
- Chat modes (`*.chatmode.md`) are the old name of custom agents. Rename them to `*.agent.md` in `.github/agents/`.

## Skills (`SKILL.md`)

- Frontmatter needs `name` and `description`.
  - `name`: 1–64 chars, `a-z0-9` and single hyphens, and it must match the folder name.
  - `description`: at most 1024 chars, saying **what** the skill does and **when** to use it (`Use when: …`).
    The model only sees this text before deciding to load the skill.
- **Progressive disclosure:** keep `SKILL.md` under ~500 lines. Put long references,
  examples, checklists and scripts next to it (`references/`, `scripts/`, `assets/`).
  Link to them with relative paths so they are read only when needed.
- Optional keys from the [Agent Skills spec](https://agentskills.io/specification):
  `license`, `compatibility` (≤500 chars), `metadata`, `allowed-tools`.
- Skills are portable: the same folder works in VS Code, the Copilot CLI and the GitHub.com
  coding agent. Avoid VS Code-only assumptions in skill text.

## Prompt files (`*.prompt.md`)

- Use `agent:` (formerly `mode:`) to choose `ask`, `agent`, `plan` or one of your custom agents.
- Add a `description` so the prompt is easy to find in the `/` picker.
- Parameterize with `${input:name}`, `${selection}`, `${file}` instead of hardcoding values.

## Instructions (`*.instructions.md`)

- Add `applyTo` (for example `"**/*.al"`) so the rules load automatically for matching files.
  Without it, they are used only when attached manually.
- Be concrete and checkable ("Every object needs a permission set entry"), not aspirational.
- Repo-wide context belongs in `.github/copilot-instructions.md`, and BC ALM generates it
  from your real app (`/generate-copilot-instructions`). `AGENTS.md` at the repo root is
  also read by Copilot and other agents.

## Working with the template

- **Change what you need. The extension keeps track.** `template.lock.json` records which
  template version each file came from. Edited files show as *Modified*. When the template
  changes the same file, you get a 3-way merge instead of an overwrite.
- **Don't want a component?** Disable it. Files move to `.bc-alm/disabled/`, Copilot stops
  loading them, and syncs skip them. You can enable it again any time.
- **Never want template updates for a component?** Use *Always Keep My Version*. It is recorded in
  `template.config.json → sync.components.keepLocal` so the GitHub sync workflow honors it too.
- **Built something good?** Use *Save to My Template* for your team's template, or *Contribute to Source
  Template* to open a PR upstream. Your project values (prefix, ID range, org) are mapped back
  to the template placeholders first, and you see a diff before anything is pushed.
- **Commit `template.lock.json`** so teammates and CI share the same baseline.

## Official documentation

- Custom agents: [VS Code](https://code.visualstudio.com/docs/copilot/customization/custom-agents) · [GitHub configuration reference](https://docs.github.com/en/copilot/reference/custom-agents-configuration)
- Agent skills: [VS Code](https://code.visualstudio.com/docs/copilot/customization/agent-skills) · [GitHub](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills) · [Specification](https://agentskills.io/specification)
- [Prompt files](https://code.visualstudio.com/docs/copilot/customization/prompt-files)
- [Custom instructions](https://code.visualstudio.com/docs/copilot/customization/custom-instructions)
- [GitHub changelog — Copilot](https://github.blog/changelog/label/copilot/)
