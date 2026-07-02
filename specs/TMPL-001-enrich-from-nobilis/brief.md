# Brief — Enrich the template from the Nobilis project analysis

> **Note:** This is a *template self-improvement* spec, not an end-user AL feature. It follows
> the standard four-document spec convention so the initiative is planned and reviewable the
> same way any feature is. `plan.md` lists **affected template files** instead of AL objects.

## Reference

- **Source of patterns:** `C:\VSCodeProjects\NobilisGroupGmbHDevops\D365BC-Nobilis-Core\app\.github`
  (a mature, production BC project with its own agents/skills, read-only — not part of this repo).
- **Prior work already merged:** PR #20 — AL extension LM tools wired into agent profiles + AL
  build/diagnostics and work-item operating rules.

## Request in plain words

While comparing this template against the Nobilis project's Copilot customizations, several of
their **skills** turned out to be much more procedural and battle-tested than ours (self-review,
PR automation, technical specification, feature breakdown, changelog handling). We want to lift
the **generalizable** parts of those patterns into the template so every new repo benefits,
without dragging in anything Nobilis-specific.

## Business value

- New repos created from the template get **deeper, more reliable skill procedures** out of the
  box (structured self-review, comprehensive PR bodies, richer specs, estimate-carrying task
  breakdowns).
- Captures institutional knowledge (verified MCP/ADO quirks, error-handling playbooks) that is
  otherwise re-learned per project.
- Keeps the template a clean **superset** of good practice while staying vendor/customer-neutral.

## Priority

P2 — improvement initiative, not blocking. Ship in prioritized waves (see `plan.md`).

## Requested by

Repository owner (template maintainer).

## Explicitly out of scope (Nobilis-specific — do NOT port)

- **Wiki.js documentation pipeline** (`docs-and-wiki`, `Invoke-WikiJsPage.ps1`, `docs-publisher`
  agent) — bound to their Wiki.js instance.
- **`module-documentation`** design-system / WAF-constraints reference files — their house design.
- **German-language** content and dual-language prompts.
- **`sync-uat-from-main`** and the UAT dual-PR branching model — their branching choice.
- **`deploy-notification`** (COSMO Alpaca / Teams webhook specifics).
- **`objidconfig.template.prompt`** and any NOB prefix / module-map specifics.

## Open questions

1. Which priority waves to actually build now vs defer (see `plan.md` — P1/P2/P3)?
2. Should the estimate-task breakdown (E5) assume Azure DevOps only, or also model a GitHub
   Issues equivalent (sub-issues / task-list)?
3. Do we want a formal **skill-authoring convention** (E9) documented in `SKILLS.md`, or keep
   skills free-form?

## Decisions

- **Q2 → both backends.** E5 is built as a dedicated dual-backend skill `bc-breakdown-feature`
  (Azure DevOps Task estimate carrier **and** GitHub sub-issue + Projects v2 field), delivered ahead
  of its P3 wave at the maintainer's request.
