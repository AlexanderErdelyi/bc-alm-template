# Plan — Enrich the template from the Nobilis analysis

Technical summary: port **generalized** procedure from Nobilis skills into the template's
existing `bc-*` skills (and a few agent/doc touch-ups). Each item strips project-specifics and
targets an existing skill so the template's role/skill topology is unchanged — we *deepen*
skills, we don't add new roles.

## Affected template files (by enrichment item)

| ID | Enrichment | Primary target file(s) | Action | Source pattern (Nobilis) |
|---|---|---|---|---|
| **E1** | Structured self-review quality gate | `.github/skills/bc-review-self/SKILL.md` | Rewrite/extend | `self-review/SKILL.md` |
| **E3** | Comprehensive PR body (changelog-by-type, WI enrichment, build info) | `.github/skills/bc-ship-pull-request/SKILL.md` | Extend | `pull-request-automation/SKILL.md` |
| **E4** | Deeper technical spec (object-ID reservation, labels/localization, ADRs, dependency map, scope boundaries) | `.github/skills/bc-spec-author/SKILL.md` | Extend | `technical-specification/SKILL.md` |
| **E6** | Error-handling playbook reference | `.github/skills/bc-build-feature/references/error-handling.md` (new) + SKILL link | Create | `feature-development/references/error-handling.md` |
| **E2** | Changelog-fragments convention | `bc-build-feature/SKILL.md` + `bc-ship-release/SKILL.md` (+ short docs note) | Extend | feature-dev Step 13.5 + release-creation Step 12a |
| **E5** | Story + estimate-task breakdown & verified ADO field quirks | `.github/skills/bc-breakdown-feature/SKILL.md` (new) + SKILLS/README/WHEN-TO-USE/bc-plan wiring | Create | `feature-breakdown/SKILL.md` |
| **E7** | Spec-driven build gate (module-wide diagnostics, AC-status update, pre-commit review gate) | `.github/skills/bc-build-feature/SKILL.md` | Extend | `spec-driven-dev/SKILL.md` |
| **E8** | *(optional)* Mode B integration-branch workflow for multi-story Features | `docs/branching-strategy.md` (+ optional reference) | Document | `feature-development/references/mode-b-workflow.md` |
| **E9** | *(optional)* Skill-authoring convention (Trigger / Workflow / Tool Contracts / Anti-Patterns / Example Triggers) | `.github/SKILLS.md` | Document | consistent Nobilis skill shape |

## Proposed delivery waves

### Wave 1 — P1 (high value, clearly generalizable, low risk) ✅ **done**
- **E1** ✅ self-review gate — 8-step workflow, 18-row deterministic-check table (`al_build`/
  `al_get_diagnostics`), findings classification 🔴/🟡/ℹ️, auto-fix rules, build-verification gate,
  Critical Rules / Anti-Patterns / Tool Contracts / Example Triggers. BCQuality section preserved.
- **E4** ✅ deeper spec-author — object-ID reservation (Object ID Ninja), ADR table, dependency map
  (runtime/read-only/none), labels/localization plan, scope boundaries; quality gate extended;
  inputs step generalized to ADO **and** GitHub + hierarchy walk.
- **E6** ✅ error-handling reference — new `bc-build-feature/references/error-handling.md`
  (WI-not-found, branch-exists, git-fails, build/symbols, ID collision, uncertainty, missing spec),
  linked from the SKILL.

### Wave 2 — P2 ✅ **done**
- **E3** ✅ comprehensive PR body — changelog grouped by conventional-commit type, work-item table,
  build-info/statistics, changelog-fragment cross-check; generalized for ADO **and** GitHub.
- **E2** ✅ changelog fragments — `bc-build-feature` drops/updates `changelog.d/{id}-{slug}.md`;
  `bc-ship-release` assembles Keep-a-Changelog sections + git-log fallback + fragment cleanup.
- **E7** ✅ build gate additions to `bc-build-feature` — module-wide `al_build`/`al_get_diagnostics`,
  acceptance-criteria status update in the spec, review gate before committing.

### Wave 3 — P3 (document, don't over-engineer) ✅ **done**
- **E5** ✅ **done** — delivered early as a new dual-backend skill `bc-breakdown-feature`
  (Azure DevOps Task carrier **and** GitHub sub-issue / Project field). Answers open question Q2.
- **E8** ✅ Mode B branching — documented as an optional integration-branch pattern in
  `docs/branching-strategy.md`.
- **E9** ✅ skill-authoring convention — documented in `SKILLS.md` (section shape + portability
  conventions + registration checklist).

## Technical approach & generalization rules

- **Generalize, never copy:** replace NOB→`ABC`, drop German, drop Wiki.js/COSMO/uat specifics.
  Where Nobilis hardcodes repo config, use template placeholders or "ask if unknown".
- **Tool references:** use the tool IDs already standardized in PR #20 (`al_get_diagnostics`,
  `al_build`, `ninjaNextId`, `search/usages`, `azure-devops/*`, `github/*`). No new tool wiring.
- **Dual backend:** any work-item step must degrade gracefully between Azure DevOps and GitHub
  Issues (the initializer wires exactly one).
- **Field-format rule:** reuse the ADO HTML-vs-Markdown rule added to `copilot-instructions.md`.
- **Keep skills self-contained:** long procedures go in a `references/` subfolder (as Nobilis does)
  so the top-level `SKILL.md` stays scannable.
- **Sync awareness:** new skill files land under `.github/skills/**` which the template-sync flow
  and `Install-IntoExistingRepo.ps1` already cover — verify no new content-category is needed.

## Dependencies

- No AL/runtime dependencies. Documentation + Markdown skill edits only.
- E1/E4/E7 assume the AL tool IDs from PR #20 (already merged).

## Risks

- **Scope creep** — Nobilis skills are large; porting verbatim would bloat the template. Mitigate
  by extracting only the generalized skeleton + checklists.
- **Over-fitting to ADO** — several source skills assume Azure DevOps; must keep GitHub parity.
- **Sync/install regressions** — adding `references/` files must not break the pruning installer.

## Minimum BC version

N/A (template tooling/docs only).
