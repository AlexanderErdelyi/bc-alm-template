---
name: fit-gap
description: "Fit-gap analysis of the BC14 customizations against standard BC29 online, decisions per area, route and effort estimate, customer assessment. Use when: fit-gap, which customizations can be dropped, is this covered by standard, ISV replacement, decide extension scope, choose upgrade route, upgrade assessment document."
---

# Fit-gap

Decide, per customization area, what happens to it in BC29 (AL), online. The result drives conversion effort, data upgrade scope and the customer assessment.

Strategy for this project: **Smart select** – Decide per area and object: keep, replace with standard or an app, redesign, or drop.
Challenge every area: prefer `STANDARD`, `ISV` or `DROP` where the evidence supports it; `CONVERT` only what still adds value.

## Prerequisites

- `docs/assessment/inventory.md` and `.bcupgrade/cache/inventory/` exist (skill `inventory`).

## Decision codes

| Code | Meaning | Typical signal |
|---|---|---|
| `STANDARD` | Drop; covered by standard BC29 or a Microsoft app | Feature added since BC14 |
| `ISV` | Replace with the add-on vendor's BC29 AppSource version | Add-on ID range |
| `CONVERT` | Move to an AL extension largely as-is | Custom objects without `Blocker` findings |
| `REDESIGN` | Rebuild with extension patterns | `Blocker` findings, modifications of standard code without events |
| `DROP` | No longer used | No data, no usage, confirmed by the customer |
| `OPEN` | Needs customer input | – |

## Procedure

1. **Group** relevant objects into areas (typically 5–30).
2. **Collect evidence per area** from the CSVs: object counts per type, custom fields, blocker/rework findings, lines of code. Open single objects by line range only where needed.
3. **Check standard coverage** in BC29 on Microsoft Learn – never from memory – and record the URL.
4. **Check removed or changed platform features** between BC14 and BC29 (deprecated features, obsoleted tables and APIs, Windows client and MenuSuite).
5. **Check data relevance.** Areas with custom tables or fields carry data: migrate, archive or drop. Ask for record counts (`source/usage/`) if missing.
6. **Choose the route** and record it as a decision (`ROUTE`):
   - C/AL → AL conversion: BC14 (C/AL) → BC14 (AL) – Convert the C/AL customizations to AL with Txt2Al, then move them to extensions on the Microsoft base application.
   - Application upgrade: BC14 (AL) → BC25 (AL) – BC14 to BC24 upgrade directly to any later version up to BC25.
   - Application upgrade: BC25 (AL) → BC29 (AL) – Since v26, BC14 to BC24 must upgrade to BC25 first; BC25 and later upgrade directly.
   - Cloud migration: BC29 (AL) → BC29 online – Cloud migration needs Business Central 25.0 or later on premises; migrate from the same version as the online environment or the previous release.
   Alternatives for the move online (e.g. a reimplementation without history) must be weighed explicitly; check Microsoft Learn for the currently supported options.
7. **Estimate** per area (T-shirt S/M/L/XL with day ranges). State the formula (object count, lines of code, blockers). Use `.bcupgrade/estimates/` when BC Upgrade Pilot has produced an estimate.
8. **Write outputs** and a decision record per area in `docs/decisions/`.

## Outputs

`docs/assessment/fit-gap.md` (English):

```markdown
| Area | Group | Objects (T/P/R/C/X/Q) | Custom fields | Blockers | Decision | Target app | Effort | Evidence |
```

`docs/de/upgrade-assessment.md` (German, customer-facing): starting point, target (BC29 (AL), online), recommended route with reasons, assessment per area (table), risks, open questions for the customer, rough effort. Object and field names stay English; no rule IDs or internal jargon.

## Rules

- No decision without evidence. Missing evidence → `OPEN` plus a question in `docs/assessment/open-questions.md`.
- Do not promise standard coverage based on feature names alone; describe the functional gap.
