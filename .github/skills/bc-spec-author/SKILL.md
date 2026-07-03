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

**Diagrams** (mermaid): keep high-level ones (module ERD, process flow, decision tree) in the area
`index.md`/`roadmap.md`; keep story-specific ones in that story's `plan.md`. Add them where they aid
understanding — they are optional, not mandatory.

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

### 2 — `brief.md` (non-technical)
Ticket reference & URL · customer request in their words · business value · priority
(P1/P2/P3) · requested by · target release · **open questions** (explicit) · **out of scope**.

### 3 — `plan.md` (for the developer)
One-paragraph technical summary, then the **affected AL objects** table:

| Object Type | Object ID | Object Name | Action | Notes |
|---|---|---|---|---|
| Table Extension | 50100 | Customer ABC Ext. | Modify | Add tolerance % field |
| Codeunit | 50103 | ABC Payment Tolerance Mgt. | Create | Core logic |

Plus: new objects (with IDs from your assigned range) · existing objects to modify (with
reason) · technical approach (extension table / event subscriber / interface …) ·
dependencies · risks · minimum BC version · performance considerations.

> Object types to consider: Table, Table Extension, Page, Page Extension, Codeunit, Report,
> Report Extension, Query, Enum, Enum Extension, Interface, XMLport, PermissionSet.

#### 3a — Reserve object IDs
Assign IDs with **Object ID Ninja** (`ninjaNextId`) so you never collide with an existing object.
If Ninja is unavailable, propose the next free ID **inside the app's assigned range**, note it as
*"verify before commit"*, and confirm the range with the user if it is unknown. Never hand-pick an
ID that might clash.

#### 3b — Architecture decisions (ADRs)
For any choice with a real alternative, record it so BUILD doesn't relitigate it:

| Decision | Chosen | Alternatives considered | Rationale |
|---|---|---|---|
| How to add the field | Table Extension on Customer | New related table | Simpler; avoids join; standard BC pattern |
| Trigger point | Event subscriber on OnAfterValidate | Modify base validation | Non-intrusive; upgrade-safe |

#### 3c — Dependency map
Classify each dependency so the developer knows the blast radius:

| Dependency | Relationship | Notes |
|---|---|---|
| Base "Customer" table | **read-only** | Extended, not modified |
| ABC Setup singleton | **runtime** | Must exist before logic runs |
| Sales posting | **none** | Explicitly out of interaction |

#### 3d — Labels & localization
List user-visible text as Labels (`...Msg/...Err/...Qst/...Lbl`, each with a `Comment`) and note
whether a translation (`.xlf`) is expected. No hardcoded strings reach BUILD.

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

#### 3g — Diagrams (optional)
Where it aids understanding, embed a mermaid diagram in `plan.md` (e.g. an ERD of the new/extended
tables, or a flow of the process). Keep module-wide diagrams in the area `index.md`/`roadmap.md`.

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
the work item, one-paragraph overview, links to the four documents above, and an optional diagram.
Also add/update the row for this story in the area `index.md` so the module overview stays current.

## Quality gate — before opening the spec PR

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
- [ ] Open questions and out-of-scope explicit.
- [ ] Minimum BC version stated in `plan.md`.
- [ ] Permission sets noted if new objects are created.

If critical info is missing, output a numbered "⚠️ Missing information" list and stop.

## Next step

Open a **spec PR** (separate from the code PR), get sign-off on `brief.md` and
`acceptance-criteria.md`, then move to **`bc-build-feature`** (agent: `bc-dev`).
