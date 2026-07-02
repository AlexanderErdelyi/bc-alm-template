# Acceptance Criteria — Enrich the template from the Nobilis analysis

Testable, per enrichment item. "Done" = the target skill/doc contains the generalized pattern,
contains **no** Nobilis-specific content, and parses/lints clean.

## E1 — Structured self-review quality gate (`bc-review-self`)
- **AC-01** — Given a feature branch, When the skill runs, Then it defines an explicit sequence:
  establish baseline → collect diff → run deterministic checks (parallel) → classify findings
  (blocking / warning / info) → apply fixes → **build-verification gate** → structured report.
- **AC-02** — The build-verification step references `al_build` + `al_get_diagnostics` (from PR #20),
  not raw `alc`.
- **AC-03** — The skill includes `Tool Contracts`, `Anti-Patterns`, and `Example Triggers` sections.
- **AC-04** — No German text, Wiki.js, or NOB-specific references remain.

## E4 — Deeper technical spec (`bc-spec-author`)
- **AC-05** — `plan.md` authoring gains steps for: object-ID reservation (via Object ID Ninja),
  labels/localization plan, architecture decision records (ADRs), dependency map, and explicit
  scope boundaries.
- **AC-06** — The existing quality-gate checklist is extended, not replaced (all current items kept).
- **AC-07** — Object-ID guidance stays inside the assigned range and says "ask if unknown".

## E6 — Error-handling reference (`bc-build-feature`)
- **AC-08** — A new `references/error-handling.md` covers at least: work item not found, branch
  already exists, git operation fails, implementation uncertainty — each with a recommended action.
- **AC-09** — `bc-build-feature/SKILL.md` links to the reference.
- **AC-10** — Guidance is backend-neutral (works for ADO or GitHub).

## E3 — Comprehensive PR body (`bc-ship-pull-request`)
- **AC-11** — The PR body procedure produces a changelog **grouped by commit type**, a linked
  work-item summary, and a build-info section.
- **AC-12** — Steps degrade gracefully for both `azure-devops/*` and `github/*` (no ADO-only assumptions).

## E2 — Changelog fragments
- **AC-13** — `bc-build-feature` documents dropping a per-feature changelog **fragment**.
- **AC-14** — `bc-ship-release` documents **assembling** a curated changelog from fragments, with a
  git-log fallback when no fragments exist.

## E7 — Spec-driven build gate (`bc-build-feature`)
- **AC-15** — The build procedure adds: run diagnostics on the whole module/project after implementing,
  update acceptance-criteria status in the spec, and a review gate **before** committing.

## E5 — Story + estimate-task breakdown (`bc-breakdown-feature`, new skill) — ✅ both backends
- **AC-16** — Documents proposing the breakdown before creating anything, creating stories under a
  parent, setting story points, and creating one estimate-carrier per story.
- **AC-17** — Captures the verified ADO field-format quirks (ties to the HTML-vs-Markdown rule).
- **AC-16b** — Provides a **GitHub** path: parent Issue → **sub-issues**, with story points/estimate
  on a **Projects v2** field (preferred) or labels (fallback).
- **AC-16c** — Skill is wired into `SKILLS.md`, `skills/README.md`, `WHEN-TO-USE.md`, and referenced
  from the `bc-plan` agent.

## E8 — Mode B integration branch — *optional, document only*
- **AC-18** — `docs/branching-strategy.md` describes an optional integration-branch model for a
  Feature spanning multiple user stories, clearly marked optional.

## E9 — Skill-authoring convention — *optional, document only*
- **AC-19** — `SKILLS.md` documents the recommended skill section shape (Trigger Phrases / Workflow /
  Tool Contracts / Anti-Patterns / Example Triggers).

## Global
- **AC-20** — All edited/added Markdown files parse; all 10 agent frontmatters still valid.
- **AC-21** — `Initialize-Template.ps1` / `Install-IntoExistingRepo.ps1` and `template-sync.yml`
  still handle the new `references/` files (no new content-category required, or one added if needed).
- **AC-22** — No file introduced under `specs/` outside this spec folder; no Nobilis-specific content
  anywhere in the changes.

## Customer sign-off
- [ ] Maintainer confirms the wave scope (which of E1–E9 to build now).
