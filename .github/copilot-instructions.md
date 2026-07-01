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
  object, and `app.json` version bumps in the same PR.
- **App prefix** is `ABC` and the **object ID range** is `50100–50199` in the sample app.
  Replace both with your team's assigned prefix and range (see the "Customizing this
  template" section of the README).
- **Branching**: feature branches are cut from `main` as `feature/<id>-<short-name>`;
  release branches are composed selectively. See [docs/branching-strategy.md](../docs/branching-strategy.md).
- **Specs come first**: do not implement AL objects until the spec folder exists and is
  reviewed. The `bc-dev` agent reads `plan.md` and `acceptance-criteria.md`.

## When responding

- Name the specific agent to switch to when a task belongs to a different stage.
- When a task matches a skill's `Use when:` triggers, follow that skill's procedure.
- Reference spec files and the relevant standard rather than restating them.
- Never invent object IDs outside the assigned range; ask if the range is unknown.
