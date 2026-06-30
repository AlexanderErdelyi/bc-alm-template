---
name: bc-ship-pull-request
description: "Composes a high-quality Business Central pull request — description from spec and commits, AL quality checklist, and Azure DevOps work-item link. Use when: open a PR, write a pull request description, prepare the PR, fill the PR template, link the ADO work item, ready for review."
---

# BC · Ship a Pull Request

Turn a finished feature branch into a review-ready PR. Core procedure of the **`bc-pr`** agent.

## 1 — Read the spec
`specs/ABC-{ID}-*/brief.md`, `plan.md`, `acceptance-criteria.md`. If there is no spec folder,
warn the user and send them to **`bc-spec-author`** (agent: `bc-spec`) first.

## 2 — Review the commits
List commits since `main` and group them: object creations · object modifications · tests ·
docs · `app.json` bump · permission sets.

## 3 — Compose the PR
Use [`../../PULL_REQUEST_TEMPLATE.md`](../../PULL_REQUEST_TEMPLATE.md).

- **Title:** `[ABC-{ID}] <short description matching the brief>`
- **ADO link:** `Closes AB#123` (GitHub auto-links to Azure DevOps when boards integration is on).
- **Type of change:** derive from the spec (Feature / Bug Fix / Hotfix / Refactor / Docs).
- **Affected AL Objects** table — extract from `plan.md`:

| Object Type | Object ID | Object Name | Change Summary |
|---|---|---|---|
| Table Extension | 50102 | Customer ABC Ext. | Added Payment Tolerance % field |
| Codeunit | 50103 | ABC Payment Tolerance Mgt. | New: tolerance calculation |

- **Spec link:** `📄 specs/ABC-{ID}-short-description/`
- **Testing:** reference `acceptance-criteria.md` and the test codeunit.
- **Deployment notes:** any manual setup, config, or data migration.

## 4 — Run the quality checklist
Reuse **`bc-review-self`** and report each item ✅/❌. Items needing a build →
"requires build verification".

## 5 — Flag blockers
If anything fails, output a numbered "⚠️ Issues to resolve before opening PR" list with the
exact file/line and the fix, and do **not** declare the PR ready.

## Output
The complete PR description, ready to paste, following the repo PR template — Summary, ADO
Work Item, Type of Change, Affected AL Objects, Spec, Testing, Deployment Notes, Checklist.

## Next step
After merge: **`bc-ship-release`** (agent: `bc-deploy`) to include the feature in a release
wave. If changes are requested, return to **`bc-build-feature`** (agent: `bc-dev`).
