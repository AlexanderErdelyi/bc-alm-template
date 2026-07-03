---
name: bc-ship-pull-request
description: "Composes a high-quality Business Central pull request — description from spec and commits, AL quality checklist, and Azure DevOps work-item link. Use when: open a PR, write a pull request description, prepare the PR, fill the PR template, link the ADO work item, ready for review."
---

# BC · Ship a Pull Request

Turn a finished feature branch into a review-ready PR. Core procedure of the **`bc-pr`** agent.

## 1 — Read the spec
`specs/**/*-{ID}-*/brief.md`, `plan.md`, `acceptance-criteria.md`. If there is no spec folder,
warn the user and send them to **`bc-spec-author`** (agent: `bc-spec`) first.

## 2 — Build the changelog from commits
List commits since `main` and **group them by conventional-commit type** (this is what makes the
PR body scannable):

```pwsh
git log origin/main..HEAD --pretty=format:"%s" --no-merges     # subjects
git diff origin/main...HEAD --shortstat                        # files/insertions/deletions
git log origin/main..HEAD --pretty=format:"%s" --no-merges | Select-String -Pattern "#\d+" -AllMatches
```

- **Features** — `feat:` · **Bug Fixes** — `fix:` · **Refactoring** — `refactor:` ·
  **Performance** — `perf:` · **Chores** — `chore:`/`docs:`/`test:`/`style:` · **Other** — the rest.
- Extract every work-item id (`#123` / `AB#123`) referenced across the commits.
- **Changelog-fragment cross-check (if the repo uses them):** for any ticket id in the commits
  with no matching `changelog.d/{id}-*.md` fragment, warn and offer to create one before opening
  the PR (see `bc-build-feature`). Do **not** delete fragments here — `bc-ship-release` consumes them.

## 3 — Fetch work-item context
For each referenced id, pull Title / Type / State from the configured backend — `azure-devops/*`
(`wit_get_work_item`) or `github/*` (`gh issue view`) — and build a linked table:

| ID | Type | Title | State |
|---|---|---|---|
| #123 | User Story | Add payment tolerance | Active |

Skip this step gracefully if no work-item backend is configured (leave the id references as links).

## 4 — Compose the PR
Use [`../../PULL_REQUEST_TEMPLATE.md`](../../PULL_REQUEST_TEMPLATE.md).

- **Title:** `[ABC-{ID}] <short description matching the brief>`
- **Work-item link:** `Closes AB#123` (Azure DevOps Boards) or `Closes #123` (GitHub Issues) —
  match the backend the repo was initialized with.
- **Type of change:** derive from the spec (Feature / Bug Fix / Hotfix / Refactor / Docs).
- **Changes summary:** the grouped changelog from Step 2 (Features / Bug Fixes / Refactoring / …).
- **Related work items:** the table from Step 3.
- **Affected AL Objects** table — extract from `plan.md`:

| Object Type | Object ID | Object Name | Change Summary |
|---|---|---|---|
| Table Extension | 50102 | Customer ABC Ext. | Added Payment Tolerance % field |
| Codeunit | 50103 | ABC Payment Tolerance Mgt. | New: tolerance calculation |

- **Build info:** build status (from `al_build`), and `git diff --shortstat` (files changed,
  +insertions / −deletions).
- **Spec link:** `📄 specs/<Area>/<type>-<ID>-<slug>/`
- **Testing:** reference `acceptance-criteria.md` and the test codeunit.
- **Deployment notes:** any manual setup, config, or data migration.

## 5 — Run the quality checklist
Reuse **`bc-review-self`** and report each item ✅/❌. Items needing a build →
"requires build verification".

## 6 — Confirm, then flag blockers
Show the composed title + target + work items + commit count and **ask before creating** the PR.
If anything in Step 5 fails, output a numbered "⚠️ Issues to resolve before opening PR" list with
the exact file/line and the fix, and do **not** declare the PR ready.

## Output
The complete PR description, ready to paste, following the repo PR template — Summary, ADO
Work Item, Type of Change, Affected AL Objects, Spec, Testing, Deployment Notes, Checklist.

## Next step
After merge: **`bc-ship-release`** (agent: `bc-deploy`) to include the feature in a release
wave. If changes are requested, return to **`bc-build-feature`** (agent: `bc-dev`).
