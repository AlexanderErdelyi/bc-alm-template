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
>
> **`al_build` requires an AL file or `app.json` to be the active editor.** Before calling
> `al_build`, confirm the active file is a `*.al` file or `app.json`. If it is not, open
> `app/app.json` (or any `.al` file in the project) as the active editor first, then run `al_build`.
>
> **Edit files in place — never delete and recreate.** Always use `replace_string_in_file` or
> `multi_replace_string_in_file` to modify existing AL files. Only delete a file when the spec
> explicitly removes the object entirely (e.g. "delete CU 80015"). Deleting a file to rewrite it
> clean loses git history and makes PRs harder to review. For large structural rewrites, replace the
> full body in one or two targeted edits.

## 1 — Orient
Read the spec for the ticket:
`specs/**/*-{ID}-*/plan.md` (approach + objects + task breakdown), `acceptance-criteria.md` (definition of done),
`brief.md` (context). Check `app/app.json` for the current version and confirm the object ID range.
Search for existing objects you will extend. Then summarise: what to create, what to modify,
in what order.

**Confirm the working branch — reuse before you create.** Run `git branch --show-current` first.
**If you are already on a feature/bugfix/hotfix branch for this ticket, stay on it** — a branch
"belongs to" the ticket if its name contains the ticket ID (e.g. `feature/2117-…`,
`feature/NOB-2117-…`), regardless of prefix or exact wording. Do **not** create a second branch and
do **not** rename the one you are on. Only create a branch when you are on `main` (or a branch for a
different ticket): cut it from an up-to-date `main` following the repo's convention in
[`docs/branching-strategy.md`](../../../docs/branching-strategy.md). When in doubt about whether the
current branch is the right one, ask the user rather than creating a new branch.

**If the story is broken into tasks** (task sub-folders `NN-<task-slug>/` and a story `roadmap.md`
instead of a story-level `plan.md`), read the `roadmap.md` for order/dependencies and build the
**approved** tasks in ordinal order — each task's `plan.md` + `acceptance-criteria.md` is its own
definition of done. Skip tasks the roadmap flags as not-yet-approved/future.

**If `plan.md` is flagged `Spec depth: lightweight`,** the detailed object design is *your* job:
make the field-by-field / event-by-event design decisions now, reserve object IDs (Object ID Ninja),
and **write them back into `plan.md`** (objects table, IDs, architecture decisions) before/while you
build — so the spec ends up complete. If a decision changes scope or acceptance, confirm with the
spec author first.

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
- Naming: objects PascalCase + prefix; **all variables — locals, globals, params — PascalCase**.
- `#region`/`#endregion` to group members (not banner comments); `///` XML doc comments on
  public/global procedures and custom events.
- Page-level `ApplicationArea` (not per-control); promoted actions get an `actionref` in
  `area(Promoted)`; tooltips live on the table field, inherited by pages.

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
- Run `al_build` and `al_get_diagnostics` across the app project; resolve **every error and
  every new warning** — not just the ones you consider "in scope." A stray "object is not
  assigned with AL Object ID Ninja" warning means an ID was hand-picked instead of reserved —
  fix it via `ninjaNextId` (release the wrong ID and retake if there's a collision), don't
  ignore it. Pre-existing warnings on code you didn't touch remain out of scope.
- Update the spec status back into the folder, all committed together with the code:
  - `acceptance-criteria.md` — mark each criterion you verified (`Open → Pass`, or
    `Pass (manual — no test app)` when the repo has no separate test project).
  - For a broken-down story, tick the task's checkboxes in its `NN-<task-slug>/plan.md`.
  - When a story `roadmap.md` exists, update the finished task's **Status** column and the
    **Current focus / Next action** line at the top so the orchestrator/PM agents can see
    progress without opening every task folder.
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
- [ ] All variables PascalCase; `#region`s not banners; `///` docs on public procedures;
      page-level `ApplicationArea` with promoted `actionref`s; tooltips on table fields.
- [ ] Module-wide `al_build` clean — no errors and **no new warnings** (all new object IDs
      reserved in Ninja); verified acceptance criteria marked in the spec.
- [ ] Spec status written back — `acceptance-criteria.md` (and, for broken-down stories, the
      task's `plan.md` checkboxes + the story `roadmap.md` Status/Current-focus).
- [ ] Changelog fragment added/updated (if the repo uses `changelog.d/` and the change is user-facing).

## Next step

When the checklist passes, run **`bc-review-self`**, then **`bc-ship-pull-request`**
(agent: `bc-pr`). Use **`bc-util-commit-message`** for each commit.
