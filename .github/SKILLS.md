# Skills index

All Business Central Copilot Agent Skills in this template live in
[`skills/`](skills). Each is a self-contained `SKILL.md` that fires when your request matches
its `Use when:` triggers.

| Skill | Phase | Purpose |
|---|---|---|
| [`bc-triage-backlog`](skills/bc-triage-backlog/SKILL.md) | TRIAGE | Intake, triage, prioritize and groom work items (ADO/GitHub) |
| [`bc-plan-user-story`](skills/bc-plan-user-story/SKILL.md) | PLAN | Ticket/request → user story + acceptance criteria |
| [`bc-breakdown-feature`](skills/bc-breakdown-feature/SKILL.md) | PLAN | Break a Feature/Epic into child stories + estimate carriers (ADO Task or GitHub sub-issue/Project field) |
| [`bc-spec-author`](skills/bc-spec-author/SKILL.md) | SPEC | Author the 4-document spec folder |
| [`bc-build-feature`](skills/bc-build-feature/SKILL.md) | BUILD | Implement AL objects to spec + standards + tests |
| [`bc-review-self`](skills/bc-review-self/SKILL.md) | REVIEW | Pre-PR self-review against the AL quality gate |
| [`bc-ship-pull-request`](skills/bc-ship-pull-request/SKILL.md) | SHIP | Compose the PR description + checklist + ADO link |
| [`bc-ship-release`](skills/bc-ship-release/SKILL.md) | SHIP | Compose a release branch, deploy to TEST/PROD |
| [`bc-docs-feature`](skills/bc-docs-feature/SKILL.md) | DOCS | Customer-facing functional docs + changelog |
| [`bc-cicd-pipeline`](skills/bc-cicd-pipeline/SKILL.md) | CI/CD | Author/maintain GitHub Actions & AL-Go for GitHub pipelines |
| [`bc-util-commit-message`](skills/bc-util-commit-message/SKILL.md) | util | Conventional commits with ADO work-item linking |
| [`bc-init-template`](skills/bc-init-template/SKILL.md) | setup | One-time guided setup — replace prefix/range/org across the repo |

See [`skills/README.md`](skills/README.md) for how skills relate to agents,
[`WHEN-TO-USE.md`](WHEN-TO-USE.md) for the decision map, and
[`AGENT-ARCHITECTURE.md`](AGENT-ARCHITECTURE.md) for the design rationale.

## What is a skill?

A [GitHub Copilot Agent Skill](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills)
is a Markdown file (`SKILL.md`) with YAML frontmatter (`name`, `description`) and a body of
instructions. Copilot loads it automatically when the request matches the description, giving
the model a focused, repeatable procedure without bloating every prompt.

## Skill-authoring convention

Keep new `bc-*` skills consistent with the existing ones. The recommended shape (adapt as needed —
short skills can fold sections together):

1. **Frontmatter** — `name` matching the folder, and a `description` that ends with a
   `Use when:` list of natural-language trigger phrases (this is what fires the skill).
2. **One-line purpose** — what the skill does and which agent owns it.
3. **Workflow** — numbered, ordered steps. Put the deterministic procedure here; prefer tool
   IDs the template already standardizes (`al_build`, `al_get_diagnostics`, `ninjaNextId`,
   `azure-devops/*`, `github/*`).
4. **Critical rules** — the non-negotiables (confirmation-first, no red-build push, etc.).
5. **Anti-patterns** — the "❌ never do this" list.
6. **Tool contracts** — which tools are required / optional / not used.
7. **Example triggers** — a few sample prompts.
8. **Downstream hand-off** — the next skill/agent in the lifecycle.

Conventions that keep skills portable:
- **Backend-neutral** — any work-item step must degrade gracefully between Azure DevOps and
  GitHub (the initializer wires exactly one).
- **Use placeholders**, never hardcoded project values — `ABC` prefix, the assigned object-ID
  range, "ask if unknown".
- **Long procedures go in a `references/` subfolder** so the top-level `SKILL.md` stays scannable
  (see `bc-build-feature/references/`).
- **Register every new skill** in this file, [`skills/README.md`](skills/README.md), and
  [`WHEN-TO-USE.md`](WHEN-TO-USE.md); if a specific agent should surface it, note it in that
  agent's `.agent.md`.

`bc-breakdown-feature` and `bc-review-self` are good reference examples of this shape.
