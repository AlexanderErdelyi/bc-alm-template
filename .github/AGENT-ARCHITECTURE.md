# Agent architecture

Design record for the Business Central ALM agent + skill system in this template. Read this if
you want to understand *why* it is structured the way it is before adapting it.

## Goals

1. **One procedure, one place.** Each "how do we do X" lives in a single `SKILL.md`. Agents are
   thin personas that point at their backing skill, so procedures never drift between the two.
2. **Lifecycle-driven.** Every task moves through TRIAGE → PLAN → SPEC → BUILD → REVIEW → SHIP →
   DOCS. The agent set maps onto those phases.
3. **Coordinator + workers.** One orchestrator (`bc-orchestrator`) detects the current phase and
   hands off to the worker that owns it.
4. **Portable & durable.** Each agent pins a single `model:` managed centrally in
   [`template.config.json`](../template.config.json), and tool lists stay generic, so the system
   works in a fresh repo with minimal edits. A guided initializer (`bc-init` /
   `scripts/Initialize-Template.ps1`) handles the project-specific placeholders **and** rewrites
   the per-agent `model:` lines from config.

## Layers

| Layer | Location | Responsibility |
|---|---|---|
| **Instructions** | [`instructions/`](instructions) | Always-on coding standards (`applyTo` globs). |
| **Skills** | [`skills/`](skills) | Reusable, trigger-fired procedures (the "how"). |
| **Agents** | [`agents/`](agents) | Personas with a tool profile + `handoffs:` (the "who"). |
| **Orchestrator** | [`agents/bc-orchestrator.agent.md`](agents/bc-orchestrator.agent.md) | Stage detection + routing. |
| **Templates** | `ISSUE_TEMPLATE/`, `PULL_REQUEST_TEMPLATE.md` | Quality gates at intake and PR. |

## The agents

| Agent | Phase(s) | Default model | Backing skill(s) |
|---|---|---|---|
| `bc-orchestrator` | all (router) | Claude Sonnet 4.6 | — |
| `bc-pm` | TRIAGE | Claude Sonnet 4.6 | `bc-triage-backlog` |
| `bc-plan` | PLAN | Claude Sonnet 4.6 | `bc-plan-user-story` |
| `bc-spec` | SPEC | Claude Opus 4.8 | `bc-spec-author` |
| `bc-dev` | BUILD, REVIEW | Claude Sonnet 4.6 | `bc-build-feature`, `bc-review-self` |
| `bc-pr` | REVIEW, SHIP | Claude Opus 4.8 | `bc-review-self`, `bc-ship-pull-request` |
| `bc-deploy` | SHIP | Claude Sonnet 4.6 | `bc-ship-release` |
| `bc-doc` | DOCS | Claude Sonnet 4.6 | `bc-docs-feature` |
| `bc-workflow` | CI/CD (utility) | Claude Sonnet 4.6 | `bc-cicd-pipeline` |
| `bc-init` | setup (one-time utility) | Claude Sonnet 4.6 | `bc-init-template` |

> `bc-workflow` (CI/CD & AL-Go pipeline authoring) and `bc-init` (one-time setup) are **utility**
> agents outside the TRIAGE → DOCS lifecycle. `bc-init` runs once, when a repo is first created
> from this template, to replace the prefix/range/org placeholders and sync agent models (see
> [`scripts/Initialize-Template.ps1`](../scripts/Initialize-Template.ps1) and
> [`template.config.json`](../template.config.json)). Neither is in `bc-orchestrator`'s handoff chain.

## Conventions

- **`description: "Use when: …"`** — every agent and skill front-loads trigger phrases so
  Copilot can discover them. Keep these when you edit.
- **Single `model:` per agent, config-managed.** Each agent sets `model:` to one name matching
  your Copilot model picker. The source of truth is the `models` map in
  [`template.config.json`](../template.config.json); the initializer writes it into each agent.
  Defaults: Sonnet 4.6 for most, Opus 4.8 for the deep-reasoning agents (`bc-spec`, `bc-pr`). If
  VS Code flags a model as unknown, add the ` (copilot)` suffix.
- **Role-based, namespaced tool profiles.** Each agent lists a tool profile sized to its job,
  using namespaced built-in IDs (`search/codebase`, `search/textSearch`, `edit/editFiles`,
  `web/githubRepo`, `web/fetch`, `execute/runInTerminal`, and `agent` for the orchestrator) plus
  MCP servers wired in via wildcard IDs from [`.vscode/mcp.json`](../.vscode/mcp.json):
  - `github/*` — on every agent that touches issues, PRs, or repo content.
  - `azure-devops/*` — on the work-item-facing agents (`bc-pm`, `bc-plan`, `bc-spec`, `bc-pr`,
    `bc-dev`, `bc-deploy`, `bc-orchestrator`). If your project tracks work in GitHub Issues,
    the initializer (`-WorkItemSystem GitHub`) strips this group automatically.
  - `al/*` — on the AL-heavy agents (`bc-dev`, `bc-spec`, `bc-pr`, `bc-deploy`). These become
    live only once you enable the `al` MCP server (rename `_al` → `al` in `.vscode/mcp.json`
    after installing the AL Dev Tools); until then they show as unavailable, which is harmless.

  Trim or extend any profile per repo — the wildcard IDs are the seam for your own MCP tools.
- **Handoffs are human-in-the-loop.** A `handoffs:` entry is a labelled, one-click step to the
  next agent — the human stays in control of phase transitions.

## Adapting this for your project

1. Replace the sample `ABC` object prefix and `50100–50199` range with your assigned values
   (see [`app/app.json`](../app/app.json)) — across the skills and agents.
2. Set your branch naming, ADO organisation/project, and environment names in
   `bc-ship-release` and `bc-deploy`.
3. Add project-specific MCP tools to the relevant agent `tools:` lists.
4. Set per-agent models in the `models` map of [`template.config.json`](../template.config.json)
   and re-run the initializer, or edit a `.agent.md` `model:` line directly.
5. Keep `name`, `description`/`Use when:` triggers, and `handoffs:` intact so discovery and
   routing keep working.

## Lineage

The structure (skills + thin agents, lifecycle phases, coordinator/worker handoffs, meta-docs)
is adapted from a mature internal BC `.github` setup and generalised: environment-specific tool
lists, branch models, and naming were stripped so the template is reusable.
