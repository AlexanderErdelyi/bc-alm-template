# BC Skills

This folder holds reusable **[GitHub Copilot Agent Skills](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills)**
for Business Central ALM. Each skill is a self-contained `SKILL.md` that Copilot can load
automatically when your request matches its `Use when:` triggers — in chat, in the CLI, or
from inside one of the [`bc-` agents](../agents).

## Why skills *and* agents?

- **Agents** ([`.github/agents`](../agents)) are personas with a tool profile and a model.
  They own a stage of the workflow and hand off to the next agent.
- **Skills** (this folder) are the portable, tool-agnostic *procedures*. They are the single
  source of truth for "how do we do X" and can be reused outside any specific agent.

Each agent points at its backing skill ("read the matching `SKILL.md` first"), so the
procedure lives in one place.

## The skills (mapped to the lifecycle)

| Lifecycle phase | Skill | What it does | Backing agent |
|---|---|---|---|
| TRIAGE | [`bc-triage-backlog`](bc-triage-backlog/SKILL.md) | Intake, triage, prioritize and groom work items (ADO/GitHub) | `bc-pm` |
| PLAN | [`bc-plan-user-story`](bc-plan-user-story/SKILL.md) | Turn a ticket/request into a crisp user story + acceptance criteria | `bc-plan` |
| SPEC | [`bc-spec-author`](bc-spec-author/SKILL.md) | Author the 4-document spec folder | `bc-spec` |
| BUILD | [`bc-build-feature`](bc-build-feature/SKILL.md) | Implement AL objects to spec, standards, version bump, tests | `bc-dev` |
| REVIEW | [`bc-review-self`](bc-review-self/SKILL.md) | Pre-PR self-review against the BC quality gate | `bc-dev` / `bc-pr` |
| SHIP | [`bc-ship-pull-request`](bc-ship-pull-request/SKILL.md) | Compose the PR description + checklist + ADO link | `bc-pr` |
| SHIP | [`bc-ship-release`](bc-ship-release/SKILL.md) | Compose a release branch and guide TEST/PROD deployment | `bc-deploy` |
| DOCS | [`bc-docs-feature`](bc-docs-feature/SKILL.md) | Generate customer-facing functional docs + changelog | `bc-doc` |
| CI/CD | [`bc-cicd-pipeline`](bc-cicd-pipeline/SKILL.md) | Author/maintain GitHub Actions & AL-Go for GitHub pipelines | `bc-workflow` |
| UTIL | [`bc-util-commit-message`](bc-util-commit-message/SKILL.md) | Conventional commits with ADO work-item linking | any |
| SETUP | [`bc-init-template`](bc-init-template/SKILL.md) | One-time guided setup: replace prefix/range/org across the repo | `bc-init` |

See [`../WHEN-TO-USE.md`](../WHEN-TO-USE.md) for a decision map and
[`../AGENT-ARCHITECTURE.md`](../AGENT-ARCHITECTURE.md) for the design rationale.

## Conventions used by every skill

- **Ticket / spec naming:** `specs/ABC-{ID}-short-description/` (kebab-case, 3–5 words).
- **Object prefix & range:** replace the sample `ABC` prefix and `50100–50199` range with
  your own assigned values (see [`app/app.json`](../../app/app.json)).
- **Coding standards:** all AL work follows
  [`../instructions/al-coding-standards.instructions.md`](../instructions/al-coding-standards.instructions.md).

## Adapting these skills

Run the **guided initializer** first (the `bc-init` agent or `scripts/Initialize-Template.ps1`) —
it sets your prefix, object range, repo slug, ADO org, and work-item style across every skill and
file in one pass. For anything it can't infer (a bespoke commit convention, extra environments),
edit the relevant `SKILL.md` by hand. Keep each skill's `name` and `Use when:` triggers so Copilot
can still find them.
