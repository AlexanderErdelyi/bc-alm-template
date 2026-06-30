---
name: bc-docs-feature
description: "Generates customer-facing functional documentation and a changelog entry for a shipped Business Central feature, checking spec-vs-implementation divergence first. Use when: write functional docs, document a feature for the customer, update the changelog, PROD documentation gate, end-user docs for BC, how-to documentation."
---

# BC · Document a Feature

Produce accurate, non-technical functional documentation from the spec **and the actual
implementation**. Core procedure of the **`bc-doc`** agent. This is the **gate before PROD** —
PROD deployment should not proceed until these docs are merged.

## 1 — Read the spec
`brief.md` (request + value), `plan.md` (planned objects), `acceptance-criteria.md` (agreed
behaviour), `change-log.md` (how the spec evolved).

## 2 — Review the implementation
Read the AL changed on the feature branch / merged PR. Which objects were created or modified?
Use the real page and field names from the AL — docs must match the BC UI.

## 3 — Check divergence (spec vs code)
List anything planned-but-not-built or built-but-not-specced:

```
⚠️ Divergence detected:
Planned but NOT implemented:
- Codeunit 50106 "ABC Payment Reminder Mgt." — not in committed files
Implemented but NOT in spec:
- Table Extension 50107 "Vendor ABC Ext." — not referenced in plan.md
```

Do **not** write docs until divergence is resolved or explicitly acknowledged (and the spec's
`change-log.md` bumped).

## 4 — Write `docs/functional/ABC-{ID}-short-description.md`
Audience: customer / end-user / functional consultant. Tone: clear, non-technical.

```markdown
# <Feature title — plain language>

**Release:** <wave/version>   **Ticket:** ABC-{ID}   **Date:** YYYY-MM-DD

## Overview
<2–3 sentences from brief.md: what it does and why.>

## How to Use
1. Navigate to <Page name> in Business Central
2. <action>
3. <expected result>

## Configuration
<setup steps, referencing the real setup page/fields, if any.>

## Notes and Limitations
<edge cases / known limitations from acceptance-criteria.md.>

## Related
- ADO Ticket: ABC-{ID}
- Spec: `specs/ABC-{ID}-short-description/`
```

## 5 — Update `docs/changelog.md`
Newest entry at the top, grouped by type:

```markdown
## v<version> — <YYYY-MM-DD> (Wave: <release>)

### New Features
- **<Feature name>** (ABC-{ID}): <one-line customer-facing description>

### Bug Fixes
- **<fix>** (ABC-{ID}): <what was fixed>
```

## 6 — Open the docs PR
Title `docs: ABC-{ID} functional documentation`; note in the description that this is the PROD
gate PR; reference the spec.

## Quality bar
Written for a non-technical user · based on actual implementation · step-by-step · free of AL
jargon · accurate to the BC UI. If any spec document is missing, stop and send the user to
**`bc-spec-author`** (agent: `bc-spec`).

## Next step
Once merged, all PROD prerequisites are satisfied → **`bc-ship-release`** (agent: `bc-deploy`).
