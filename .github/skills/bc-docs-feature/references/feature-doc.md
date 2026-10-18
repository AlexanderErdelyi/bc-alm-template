# Reference — Feature Doc (Track A, the PROD gate)

The procedure for documenting **one shipped work item / issue (user story, bug, task)** as a
customer-facing page plus a changelog entry. This is the **gate before PROD** — PROD deployment
should not proceed until these docs are merged. Shared writing rules:
[`writing-guide.md`](writing-guide.md). Optional screenshots:
[`interactive-ui-evidence.md`](interactive-ui-evidence.md). Optional publishing:
[`wikijs-publishing.md`](wikijs-publishing.md).

---

## A1 — Read the spec

From `specs/<Area>/<type>-<ID>-<slug>/`: `index.md` (status, links), `brief.md` (request + value),
`plan.md` (planned objects), `acceptance-criteria.md` (agreed behaviour), `change-log.md` (how the
spec evolved). If any of these is missing, stop and send the user to **`bc-spec-author`**
(agent: `bc-spec`).

## A2 — Review the implementation

Read the AL changed on the feature branch / merged PR. Which objects were created or modified? Use
the **real** page, field and action names from the AL — docs must match the BC UI.
`Get-ALObjectIndex.ps1 -Filter <text>` (see [`documentation-drift.md`](documentation-drift.md))
gives a quick inventory with files.

## A3 — Check divergence (spec vs code)

List anything planned-but-not-built or built-but-not-specced:

```
⚠️ Divergence detected:
Planned but NOT implemented:
- Codeunit 50106 "ABC Payment Reminder Mgt." — not in committed files
Implemented but NOT in spec:
- Table Extension 50107 "Vendor ABC Ext." — not referenced in plan.md
```

Do **not** write docs until divergence is resolved or explicitly acknowledged by the user (and the
spec's `change-log.md` bumped). Docs describe what shipped, never what was only planned.

## A4 — Write `docs/functional/ABC-{ID}-short-description.md`

Audience: customer / end-user / functional consultant. Tone: clear, non-technical, free of AL
jargon (see [`writing-guide.md`](writing-guide.md)). Write in the project's documentation language
(ask if unknown; default English); keep AL object/field names and file names in English.

```markdown
# <Feature title — plain language>

**Release:** <wave/version>   **Work item:** ABC-{ID}   **Date:** YYYY-MM-DD

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
- Work item / issue: ABC-{ID} (link to Azure DevOps or GitHub)
- Spec: `specs/<Area>/<type>-<ID>-<slug>/`
```

Screenshots are optional — only when the user wants them (see
[`interactive-ui-evidence.md`](interactive-ui-evidence.md)). Text first; images support, never
replace, the steps.

## A5 — Update `docs/changelog.md`

Create it if missing. Newest entry at the top, grouped by type, each line linking the functional doc:

```markdown
## v<version> — <YYYY-MM-DD> (Wave: <release>)

### New Features
- **<Feature name>** (ABC-{ID}): <one-line customer-facing description> — [docs](functional/ABC-{ID}-short-description.md)

### Bug Fixes
- **<fix>** (ABC-{ID}): <what was fixed>

### Improvements
- **<improvement>** (ABC-{ID}): <what got better>
```

Use the version from `app.json` of the release that ships the change.

## A6 — Optional: fold into the area doc set

If the area already has a doc set under `docs/modules/<area>/` (Track B), update the affected pages
too and re-confirm their drift metadata (`Update-DocsObjectMetadata.ps1`) — otherwise the next
drift check flags them.

## A7 — Open the docs PR

Title `docs: #{ID} - functional documentation`; state in the description that this is the **PROD
gate PR**; reference the spec folder and link the work item / issue.

---

## Quality bar (feature doc)

Written for a non-technical user · based on the actual implementation, not the spec · step-by-step
for tasks · real BC UI names · documentation language per project, English object names · no
planned-but-unbuilt behaviour · links resolve.

## Next step

Merged → all PROD prerequisites satisfied → **`bc-ship-release`** (agent: `bc-deploy`).
