<!--
  Title convention (Conventional Commits — same as commit messages, because a squash merge turns
  the PR title into the commit subject):
    <type>: #<workItemId> - <short description>
  e.g.  feat: #2117 - Country-division footer data in a configurable table
  Types: feat | fix | refactor | perf | chore | docs | test | build | ci | style
  See .github/skills/bc-util-commit-message/SKILL.md

  Description depth depends on the target branch (see .github/skills/bc-ship-pull-request/SKILL.md):
    Tier A  integration/DEV branch  — Summary + work item only; delete the other sections.
    Tier B  UAT/TEST branch         — Summary, What to test, Deployment notes (functional, for testers).
    Tier C  production branch       — every section below (technical, permanent record).
-->

## Summary

<!-- 1–3 sentences: what this PR does and why. -->

## Work Item

<!-- AB#<id> links Azure DevOps Boards (also add it in the PR's "Work items" field); #<id> links GitHub Issues. -->

Closes AB#<!-- ticket ID -->

## Type of Change

- [ ] `feat` — new functionality
- [ ] `fix` — bug fix
- [ ] Hotfix — critical production fix
- [ ] `refactor` / `perf` — no functional change / performance
- [ ] `docs` / `test` / `chore` / `build` / `ci` — non-functional

## Related Work Items

| ID | Type | Title | State |
|---|---|---|---|
| AB#<!-- id --> | User Story | | |

## Changes

<!-- Grouped by conventional-commit type (Features / Bug Fixes / Refactoring / ...). Keep it scannable. -->

## Affected AL Objects

<!-- List all AL objects created or modified in this PR. -->

| Object Type | Object ID | Object Name | Change Summary |
|---|---|---|---|
| | | | |

## Spec

📄 Spec: `specs/<!-- <Area>/<type>-<ID>-<slug> -->/`

## Testing / What to Test

<!-- Reference the acceptance criteria and test codeunit. For a UAT/TEST PR, list the scenarios a
tester should run, written for a non-developer. -->

Tested against: `specs/<!-- <Area>/<type>-<ID>-<slug> -->/acceptance-criteria.md`

Test codeunit: <!-- Codeunit XXXXX "Your Feature Test" -->

## Rollout / Behaviour

<!-- Feature switches, staged activation, backward-compatibility or upgrade notes. Leave blank if none. -->

## Deployment Notes

<!-- Document any steps required after deployment:
- Setup records to create
- Configuration changes
- Data migration scripts
- Permission set assignments
- Any manual steps for the release manager
Leave blank if no post-deployment steps are needed. -->

## Screenshots

<!-- Add screenshots for any UI changes (new pages, page extensions, modified layouts).
Leave blank if there are no UI changes. -->

## AL Quality Gate

<!-- Complete this checklist before requesting review. -->

- [ ] Code compiles without errors (`al_build`) — no new warnings
- [ ] AL Analyzer passes (no warnings for committed files)
- [ ] `app.json` version bumped (feature → minor, fix → build) — or left to the pipeline when versioning is pipeline-managed
- [ ] `ABC` prefix; object IDs within `50100–50199`
- [ ] No hardcoded text — all user-visible strings are Label variables; translations (XLIFF) synced
- [ ] No hardcoded IDs — enums, setup tables, or named constants used
- [ ] No base table modifications — extension tables used for new fields
- [ ] Permission sets updated for all new or modified objects
- [ ] Test codeunit added for new business logic
- [ ] Spec folder referenced in this PR description
- [ ] Work item linked (`AB#ID` format above)
- [ ] Deployment notes completed (or confirmed not needed)
