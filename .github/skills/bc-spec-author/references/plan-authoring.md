# Reference — Authoring `plan.md` (full-spec detail)

Load this when writing the **technical detail** of a `plan.md` for a **full** spec. For a
**lightweight** spec these sections are deferred to BUILD — the developer completes them and writes
them back into `plan.md` (see the SKILL's "Spec depth" note). Self-contained; read top to bottom.

## The affected AL objects table

Open `plan.md` with a one-paragraph technical summary, then the affected-objects table:

| Object Type | Object ID | Object Name | Action | Notes |
|---|---|---|---|---|
| Table Extension | 50100 | Customer ABC Ext. | Modify | Add tolerance % field |
| Codeunit | 50103 | ABC Payment Tolerance Mgt. | Create | Core logic |

Then list: new objects (with reserved IDs) · existing objects to modify (with the reason) ·
technical approach (extension table / event subscriber / interface …) · dependencies · risks ·
minimum BC version · performance considerations.

> Object types to consider: Table, Table Extension, Page, Page Extension, Codeunit, Report,
> Report Extension, Query, Enum, Enum Extension, Interface, XMLport, PermissionSet.

## Reserve object IDs

Assign IDs with **Object ID Ninja** (`ninjaNextId`) so you never collide with an existing object.
If Ninja is unavailable, propose the next free ID **inside the app's assigned range**, note it as
*"verify before commit"*, and confirm the range with the user if it is unknown. Never hand-pick an
ID that might clash.

## Architecture decisions (ADRs)

For any choice with a real alternative, record it so BUILD doesn't relitigate it:

| Decision | Chosen | Alternatives considered | Rationale |
|---|---|---|---|
| How to add the field | Table Extension on Customer | New related table | Simpler; avoids join; standard BC pattern |
| Trigger point | Event subscriber on OnAfterValidate | Modify base validation | Non-intrusive; upgrade-safe |

## Dependency map

Classify each dependency so the developer knows the blast radius:

| Dependency | Relationship | Notes |
|---|---|---|
| Base "Customer" table | **read-only** | Extended, not modified |
| ABC Setup singleton | **runtime** | Must exist before logic runs |
| Sales posting | **none** | Explicitly out of interaction |

## Labels & localization

List user-visible text as Labels (`...Msg/...Err/...Qst/...Lbl`, each with a `Comment`) and note
whether a translation (`.xlf`) is expected. No hardcoded strings reach BUILD.

## Diagrams (optional)

Where it aids understanding, embed a mermaid diagram in `plan.md` (e.g. an ERD of the new/extended
tables, or a flow of the process). Keep module-wide diagrams in the area `index.md`/`roadmap.md`.
