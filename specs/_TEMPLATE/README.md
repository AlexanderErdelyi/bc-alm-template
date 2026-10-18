# Spec Template

Scaffolding for every BC development spec. Specs are organised by **module / functional area**, not
by ticket hierarchy. This folder holds three copyable scaffolds:

| Scaffold | Copy to | When |
|---|---|---|
| `_area/` | `specs/<Area>/` | first time an area gains a story (area `index.md` + optional `roadmap.md`) |
| `_story/` | `specs/<Area>/<type>-<ID>-<slug>/` | every work item |
| `_task/` | `specs/<Area>/<type>-<ID>-<slug>/NN-<task-slug>/` | only when a story is broken into tasks |

`<type>` = `us` \| `bug` \| `feat` \| `epic` \| `task` \| `spike`; `<ID>` = bare work-item number (no
prefix); `<slug>` = 3–5 kebab-case words. Example: `specs/Finance/Payments/us-123-payment-tolerance/`.
Find a spec by ID with the recursive glob `specs/**/*-{ID}-*/`.

## Two story shapes

**Flat** (default, small story) — five documents in the story folder:

```
<type>-<ID>-<slug>/
├── index.md               # overview, status, nav
├── brief.md               # business request, value, scope (non-technical)
├── plan.md                # technical approach + AL objects + task breakdown
├── acceptance-criteria.md # Given/When/Then, testable
└── change-log.md          # spec version history
```

Optional in either shape: a story-level **`estimation.md`** — customer-facing work packages, hours
and A/B/C scope options, added when an estimate is requested (see `bc-spec-author`
`references/estimation.md`). It is the one spec document written in the customer's language.

**Broken into tasks** (large / multi-part story) — the story keeps the shared docs and the technical
detail moves into numbered task sub-folders:

```
<type>-<ID>-<slug>/
├── index.md               # overview + task table (status / approved / link)
├── brief.md               # whole-story request, value, scope
├── roadmap.md             # task sequencing: order, dependencies, approved-now vs future
├── change-log.md          # spec history (per-task change-logs optional)
├── 01-<task-slug>/
│   ├── plan.md
│   ├── acceptance-criteria.md
│   └── change-log.md       # optional
└── 02-<task-slug>/
    ├── plan.md
    └── acceptance-criteria.md
```

Break a story down when it has several distinct deliverables, is buildable in independent slices, or
has some parts approved now and others deferred. Don't over-split — a change touching a handful of
objects is one flat story.

## Cross-navigation

Every document opens (under its H1) with a one-line nav bar so any doc is reachable from any other:

- **Story:** `[Index] · [Brief] · [Plan] · [Acceptance] · [Change Log]` (index also `↑ Area`; a
  broken-down story swaps Plan/Acceptance for `[Roadmap]`).
- **Task NN:** `[Plan] · [Acceptance] · [Change Log] · [↑ Story]`.
- **Area:** `[Index] · [Roadmap]`.

Keep these bars when you copy a scaffold.

## Language

Spec documents are written in **English** (the engineering contract). A verbatim customer quote may
stay in the customer's language with an English summary. Customer-facing work-item content (the user
story, the spec summary written back to Azure DevOps) stays in the customer's preferred language.

## Workflow

1. Spec is authored (agent `bc-spec` / skill `bc-spec-author`) and reviewed via a **spec PR**, merged
   **before** a feature branch is created.
2. `bc-dev` builds from `plan.md` + `acceptance-criteria.md` (per task, for a broken-down story).
3. `change-log.md` records every change to the spec after v1.0.

## Which docs each agent reads

| Agent | Reads |
|---|---|
| bc-plan | drafts the user story; back-writes a spec summary to the work item |
| bc-spec | creates/completes all spec documents |
| bc-dev | `plan.md`, `acceptance-criteria.md` (per task if broken down) |
| bc-pr | `brief.md`, `plan.md` |
| bc-doc | all documents |
| bc-orchestrator | checks the spec folder exists (`specs/**/*-{ID}-*/`) |
