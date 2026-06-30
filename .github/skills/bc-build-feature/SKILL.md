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
> [`references/al-patterns.md`](references/al-patterns.md).

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

## Pre-PR checklist

- [ ] Every object in `plan.md` implemented.
- [ ] No hardcoded text (Labels) and no hardcoded IDs (enums/setup).
- [ ] No base-table modifications.
- [ ] Event subscribers used where applicable.
- [ ] `app/app.json` version bumped per the table.
- [ ] Test codeunit in the `test/` project covers the acceptance criteria.
- [ ] Permission set updated; `DataClassification` on all new fields.

## Next step

When the checklist passes, run **`bc-review-self`**, then **`bc-ship-pull-request`**
(agent: `bc-pr`). Use **`bc-util-commit-message`** for each commit.
