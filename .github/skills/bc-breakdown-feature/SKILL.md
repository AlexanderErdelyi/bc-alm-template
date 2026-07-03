---
name: bc-breakdown-feature
description: "Breaks a parent Business Central Feature/Epic into child user stories (with story points) plus one estimate-carrying task per story, in Azure DevOps or GitHub. Use when: break a feature into user stories, plan a feature in ADO, decompose an epic, create child stories with story points and hours, feature breakdown, split a feature into estimable work, create sub-issues for an epic."
---

# BC · Break down a Feature (Stories + Estimate carriers)

Split a parent **Feature/Epic** into a coherent set of child **User Stories** (planning units,
carry story points) and give each one an **estimate carrier** that holds the hour estimate. This
keeps the story clean for refinement while estimates live where the board expects them — a child
**Task** in Azure DevOps, or an equivalent field/sub-issue in GitHub.

This is a **PLAN**-phase skill (agent: **`bc-plan`**). It runs *after* the parent exists and
*before* the per-story spec (`bc-spec-author`). For a single story from a raw request, use
[`bc-plan-user-story`](../bc-plan-user-story/SKILL.md) instead.

## When to use

- "Break feature 1858 into user stories with story points and hours."
- "Decompose this epic into refinable stories."
- "Plan this feature — create the child stories with estimates."
- "Create sub-issues for this epic."

---

## Pick the backend first

The initializer wires exactly one work-item system. Detect it and follow the matching path:

- **Azure DevOps** → the `azure-devops/*` tools are configured. Parent = *Feature*, children =
  *User Stories*, estimate carrier = a child *Task*.
- **GitHub Issues** → the `github/*` tools are configured. Parent = an *Issue* (labelled
  `epic`/`feature`), children = **sub-issues**, estimate carrier = a **Project field** (or label).

If both appear configured, ask which one this repo plans in.

---

## Common workflow (both backends)

### Step 1 — Gather context
Ask only for what is missing; infer the rest from the conversation/codebase:

- **Parent ID** (Feature / Epic / parent Issue) — required.
- **Scope hints** — modules, integrations, constraints (e.g. on-prem only, no external service).
- **Include Documentation & E2E test stories?** — default **yes**, added at the end.

If the workspace has a `copilot-instructions.md`, follow its naming/architecture conventions when
proposing technical content. Never invent object IDs — that is `bc-spec`'s job.

### Step 2 — Read the parent
Read the parent's title and description to understand intent, and inherit its area/iteration
(ADO) or milestone/labels (GitHub) by default. **Read the parent's project/repo context from the
item itself — do not hardcode a project name or repo.**

### Step 3 — Propose the breakdown (BEFORE creating anything)
Present a numbered table and **wait for approval / corrections**:

| # | Title | SP | Est (h) | Purpose |
|---|---|---|---|---|
| 1 | Spike / architecture decision | 3 | 16 | de-risk |
| 2 | Setup / configuration | 5 | 24 | foundation |
| … | … | … | … | … |
| n-1 | Documentation | 2 | 8 | enablement |
| n | End-to-end acceptance tests | 3 | 16 | release gate |

Default sizing guidance (Fibonacci story points, hours derived — adjust per team velocity):

| SP | Typical hours |
|----|---------------|
| 1 | 4–6 |
| 2 | 8 |
| 3 | 12–16 |
| 5 | 20–28 |
| 8 | 32–40 |

**Always include unless the user says no:** a **Spike** first if there is technical uncertainty,
a **Documentation** story near the end, and an **End-to-end acceptance tests** story as the final
release gate. Show totals (Σ SP, Σ hours) and the recommended execution order. **Do not create
anything until the user approves.**

Each story description follows this lean template (no auto-generated footer):

```markdown
**As a** <role> **I want** <capability> **so that** <business outcome>.

### Tasks
- <task 1>
- <task 2>

### Acceptance criteria
1. <criterion 1>
2. <criterion 2>
3. <criterion 3>

### Definition of Done
- [ ] Implementation
- [ ] Labels / translations (if user-facing)
- [ ] Build green
- [ ] Code review
```

---

## Azure DevOps path

### A4 — Create the User Stories under the Feature
For each approved story, create it as a child of the Feature (`wit_add_child_work_items` with
`parentId = {featureId}`, `workItemType = "User Story"`, `items = [{ title, description }]`).
Capture each returned id as `{usId[i]}`.

> **Description format:** inspect the parent's `multilineFieldsFormat["System.Description"]`.
> If it is `html`, send HTML (`<h3>`, `<ul>`, `<hr>`) — markdown renders as literal text. If it is
> `markdown`, send the template as-is. The same rule applies when updating `/fields/System.Description`.

### A5 — Set Story Points on each User Story
Story points live **only on the User Story** (keep the US free of hour estimates). One
`wit_update_work_item` per story, `op:"add"`, path
`/fields/Microsoft.VSTS.Scheduling.StoryPoints`. These are independent → **issue them in parallel**.

### A6 — Create one child Task per User Story (the estimate carrier)
`wit_add_child_work_items` with `parentId = {usId[i]}`, `workItemType = "Task"`, a title like
`"Implement: {short US title}"` and a description that points back to the story. Capture `{taskId[i]}`.

### A7 — Set the estimate on each Task
One `wit_update_work_item` per task, `op:"add"`, setting
`/fields/Microsoft.VSTS.Scheduling.OriginalEstimate` **and**
`/fields/Microsoft.VSTS.Scheduling.RemainingWork` (numbers, not strings). Run in parallel.

### A8 — Summary
Report the tree (US id, title, SP, Task id, hours), Σ SP, Σ hours, recommended order, and the
clickable Feature URL.

---

## GitHub path

GitHub issues have no native story-point or estimate fields, so estimates live on a **Project
(Projects v2)** or on labels. Sub-issues provide the parent→child hierarchy.

### G4 — Create the sub-issues under the parent
For each approved story, create an issue (title + body from the template above) and attach it as a
**sub-issue** of the parent via the `github/*` tools (the sub-issues API / `gh`). This yields the
same tree the board shows as "sub-issues" with progress rollup. Capture each `#number`.

### G5 — Record story points & estimate (choose one, be consistent)
- **Preferred — Project fields:** add all issues to the repo/org **Project** and set two custom
  number fields, `Story Points` and `Estimate`, on each item. This is the estimate carrier — no
  separate Task needed; the sub-issue itself is the unit and the Project field holds the hours.
- **Fallback — labels:** apply labels such as `sp: 3` and `estimate: 16h` when no Project is used.

State which mechanism you used so the summary is unambiguous.

### G6 — Keep the parent as the rollup
Ensure the parent issue reflects the sub-issues (GitHub renders a sub-issue progress bar
automatically). Optionally add a task-list in the parent body mirroring the stories for repos not
yet using the sub-issues UI.

### G7 — Summary
Report the tree (parent #, each sub-issue #, title, SP, estimate), Σ SP, Σ hours, recommended
order, and the parent issue URL.

---

## Design principles (why this shape)

- **Story = planning unit** → story points, acceptance criteria, DoD. No hour-estimate noise.
- **Estimate carrier = execution unit** → the hour estimate lives on the ADO Task or the GitHub
  Project field so capacity planning and burndown/rollups work.
- **One carrier per story by default** keeps the breakdown light; the team adds more during sprint
  planning without changing the structure.
- **Spike + Documentation + E2E tests** are first-class stories, not afterthoughts.

## Azure DevOps MCP quirks (verified — encode once)

1. **`op:"remove"` is rejected** (schema requires `value`). To clear a field use `op:"replace"`
   with `value:0` / `value:""`; to set one use `op:"add"` (works for create *and* update).
2. **`wit_add_child_work_items` only accepts `title` + `description`.** You cannot set
   StoryPoints / OriginalEstimate / Priority at creation — always create, then update.
3. **Prefer per-item `wit_update_work_item` in parallel** over `wit_update_work_items_batch`
   (batch schema is fragile across MCP versions).
4. **Don't hardcode the project name** — read `System.TeamProject` from the parent.
5. **Fully-qualified field paths** — `/fields/Microsoft.VSTS.Scheduling.OriginalEstimate`,
   `…RemainingWork`, `…StoryPoints`, `/fields/Microsoft.VSTS.Common.Priority`.
6. **Hours are numbers** (`16`, not `"16"`).
7. **Link work items with `wit_work_items_link`, not JSON-Patch on `/relations/-`**; link `type`
   must be lowercase (`successor`, `predecessor`, `parent`, `child`, `related`, …).
8. **Description field format** is per-project — match `html` vs `markdown` (see A4).

## Anti-patterns (do not do)

- ❌ Putting the hour estimate directly on the User Story (ADO) instead of its Task/field.
- ❌ Hardcoding a project name or repo instead of reading it from the parent.
- ❌ `op:"remove"` on any ADO field via MCP.
- ❌ Sequential update calls when they could be parallel.
- ❌ Creating work items before the user approved the Step 3 table.
- ❌ Mixing SP/estimate mechanisms on GitHub (Project fields *and* labels) in one breakdown.
- ❌ Adding a generic "auto-generated by Copilot" footer to descriptions.

## Example triggers

- "Break feature 1858 into user stories with story points and hours."
- "Decompose epic #2042 into refinable stories, each with an estimate."
- "Create the child stories for the payment-import feature, including docs and E2E tests."
- "Plan this GitHub epic — create sub-issues with estimates."

## Next step

Hand each story to **`bc-spec-author`** (agent: `bc-spec`) to produce its
`specs/<Area>/<type>-<ID>-<slug>/` folder, then to **`bc-build-feature`** (agent: `bc-dev`).
