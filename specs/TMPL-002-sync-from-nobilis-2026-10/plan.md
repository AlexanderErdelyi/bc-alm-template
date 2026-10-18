# Plan — Second sync from the Nobilis project

> Template self-improvement spec: affected **template files** instead of AL objects.

## Approach

Diff every Nobilis customization against the template, port only what generalizes (English,
`ABC` prefix, `50100–50199`, ADO **or** GitHub wording), keep the template's own content where it is
ahead, and make the two delivery-process changes **opt-in** through `template.config.json` values
that the initializer, the VS Code task and the agents read.

## Items

| # | Item | Affected files |
|---|---|---|
| 1 | **Models with fallback lists** — `model:` accepts a prioritized array; Sonnet agents `["Claude Sonnet 5.5", "Claude Sonnet 5"]`, bc-spec/bc-pr `["Claude Opus 5.5", "Claude Sonnet 5.5"]` | `template.config.json` (models), `.github/agents/*.agent.md`, `scripts/Initialize-Template.ps1`, `scripts/Update-FromTemplate.ps1`, `vscode-extension/src/core/{config,transform,validator}.ts`, `vscode-extension/test/unit.test.ts`, model docs |
| 2 | **Agent tool sets** — ask-questions, sub-agents, todo, file read/list, AL symbol relations / next ID / debug tools, NAB translation tools, browser tools (bc-dev, bc-doc), Microsoft Learn MCP | `.github/agents/*.agent.md`, `.vscode/mcp.json` |
| 3 | **Planning** — bc-plan loads its skill at start-up and always uses the ask-questions tool; ACs go into the ADO *Acceptance Criteria* field with titled Given/When/Then bullets; HTML entity escaping | `.github/agents/bc-plan.agent.md`, `.github/skills/bc-plan-user-story/SKILL.md` |
| 4 | **Estimation** — optional customer-facing `estimation.md` (work packages, Must/Should/Could, options A/B/C, plan-task appendix); bc-dev builds only the approved option | `.github/skills/bc-spec-author/{SKILL.md,references/estimation.md}`, `.github/agents/{bc-spec,bc-dev}.agent.md`, `.github/skills/bc-build-feature/SKILL.md`, `specs/_TEMPLATE/{README.md,_story/index.md}` |
| 5 | **PR tiers + conventional PR titles** — A minimal / B functional / C technical by target-branch role; title `<type>: #ID - desc`; `AB#` explained; PR template gains title convention, related work items, changes, rollout, AL quality gate | `.github/skills/bc-ship-pull-request/SKILL.md`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/agents/bc-pr.agent.md`, `.github/skills/bc-util-commit-message/SKILL.md` |
| 6 | **Instruction files** — test-codeunit standards and spec-folder rules | `.github/instructions/al-test-standards.instructions.md`, `.github/instructions/spec-workflow.instructions.md` |
| 7 | **Interactive browser test + docs tooling** — new `bc-interactive-test` skill; bc-docs-feature router with references/scripts, documentation-tooling guide, docs-coverage policy | `.github/skills/bc-interactive-test/SKILL.md`, `.github/skills/bc-docs-feature/**` (incl. `references/documentation-tooling.md`, default `references/docs-coverage-policy.json`; project override `.github/docs-coverage-policy.json`), `.github/agents/bc-doc.agent.md` |
| 8 | **Optional delivery practices** — `branchingStrategy: environment-promotion` (DEV → UAT → PROD branches, same feature branch promoted, back-merge after PROD) and `versioning: pipeline` (build computes `Major.Minor.Build.Revision`; agents don't bump `app.json`) | `template.config.json` (values + tokens), `scripts/Initialize-Template.ps1` (`-Versioning`), `.vscode/tasks.json`, `docs/branching-strategy.md`, `.github/skills/bc-cicd-pipeline/{SKILL.md,references/versioning.md,references/scripts/Get-BranchVersion.ps1}`, `.github/skills/bc-ship-release/SKILL.md`, `.github/agents/{bc-deploy,bc-workflow,bc-dev}.agent.md`, `.github/skills/bc-build-feature/SKILL.md` |
| — | **Registrations & docs** | `README.md`, `.github/AGENT-ARCHITECTURE.md`, `.github/SKILLS.md`, `.github/WHEN-TO-USE.md`, `.github/skills/README.md`, `.github/skills/bc-init-template/SKILL.md`, `template.config.json` (`template.version` 0.3.0 → 0.4.0) |

## Decisions

| Decision | Rationale |
|---|---|
| Keep scoped tool IDs, add only public/extension tools | Least privilege; private MCP servers are project-specific (adopters add them via `extraTools`) |
| One-item model arrays are written as a plain string | Backwards compatible with hosts that only accept a string |
| New practices are config values with unchanged defaults (`feature-release-selective`, `manual`) | Existing adopters see no behaviour change on sync |
| Versioning docs + script live inside the `bc-cicd-pipeline` skill folder | Template syncs deliver skills; `docs/` is not synced |
| Docs tooling guide + default coverage policy live in the skill folder | Synced with the skill; a project-owned `.github/docs-coverage-policy.json` overrides the default and survives syncs |
| Version source = git tags by default (optional feed list parameter) | Platform-neutral for GitHub Actions and Azure Pipelines |
| `estimation.md` in the customer's language | It is a customer-facing quote; all other spec docs stay English |
| Tier C = today's full PR description | Default flow (feature PR into `main`) is unchanged |

## Task Breakdown

**Status legend:** 🟪 Open · 🟦 In progress · 🟩 Ready for TEST · ✅ Done · 🔴 Blocked

| # | Task | Status |
|---|---|---|
| 1 | Models with fallback lists (config, agents, scripts, extension + test) | ✅ |
| 2 | Agent tool sets + Microsoft Learn MCP | ✅ |
| 3 | Planning: start-up, ask-questions, AC field | ✅ |
| 4 | Estimation reference + wiring | ✅ |
| 5 | PR tiers + conventional titles + PR template | ✅ |
| 6 | Test and spec instruction files | ✅ |
| 7 | Interactive test skill; docs tooling port | ✅ |
| 8 | Environment-promotion branching + pipeline versioning | ✅ |
| 9 | Registrations, docs, version bump, validation | ✅ |
