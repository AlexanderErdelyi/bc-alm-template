---
name: bc-spec-author
description: "Authors the Business Central spec folder (index, brief, plan, acceptance-criteria, change-log) under its module/functional area so a developer can implement without guessing. Use when: create a spec, write the spec folder, draft brief and plan, prepare a feature for development, spec out an AL change, technical specification for BC."
---

# BC · Author a Spec

Create a complete, developer-ready specification for a BC feature. The spec is the contract
between PLAN and BUILD. This is the core procedure of the **`bc-spec`** agent.

## Output: the spec folder

Specs are organised by **module / functional area** (mirroring how the code and the business
think about the app), **not** by ticket hierarchy. One folder per work item lives under its area:

```
specs/
└── <Area>[/<Sub-area>…]/          # e.g. Finance, Sales/Invoicing — free-form, any depth
    ├── index.md                   # area overview: story list + status + links + high-level diagrams (optional)
    ├── roadmap.md                 # phased / epic narrative that may span stories & areas (optional)
    └── <type>-<ID>-<slug>/         # one folder per work item
        ├── index.md               # story overview: status, nav to the docs, optional diagram
        ├── brief.md               # business request, value, scope (non-technical)
        ├── plan.md                # technical approach + AL objects + task breakdown (for the developer)
        ├── acceptance-criteria.md # Given/When/Then, testable
        └── change-log.md          # version history of the spec itself
```

**Story folder name** = `<type>-<ID>-<slug>`:
- `<type>` — work-item type token: `us` (user story), `bug`, `feat` (feature), `epic`, `task`, `spike`.
- `<ID>` — the work-item ID, **bare number** (e.g. `2117`). No app/ticket prefix in the path.
- `<slug>` — 3–5 words, kebab-case, from the ticket title.
- Example: `specs/Finance/Payments/us-123-payment-tolerance/`.

**Area folder** is optional overview scaffolding. Create `index.md` (and `roadmap.md` when useful)
the first time an area gains a story, so there is a navigable overview. `brief.md`/`change-log.md`
at the area level are optional — the area `index.md` usually covers the "what/why", and per-story
change-logs plus the roadmap cover history.

**Epics / features that span areas** are tracked *in markdown* — in an area (or top-level)
`roadmap.md`/`index.md` that cross-links the child story folders wherever they live — **not** by
nesting story folders inside an epic folder. This keeps each story next to the module it touches.

**Finding a spec by ID:** glob recursively — `specs/**/*-{ID}-*/` matches the story folder at any
depth regardless of type. Agents use this to locate a ticket's spec.

**Cross-navigation.** Every document must be reachable from every other one — a reader who opens
`brief.md` should be able to jump to `plan.md` without going back through `index.md`. Start each
story document (immediately under its H1 title) with a one-line **Story nav bar** that links the
siblings and bolds the current file:
`**Story:** [Index](index.md) · [Brief](brief.md) · [Plan](plan.md) · [Acceptance](acceptance-criteria.md) · [Change Log](change-log.md)`
(the story `index.md` also adds `· [↑ Area](../index.md)`). Area docs carry `**Area:** [Index](index.md) · [Roadmap](roadmap.md)`.
The `specs/_TEMPLATE/` files already include these bars — keep them when you copy the template.

**Diagrams** (mermaid): keep high-level ones (module ERD, process flow, decision tree) in the area
`index.md`/`roadmap.md`; keep story-specific ones in that story's `plan.md`. Add them where they aid
understanding — they are optional, not mandatory.

**Language.** Write every spec document in **English** — the spec is the engineering contract and may
be read by any developer. The one exception: you may keep a *verbatim* customer quote in the
**Customer Request** section in the customer's own language (e.g. German) when that customer is
non-English-speaking — but add an English summary alongside it. Everything else (business value,
open questions, plan, acceptance criteria, change log) is English. Summarise any foreign-language
source material (tickets, call notes) into English rather than copying it wholesale.

**Spec depth — full vs lightweight.** Decide up front (ask the user if unclear) how detailed the
`plan.md` needs to be:

- **Full spec** (default) — the complete plan below: exact objects + reserved IDs, architecture
  decisions, dependency map, labels/localization. Use when the design is non-trivial or the
  developer is new to the area.
- **Lightweight spec** — a high-level `plan.md`: the technical approach in prose, the affected
  objects at a *coarse* level (types + rough responsibility; IDs optional), and a task breakdown —
  but **not** the field-by-field / event-by-event design. Use for small, well-understood changes,
  or when a senior wants a junior to make the detailed design decisions during BUILD. Flag it at the
  top of `plan.md`:
  `> **Spec depth:** lightweight — detailed object design is completed during BUILD and recorded back here.`
  The `brief.md` and `acceptance-criteria.md` are **still required and still fully testable**; only
  the technical detail in `plan.md` is deferred. During BUILD the developer fills in the exact
  objects, IDs, and decisions and updates `plan.md`.

## Procedure

### 1 — Gather inputs & context
Ticket ID, title, description, priority, requestor, target release, attachments. Read the ticket
from the configured work-item backend — Azure DevOps (`azure-devops/*`) or GitHub Issues
(`github/*`) — otherwise ask the user to paste it. If a `bc-plan-user-story` output already exists,
start from it. **Walk the hierarchy:** if the ticket is a child, read its parent Feature/Epic and
sibling stories so scope boundaries are informed; fold in any spike/investigation findings.

**Pick the area & create the folder.** Decide which module/functional area the work belongs to
(ask the user if unclear — it should match how the codebase/business is organised). Copy the
scaffold: the story docs from `specs/_TEMPLATE/_story/` into
`specs/<Area>/<type>-<ID>-<slug>/`, and — if the area has no overview yet — `specs/_TEMPLATE/_area/`
into `specs/<Area>/`. Add the new story to the area `index.md` table.

**Clarify interactively — one question at a time.** Resolve ambiguities by asking the user a single
focused question at a time, each with a short list of suggested answers they can pick or override
(the ask-questions tool where available — VS Code's `askQuestions` — otherwise ask inline; the same
conversational style `bc-plan` uses) — never dump a wall of questions or invent answers.
Unanswered points are **not** a blocker to drafting: record each under **Open Questions** in
`brief.md`, flagged *awaiting customer* with who owns it and by when, then continue with a
clearly-labelled assumption in `plan.md`. A spec can ship to review with open questions still open,
as long as they are explicit and the dependent decisions are marked as assumptions.

**Align before you write.** Before committing an approach to `plan.md`, confirm the technical
direction with the user: surface the constraints and alternative approaches you found, state your
key assumptions, and validate the ones that carry real design risk. If the answers materially change
scope, loop back to gathering — and if the *requirement* itself changes (not just the design), hand
back to `bc-plan`. Keep it proportionate (a one-line check for a small change; confirm the key ADRs
for a non-trivial design).

### 2 — `brief.md` (non-technical)
Ticket reference & URL · customer request in their words (with an English summary if it was in
another language) · business value · priority (P1/P2/P3) · requested by · target release ·
**open questions** (each flagged *answered* or *awaiting customer* with an owner) · **out of scope**.

### 3 — `plan.md` (for the developer)
One-paragraph technical summary, then the **affected AL objects** table (Object Type · ID · Name ·
Action · Notes), followed by: new objects (with reserved IDs) · existing objects to modify (with
reason) · technical approach · dependencies · risks · minimum BC version · performance notes.

For a **full** spec, follow **[references/plan-authoring.md](references/plan-authoring.md)** for the
object table, ID reservation (Object ID Ninja), architecture decisions (ADRs), the dependency map,
labels/localization, and diagrams. For a **lightweight** spec, keep this section high-level (approach
+ coarse object list) and let BUILD fill in that detail.

Always include, inline, regardless of depth:

#### 3e — Scope boundaries
State explicitly what this spec **does** and **does not** cover, referencing sibling stories where
responsibility lands elsewhere (e.g. "reporting is handled by us-1235, not here").

#### 3f — Task breakdown
End `plan.md` with an ordered, checkable task list (this is the breakdown BUILD executes — no
separate `tasks.md` unless the story grows large enough to warrant one):

```markdown
## Task Breakdown
- [ ] Create table 50100 "…" with fields …
- [ ] Add event subscriber in codeunit 50103 …
- [ ] Add page extension 50101 to surface the field
- [ ] Write tests for AC-01…AC-03
```

### 4 — `acceptance-criteria.md`
Given/When/Then, numbered `AC-01…`. Add edge cases, error scenarios (expected messages),
testing notes (prerequisite data/setup), and a customer sign-off placeholder.

### 5 — `change-log.md`
Seed with v1.0:

```markdown
| Version | Date | Author | Change | Requested By |
|---|---|---|---|---|
| 1.0 | YYYY-MM-DD | <you> | Initial spec created | <requestor> |
```

### 6 — `index.md` (story overview)
A short navigation page: status (Draft / Spec review / In development / In test / Done), a link to
the work item, one-paragraph overview, links to the sibling documents, and an optional diagram.
Also add/update the row for this story in the area `index.md` so the module overview stays current.

### 7 — Present & refine
Show the user a short summary (approach, key decisions, acceptance criteria, open questions) and
handle their response: **changes** → revise the affected docs and keep the whole spec in sync
(`plan`, `acceptance-criteria`, `index` status, a `change-log` row); **questions** → clarify
one-at-a-time; **alternative** → loop back to align (or to `bc-plan` if the requirement changed);
**approval** → run the quality gate and open the spec PR. Don't open the PR until the user approves
or explicitly asks you to commit the draft as-is.

## Quality gate — before opening the spec PR

*(For a **lightweight** spec, the object-detail items — reserved IDs, architecture decisions,
dependency map, labels/localization — are **deferred to BUILD**; the depth marker, task breakdown,
brief, and acceptance criteria are still required.)*

- [ ] All 5 story documents present (`index`, `brief`, `plan`, `acceptance-criteria`, `change-log`).
- [ ] Story lives under the right area folder; area `index.md` lists it.
- [ ] `plan.md` ends with a task breakdown.
- [ ] Object IDs reserved from the assigned range (Object ID Ninja, or marked "verify").
- [ ] No base-table modifications planned (use table extensions).
- [ ] ≥ 3 acceptance criteria.
- [ ] Architecture decisions recorded for any non-obvious choice.
- [ ] Dependency map present (runtime / read-only / none).
- [ ] Scope boundaries explicit (what's out, and which sibling owns it).
- [ ] Labels/localization plan noted; no hardcoded strings anticipated.
- [ ] Open questions and out-of-scope explicit (unanswered questions flagged *awaiting customer*).
- [ ] Every document written in English (a verbatim customer quote may stay in their language, with an English summary).
- [ ] Minimum BC version stated in `plan.md`.
- [ ] Permission sets noted if new objects are created.

If critical info is missing, output a numbered "⚠️ Missing information" list and stop.

## Next step

Open a **spec PR** (separate from the code PR), get sign-off on `brief.md` and
`acceptance-criteria.md`, then move to **`bc-build-feature`** (agent: `bc-dev`).
