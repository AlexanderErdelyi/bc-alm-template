---
name: bc-spec-author
description: "Authors the four-document Business Central spec folder (brief, plan, acceptance-criteria, change-log) so a developer can implement without guessing. Use when: create a spec, write the spec folder, draft brief and plan, prepare a feature for development, spec out an AL change, technical specification for BC."
---

# BC · Author a Spec

Create a complete, developer-ready specification for a BC feature. The spec is the contract
between PLAN and BUILD. This is the core procedure of the **`bc-spec`** agent.

## Output: the spec folder

```
specs/ABC-{ID}-short-description/
├── brief.md               # business request, value, scope (non-technical)
├── plan.md                # technical approach + affected AL objects (for the developer)
├── acceptance-criteria.md # Given/When/Then, testable
└── change-log.md          # version history of the spec itself
```

`short-description` = 3–5 words, kebab-case, from the ticket title.

## Procedure

### 1 — Gather inputs
ADO ticket ID, title, description, priority, requestor, target release, attachments. Read the
ticket via the Azure DevOps MCP server if configured; otherwise ask the user to paste it. If a
`bc-plan-user-story` output already exists, start from it.

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

## Quality gate — before opening the spec PR

- [ ] All 4 documents present.
- [ ] Object IDs from the assigned range (ask if unknown).
- [ ] No base-table modifications planned (use table extensions).
- [ ] ≥ 3 acceptance criteria.
- [ ] Open questions and out-of-scope explicit.
- [ ] Minimum BC version stated in `plan.md`.
- [ ] Permission sets noted if new objects are created.

If critical info is missing, output a numbered "⚠️ Missing information" list and stop.

## Next step

Open a **spec PR** (separate from the code PR), get sign-off on `brief.md` and
`acceptance-criteria.md`, then move to **`bc-build-feature`** (agent: `bc-dev`).
