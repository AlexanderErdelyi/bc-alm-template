---
name: bc-triage-backlog
description: "Intake, triage, prioritize, and groom Business Central work items in Azure DevOps or GitHub Issues so the backlog is clean and the next item is ready to plan. Use when: triage a ticket, groom the backlog, prioritize work, label or categorize an issue, check for duplicates, intake a new request, manage work items, prepare the backlog for planning."
---

# BC · Triage & Backlog

Take a raw incoming request and make it actionable: understood, deduplicated, classified,
prioritized, and parked in the right place. This is the **TRIAGE** phase — it runs *before*
`bc-plan-user-story` and is the core procedure of the **`bc-pm`** agent.

## When to use

- A new request, bug report, or idea arrives and needs to become a tracked work item.
- The backlog is messy: duplicates, stale items, no priority, missing context.
- You need to decide *what to work on next* and get it ready to plan.

## Work-item system

This template tracks work in **Azure DevOps** or **GitHub Issues** (chosen during `bc-init`,
recorded as `workItemSystem` in `template.config.json`).

- **ADO:** use the configured ADO MCP server. Reference items as `AB#123`. Set Area/Iteration paths.
- **GitHub:** use `gh` / GitHub tools and the forms in `.github/ISSUE_TEMPLATE/`. Reference as `#123`.
- **Neither configured:** manage a simple Markdown backlog in the repo until a tracker is connected.

## Procedure

1. **Capture / read.** Restate the request in one sentence; confirm intent with the requester.
2. **Deduplicate.** Search open items for the same need. If found, link and close the duplicate
   instead of creating a new item — record which item is the source of truth.
3. **Classify.** Type = bug / feature / chore. For bugs, capture repro steps, expected vs actual,
   and severity.
4. **Prioritize.** Set a priority (e.g. P1 Critical / P2 Standard / P3 Backlog) and say *why*.
5. **Label & place.** Apply labels/area path, set the milestone/iteration, and order it in the
   backlog relative to other work.
6. **Gap-check.** List missing context explicitly (customer, target release, acceptance hints).
   Do not invent answers — block the item if it can't proceed.
7. **Mark ready.** When a high-priority item is clear enough, flag it **ready to plan** and hand
   off to `bc-plan-user-story` (agent: `bc-plan`).

## Quality bar

- Every triaged item has: type, priority (with reason), labels/area, and a single source of truth.
- No silent acceptance criteria or technical design — that belongs to `bc-plan` and `bc-spec`.
- Duplicates are linked, not copied.

## Hand-off

When the top of the backlog is triaged and ready, move to **`bc-plan-user-story`** (agent:
`bc-plan`) to shape the user story.
