---
applyTo: "specs/**"
description: "Spec folder structure and authoring rules for Business Central specs"
---

# Spec Workflow — Authoring Rules

These rules apply when creating or editing any file under `specs/`. Every work item gets a spec
folder **before** AL implementation begins. The full procedure is the
[`bc-spec-author`](../skills/bc-spec-author/SKILL.md) skill; the scaffolds and their layout are in
[`specs/_TEMPLATE/`](../../specs/_TEMPLATE/README.md).

## Folder layout

```text
specs/<Area>[/<Sub-area>]/<type>-<ID>-<slug>/
```

- Organised by **module / functional area**, not by ticket hierarchy.
- `<type>` = `us` | `bug` | `feat` | `epic` | `task` | `spike`; `<ID>` = the **bare** work-item number;
  `<slug>` = 3–5 kebab-case words from the ticket title. Example:
  `specs/Finance/Payments/us-123-payment-tolerance/`.
- **Never put the app/ticket prefix (`ABC-`) in a spec path** — it belongs only to branch names.
- Find a spec by ID with `specs/**/*-{ID}-*/`. If one exists, **edit it in place** — never create a
  second folder, rename or move it.

## Documents

| Shape | Story folder | Task sub-folders `NN-<task-slug>/` |
|---|---|---|
| **Flat** (default) | `index`, `brief`, `plan`, `acceptance-criteria`, `change-log` | — |
| **Broken into tasks** | `index`, `brief`, `roadmap`, `change-log` | `plan`, `acceptance-criteria` (+ optional `change-log`) |

- Optional: `estimation.md` at story level when an estimate is requested
  ([reference](../skills/bc-spec-author/references/estimation.md)); area `index.md` / `roadmap.md`
  from `_TEMPLATE/_area/`.
- Copy the scaffolds from `specs/_TEMPLATE/` and keep their **nav bar** under each H1 so every
  document links its siblings.
- Write spec documents in **English**. Exceptions: a verbatim customer quote (with an English
  summary) and the customer-facing `estimation.md`.

## `plan.md`

- Affected AL objects table — `Object Type · ID · Name · Action · Notes`.
- Object IDs within the assigned range `50100–50199`, reserved via Object ID Ninja (`ninjaNextId`) —
  never hand-picked. New fields go into table extensions, never base tables.
- Ends with the **Task Breakdown** status table. Status legend:
  🟪 Open · 🟦 In progress · 🟩 Ready for TEST · ✅ Done · 🔴 Blocked — update **only the Status
  cell**; never move rows or rewrite task text.
- A lightweight spec is flagged `> **Spec depth:** lightweight …` at the top; BUILD completes the
  object detail and writes it back.

## `acceptance-criteria.md`

- Given/When/Then, numbered `AC-01`, `AC-02`, … — at least three, each testable by a non-developer.
- Each automatable AC maps to at least one `[Test]` procedure (see
  [al-test-standards](al-test-standards.instructions.md)).
- Mark criteria as they are verified (`Open → Pass`, or `Pass (manual — no test app)`).

## `change-log.md`

Every change to `brief.md`, `plan.md`, `acceptance-criteria.md` or `estimation.md` after v1.0 gets a
row (`Version · Date · Author · Change · Requested By`).

## Lifecycle & status

1. **Draft** → 2. **Spec review** (spec PR open) → 3. **In development** → 4. **In test** → 5. **Done**
   — kept in the story `index.md` Status row.
- Open questions may remain at review time if they are flagged *awaiting customer* in `brief.md` and
  the dependent design is marked as an assumption in `plan.md`.
- Keep status **live** during BUILD: `plan.md` Status cells, `acceptance-criteria.md` marks, and —
  for broken-down stories — the `roadmap.md` **Current focus / Next action** line and task Status
  column. `bc-orchestrator` and `bc-pm` read these to decide the next action, so they must reflect
  reality, not intent.
