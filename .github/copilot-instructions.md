# Copilot Instructions — BC ALM Template

These are repository-wide instructions for GitHub Copilot. They apply to all chat and
agent interactions in this repo, in addition to the path-scoped rules in
[`.github/instructions/`](instructions/).

## What this repository is

This is an Application Lifecycle Management (ALM) template for **Microsoft Dynamics 365
Business Central** AL development. It combines:

- **Custom agents** (`.github/agents/`) — roles across the lifecycle (orchestrator, PM/triage,
  plan, spec, dev, PR, deploy, doc) plus CI/CD and setup utilities. Prefer the relevant agent for
  stage-specific work; start with `bc-orchestrator` if unsure.
- **Reusable skills** (`.github/skills/`) — [Copilot Agent Skills](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills)
  (`bc-*/SKILL.md`) that hold the procedure for each lifecycle phase and fire automatically on
  matching requests. Each agent is backed by one. See [`.github/WHEN-TO-USE.md`](WHEN-TO-USE.md)
  and [`.github/AGENT-ARCHITECTURE.md`](AGENT-ARCHITECTURE.md).
- **Prompt files** (`.github/prompts/`) — explicitly-invoked, parameterized tasks (`/onboarding-plan`,
  `/onboard-app`, `/generate-copilot-instructions`) for onboarding people and projects and for
  generating repository instructions. See [`.github/prompts/README.md`](prompts/README.md).
- **Spec-driven development** (`specs/`) — every ticket gets a spec folder
  (`brief.md`, `plan.md`, `acceptance-criteria.md`, `change-log.md`) before AL is written.
- **Issue orchestration** (`.github/workflows/`) — automated intake → planning → approval →
  implementation. See [`.github/ISSUE_ORCHESTRATION.md`](ISSUE_ORCHESTRATION.md).
- **A minimal sample AL app** — a two-project workspace (`app/` production app + `test/` test
  app) demonstrating the conventions.

## Conventions to always follow

- **AL code** must follow [AL coding standards](instructions/al-coding-standards.instructions.md):
  PascalCase object names with the app prefix, no hardcoded text or IDs, extension tables
  for new fields, event subscribers over base modifications, permission sets for every
  object, and `app.json` version bumps in the same PR (unless `template.config.json` `versioning` is `pipeline`).
- **App prefix** is `ABC` and the **object ID range** is `50100–50199` in the sample app.
  Replace both with your team's assigned prefix and range (see the "Customizing this
  template" section of the README).
- **Branching**: feature branches are cut from `main` as `feature/<id>-<short-name>`;
  release branches are composed selectively. See [docs/branching-strategy.md](../docs/branching-strategy.md),
  which also documents the optional `environment-promotion` model (`template.config.json` `branchingStrategy`).
- **Specs come first**: do not implement AL objects until the spec folder exists and is
  reviewed. The `bc-dev` agent reads `plan.md` and `acceptance-criteria.md`.

## AL build & diagnostics (tool usage)

When the AL agent tools are available (the AL Language extension or the `al` MCP server — see
[docs/al-agent-tools.md](../docs/al-agent-tools.md)), prefer them over raw terminal commands:

- **After every AL edit, check `al_get_diagnostics`** (or `#al_getdiagnostics` in chat) and resolve
  errors before moving on. Do not rely on reading source alone to judge whether code compiles.
- **Do not run `alc.exe` directly in the terminal** for routine work — use `al_build` to compile to
  a `.app`, and `al_downloadsymbols` when references are missing. Reserve manual `alc` invocation
  for CI or when the tools are unavailable.
- **Navigate symbolically**: use `al_symbolsearch` and `search/usages` (find references) instead of
  text search when you need to locate objects, fields, or callers — they understand AL scopes.
- **New object IDs** come from Object ID Ninja (`ninjaNextId`); never hand-pick an ID that may
  collide. Keep IDs inside the app's assigned range.

## Work-item tools (Azure DevOps / GitHub)

- Choose the work-item backend that matches the repo: Azure DevOps (`azure-devops/*`) or GitHub
  Issues/PRs (`github/*`). The initializer wires exactly one; don't mix.
- **Azure DevOps field formats matter**: the work-item **Description** (and other large HTML fields)
  must be written as **HTML**, while **comments/discussion** use **Markdown**. Sending Markdown into
  an HTML field renders raw tags. Match the field's expected format when creating or updating items.
- **Images/attachments can't be uploaded via the MCP tools.** The Azure DevOps work-item tools can
  only *download* an existing attachment (`wit_get_work_item_attachment`) — there is no upload/create
  attachment tool. So a screenshot pasted into chat cannot be pushed into a work item programmatically.
  When the user asks to attach an image, **say so** and either (a) ask them to drag-drop/paste the
  image directly into the work item's Description or a comment in the browser, or (b) if a PAT is
  configured, upload it yourself via the REST attachments API (`POST _apis/wit/attachments`) with
  `curl`, then reference the returned URL in the Description HTML (`<img src="…">`) or as an
  `AttachedFile` relation. Never silently skip an attachment request.

## When responding

- Name the specific agent to switch to when a task belongs to a different stage.
- When a task matches a skill's `Use when:` triggers, follow that skill's procedure.
- Reference spec files and the relevant standard rather than restating them.
- Never invent object IDs outside the assigned range; ask if the range is unknown.
