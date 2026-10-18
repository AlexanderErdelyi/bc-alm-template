---
name: bc-ship-pull-request
description: "Composes a high-quality Business Central pull request — description from spec and commits, AL quality checklist, and Azure DevOps work-item link. Use when: open a PR, write a pull request description, prepare the PR, fill the PR template, link the ADO work item, ready for review, PR title convention, promotion PR to DEV/UAT/PROD."
---

# BC · Ship a Pull Request

Turn a finished feature branch into a review-ready PR. Core procedure of the **`bc-pr`** agent.

## PR description tiers — match the target branch

The description depth depends on **who reads the PR**, which follows from the target branch. Read
`values.branchingStrategy` and `values.environments` in `template.config.json` and
[`docs/branching-strategy.md`](../../../docs/branching-strategy.md) to know each branch's role.

| Tier | Target branch role | Audience | Content |
|---|---|---|---|
| **A — Minimal** | integration / DEV branch (e.g. `develop`, or the optional Mode B integration branch) | internal devs, fast integration | Title + work item + 1–2 sentence summary. No checklist, object table or test section — those come with the later PRs. |
| **B — Functional** | UAT / TEST branch (e.g. `release/UAT`) — the customer review gate | customer, key users, testers | Summary in the **customer's language**, numbered **What to test** scenarios from `acceptance-criteria.md`, internal-QA confirmation with a link to the DEV PR, deployment/setup notes. **No** AL-object tables. |
| **C — Technical** | production / default branch (`main`) | reviewers, future devs, auditors — the permanent record | Everything in Step 4 below: narrative, grouped changes, related work items, AL objects, build info, spec link, testing, rollout, deployment notes, quality gate; plus UAT sign-off and links to earlier PRs when they exist. |

With the default `feature-release-selective` strategy, a feature PR targets `main` → **Tier C**
(unchanged behaviour). With `environment-promotion`, the **same** feature branch is PR'd into each
environment branch in turn — A, then B, then C (see `bc-ship-release`).

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
Use [`../../PULL_REQUEST_TEMPLATE.md`](../../PULL_REQUEST_TEMPLATE.md) and keep only the sections of
the chosen tier (Tier A/B delete the rest).

- **Title (all tiers):** Conventional Commit form, identical to the commit convention —
  `<type>: #{ID} - <short description matching the brief>` (see
  [`bc-util-commit-message`](../bc-util-commit-message/SKILL.md)), e.g.
  `feat: #2117 - Country-division footer data in a configurable table`. `<type>` is the dominant
  change type. Squash merges turn the PR title into the commit subject, so a conventional title
  keeps `main`'s history and generated changelogs clean. (If `values.commitConvention` is `none`,
  use `ABC-{ID}: <short description>`.)
- **Work-item link:** Azure DevOps Boards uses `AB#123` (GitHub → Azure Boards mention; also add
  the item in the PR's **Work items** field when the PR lives in Azure Repos); GitHub Issues uses
  `#123`. Use `Closes AB#123` / `Closes #123` only on the PR into the **production** branch —
  on Tier A/B PRs write the plain mention so the item isn't closed before PROD.
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
- **Testing:** reference `acceptance-criteria.md` and the test codeunit (Tier B: rewrite the
  criteria as numbered tester scenarios).
- **Rollout / behaviour:** feature switches, staged activation, backward-compatibility notes.
- **Deployment notes:** any manual setup, config, or data migration.

## 5 — Run the quality checklist
Reuse **`bc-review-self`** and report each item ✅/❌. Items needing a build →
"requires build verification".

## 6 — Confirm, then flag blockers
Show the composed title + target + work items + commit count and **ask before creating** the PR.
If anything in Step 5 fails, output a numbered "⚠️ Issues to resolve before opening PR" list with
the exact file/line and the fix, and do **not** declare the PR ready.

## Output
The complete PR title and description, ready to paste, following the repo PR template and trimmed
to the chosen tier (Tier C: Summary, Work Item, Type of Change, Related Work Items, Changes,
Affected AL Objects, Spec, Testing, Rollout, Deployment Notes, AL Quality Gate).

## Next step
- **`feature-release-selective` (default):** after merge, **`bc-ship-release`** (agent:
  `bc-deploy`) includes the feature in a release wave.
- **`environment-promotion`:** after the DEV merge and internal QA on the DEV environment,
  **`bc-ship-release`** opens the next promotion PR of the **same** feature branch (UAT, then
  PROD) and back-merges after the PROD release.

If changes are requested, return to **`bc-build-feature`** (agent: `bc-dev`).
