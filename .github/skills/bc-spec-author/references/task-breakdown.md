# Reference — Breaking a story into tasks (in place)

Load this when the user asks to **break a story down**, **split it into tasks / sub-tasks**, **plan
the task breakdown**, or when a large / multi-part story needs task sub-folders. It is the detailed
procedure behind the SKILL's *Breaking a story into tasks* note. Self-contained; read top to bottom.

## When to break down

Split a story into task sub-folders only when at least one is true:

- it has **several distinct deliverables** (e.g. a new table *and* a separate automation),
- it is **large enough to build and test in independent slices**, or
- **some parts are approved now and others are future / parked** pending customer sign-off.

Don't over-split: a change that touches a handful of objects is **one flat story**, not three tasks.
Tasks are a spec-side breakdown; they may or may not mirror ADO child Tasks under the User Story.

## ⚠️ Golden rule — this is an IN-PLACE EDIT, not a rebuild

Breaking a story down **edits the existing story folder**. It never recreates it.

**Before touching anything, locate the existing spec** — glob `specs/**/*-{ID}-*/`. If a folder for
the ID exists (it almost always does by this stage), you **must** edit *that* folder. You may only
create a new folder for a brand-new ticket that has no spec yet.

When editing in place you **MUST**:

- **Keep the existing folder exactly where it is** — same area (`specs/Finance/…`), same **bare-ID**
  name (`us-2117-…`), same `brief.md`.
- **Keep the bare ID with no prefix.** The folder stays `us-2117-…`; it never becomes `NOB-2117-…` /
  `ABC-2117-…`. The app/ticket prefix belongs only to git branches and functional-doc folders.

You **MUST NOT**:

- ❌ rename or move the story folder,
- ❌ add the app/ticket prefix to it,
- ❌ create a *second* folder for the same ID,
- ❌ re-copy the whole `_story` scaffold over it / re-scaffold from the template,
- ❌ discard the existing area organisation or `brief.md`.

You are only **adding** subfolders + a `roadmap.md` and **relocating** the plan / acceptance content
down into the tasks.

## Procedure

Given an existing flat story at `specs/<Area>/<type>-<ID>-<slug>/` (with `index.md`, `brief.md`,
`plan.md`, `acceptance-criteria.md`, `change-log.md`):

1. **Keep the story-level docs.** Leave `brief.md`, `index.md`, and `change-log.md` in place. The
   `brief.md` still describes the **whole** story.
2. **Add the story roadmap.** Copy **only** `specs/_TEMPLATE/_story/roadmap.md` into the story folder.
   It sequences the tasks: order, dependencies, status, and **approval state**.
3. **Create the task folders.** For each task, copy `specs/_TEMPLATE/_task/` to
   `<story-folder>/NN-<task-slug>/`, where `NN` = `01`, `02`, … (the ordinal fixes build order).
   Each task folder holds `plan.md` + `acceptance-criteria.md` (+ optional `change-log.md`).
4. **Relocate the technical detail.** Move the content of the story-level `plan.md` /
   `acceptance-criteria.md` **down into the relevant task folders** (each task gets the slice that
   belongs to it, with its own Task Breakdown checklist). Then **delete the two story-level files** —
   their detail now lives per task, and the story keeps `brief`/`roadmap`/`index`/`change-log`.
5. **Fill in the roadmap & index tables.** List every task with its order, dependencies, status, and
   approval state. An unapproved / future task **stays parked in the roadmap**, flagged, until it is
   signed off — do not delete it and do not start building it.
6. **Wire dependencies.** Cross-task dependencies go in each task's `plan.md` *Dependencies* section
   **and** in the roadmap, so BUILD knows the safe order.
7. **Fix the nav bars.** The story `index.md` bar swaps `Plan`/`Acceptance` for `[Roadmap](roadmap.md)`
   (broken-down stories have no story-level plan/acceptance). Each task doc opens with a
   `**Task NN:** [Plan](plan.md) · [Acceptance](acceptance-criteria.md) · [Change Log](change-log.md) · [↑ Story](../index.md)`
   bar. See the SKILL's *Cross-navigation* note.
8. **Record it.** Add a `change-log.md` row on the story ("v1.1 — broke story into tasks 01–NN").

## Worked example — us-2117

Customer call on User Story 2117: refactor the Country/Division bank-data setup. Two deliverables —
a new flexible table + migration (approved now), and combining it with the standard SWIFT/IBAN fields
for xRechnung (future, not yet approved).

**Before** (flat story, already exists — keep it):

```
specs/Finance/us-2117-country-division-bank-data/
├── index.md
├── brief.md
├── plan.md
├── acceptance-criteria.md
└── change-log.md
```

**After** (broken down IN PLACE — same folder, same name, same area):

```
specs/Finance/us-2117-country-division-bank-data/   ← unchanged path & name
├── index.md              # updated: task table + nav bar → roadmap
├── brief.md              # unchanged — whole-story request
├── roadmap.md            # NEW — task order + approval state
├── change-log.md         # + row: "broke into tasks 01–02"
├── 01-new-country-division-table/   # approved now
│   ├── plan.md           # ← from the old story plan.md (this slice)
│   ├── acceptance-criteria.md
│   └── change-log.md     # optional
└── 02-standard-bank-fields-xrechnung/   # FUTURE — parked in roadmap, not built
    ├── plan.md
    └── acceptance-criteria.md
```

The old story-level `plan.md` / `acceptance-criteria.md` are **removed** after their content is split
into `01-…` and `02-…`. Nothing is renamed, re-prefixed, or moved to a different area.
