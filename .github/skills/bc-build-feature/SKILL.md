---
name: bc-build-feature
description: "Implements Business Central AL objects to a spec, enforcing coding standards, version bumping app.json, and generating test codeunits. Use when: implement an AL feature, write AL code, build from a spec, create tableextension/codeunit/page, add a field, bump app.json version, generate test codeunit, code a BC change."
---

# BC · Build a Feature

Implement AL objects for a spec'd feature, correctly and to standard. This is the core
procedure of the **`bc-dev`** agent.

> All AL code must follow
> [`../../instructions/al-coding-standards.instructions.md`](../../instructions/al-coding-standards.instructions.md).
> Detailed AL patterns (extensions, enums, events, error handling, read-only queries) live in
> [`references/al-patterns.md`](references/al-patterns.md). When something goes wrong (work item
> not found, branch exists, build/symbols fail, object-ID collision, ambiguous spec), follow
> [`references/error-handling.md`](references/error-handling.md).

> **Build & diagnose with the AL toolchain — don't guess.** In VS Code Agent mode use
> `#al_build` and `#al_getdiagnostics` to compile and read real compiler errors, and
> `#al_symbolsearch` to find base-app objects/events. Headless: `al workspace compile`
> (ALTool) or the AL MCP server. The production app lives in `app/` and tests in `test/`
> (see [`bc-alm-template.code-workspace`](../../../bc-alm-template.code-workspace)).
> Setup: [`docs/al-agent-tools.md`](../../../docs/al-agent-tools.md).

## 1 — Orient
Read the spec for the ticket:
`specs/ABC-{ID}-*/plan.md` (approach + objects), `acceptance-criteria.md` (definition of done),
`brief.md` (context). Check `app/app.json` for the current version and confirm the object ID range.
Search for existing objects you will extend. Then summarise: what to create, what to modify,
in what order.

## 2 — Object creation order
1. Enums → 2. Tables / Table Extensions → 3. Codeunits → 4. Pages / Page Extensions →
5. Reports / Report Extensions → 6. Permission Sets → 7. Test Codeunits.

## 3 — Implement to standard (non-negotiables)
- **Table Extensions, never base-table edits.** `DataClassification` on every field. Field IDs
  in your range.
- **Enums over Option fields.** `Extensible = true` unless intentionally closed.
- **Labels for all user-visible text** (`...Msg`, `...Err`, `...Qst`, `...Lbl` with `Comment`).
- **No hardcoded values** — use enums, setup tables, or helper getters (no literal country
  codes, IDs, etc.).
- **Event subscribers over base modifications.**
- **Read-only queries** use `SetLoadFields` / `ReadIsolation(IsolationLevel::ReadUncommitted)`.
- Naming: objects PascalCase + prefix; locals lowerCamelCase; params/globals PascalCase.

See `references/al-patterns.md` for copy-ready snippets.

## 4 — Bump `app/app.json`

| Change type | Bump | Example |
|---|---|---|
| Bug fix | build +1 | `1.2.3.0 → 1.2.4.0` |
| New feature | minor +1, build reset | `1.2.3.0 → 1.3.0.0` |
| Breaking change | major +1 | `1.2.3.0 → 2.0.0.0` |

## 5 — Tests & permissions
- One **test codeunit** (`Subtype = Test;`) per new business-logic codeunit, added to the
  separate `test/` project, with `[GIVEN]/[WHEN]/[THEN]` comments, covering happy path + edge
  cases from `acceptance-criteria.md`. Use a +50 ID offset (objects 50100–50110 → tests 50150–50160).
- Update a **permission set** to cover every new/changed object (use a Permission Set
  Extension when extending an existing one).

## 6 — Final validation & spec status
After the objects are in, validate the **whole module**, not just the last file you touched:
- Run `al_build` and `al_get_diagnostics` across the app project; resolve every error and every
  in-scope warning before proceeding.
- Update the spec's acceptance criteria: in `specs/ABC-{ID}-*/acceptance-criteria.md`, mark each
  criterion you have verified (e.g. `Open → Pass`). Commit this together with the code.
- **Review gate — ask before committing.** Summarise what changed, the build/diagnostics result,
  and the AC status, then confirm with the user before you commit. Never auto-commit a red build.

## 7 — Changelog fragment (optional, if the repo uses `changelog.d/`)
For a customer- or consultant-facing change (new/changed behaviour, bug fix — **not** pure
internals), drop a **changelog fragment** so it can be assembled at release time by
**`bc-ship-release`**. One fragment per ticket, covering the whole feature scope:

1. Check `changelog.d/` for an existing `{ticketId}-*.md`; if present, **update** it (merge bullets)
   rather than adding a second file for the same ticket.
2. Write `changelog.d/{ticketId}-{slug}.md` (slug = kebab-case feature name):

   ```markdown
   ---
   workitem: {ticketId}
   type: Added        # Added | Changed | Fixed | Deprecated | Removed | Security
   module: {module}
   ---
   {Headline sentence — the customer benefit.}
   - {capability 1}
   - {capability 2}
   ```
   Map commit type → fragment `type`: `feat:` → `Added` (or `Changed` for behaviour changes),
   `fix:` → `Fixed`; `perf:`/`refactor:` usually get no fragment unless user-visible.
3. Commit the fragment **with the code** so it travels into `main`. Do not assemble or delete
   fragments here — that is `bc-ship-release`'s job.

- [ ] Every object in `plan.md` implemented.
- [ ] No hardcoded text (Labels) and no hardcoded IDs (enums/setup).
- [ ] No base-table modifications.
- [ ] Event subscribers used where applicable.
- [ ] `app/app.json` version bumped per the table.
- [ ] Test codeunit in the `test/` project covers the acceptance criteria.
- [ ] Permission set updated; `DataClassification` on all new fields.
- [ ] Module-wide `al_build` clean; verified acceptance criteria marked in the spec.
- [ ] Changelog fragment added/updated (if the repo uses `changelog.d/` and the change is user-facing).

## Next step

When the checklist passes, run **`bc-review-self`**, then **`bc-ship-pull-request`**
(agent: `bc-pr`). Use **`bc-util-commit-message`** for each commit.
