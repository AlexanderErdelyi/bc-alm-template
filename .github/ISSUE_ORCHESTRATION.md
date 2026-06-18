# Issue Orchestration — Operation Guide

This document describes the automated issue-to-implementation pipeline in this repository.

---

## Overview

When a GitHub Issue is opened, three GitHub Actions workflows collaborate to guide it from raw idea through triage, planning, manual approval, and into an implementation-ready pull request.

```
Issue opened / edited / label removed / reopened
     │
     ▼
┌─────────────────┐
│  Intake/Triage  │  ← issue-orchestrator.yml
│  stage:intake   │     triggers: opened, edited, unlabeled, reopened
└────────┬────────┘
         │  quality OK?
    ┌────┴────┐
    │ YES     │ NO → adds needs-info label + comment
    ▼         │      (author edits title/body OR removes needs-info
┌─────────────────┐   → triage re-runs automatically)
│    Planning     │  ← issue-planning.yml
│ stage:planning  │
└────────┬────────┘
         ▼
┌─────────────────────────┐
│  Awaiting Approval      │
│ stage:awaiting-approval │  ← Human review of plan comment
└────────┬────────────────┘
         │  Maintainer applies stage:approved label
         ▼
┌─────────────────┐
│ Implementation  │  ← issue-implementation.yml
│stage:implementa-│
│      tion       │
└─────────────────┘
         │
         ▼
  Draft PR opened
  Spec folder created
  Feature branch ready
```

---

## Labels

| Label | Colour | Meaning |
|---|---|---|
| `stage:intake` | Blue | Issue has been received and is being triaged |
| `stage:planning` | Yellow | Issue passed triage; plan generation in progress |
| `stage:awaiting-approval` | Orange | Draft plan posted; waiting for maintainer approval |
| `stage:approved` | Green | Plan approved; implementation triggered |
| `stage:implementation` | Purple | Feature branch and draft PR created |
| `needs-info` | Red | More information required before triage can pass |

All labels are created automatically on first workflow run — no manual setup required.

---

## Workflow Files

| File | Trigger | Purpose |
|---|---|---|
| `.github/workflows/issue-orchestrator.yml` | `issues: opened, edited, unlabeled, reopened` | Intake, quality check, label transitions |
| `.github/workflows/issue-planning.yml` | `issues: labeled` (`stage:planning`) | Generate draft plan comment |
| `.github/workflows/issue-implementation.yml` | `issues: labeled` (`stage:approved`) | Create branch, spec folder, draft PR |

---

## Manual Approval Process

After the planning workflow posts a plan comment on the issue, a maintainer must review it before implementation begins.

### To approve

1. Read the plan comment on the issue carefully.
2. Optionally edit the plan comment to refine it.
3. Apply the **`stage:approved`** label to the issue.

This immediately triggers the implementation workflow.

### To reject / request changes

1. Leave a comment explaining what needs to change.
2. The issue stays in `stage:awaiting-approval` until a maintainer applies `stage:approved`.

---

## Handling `needs-info`

If triage fails quality checks, the issue receives the `needs-info` label and a comment explaining what is missing.

**Triage re-runs automatically when:**

- The issue title or body is **edited** — no manual action needed.
- The **`needs-info`** label is removed — triage fires immediately on label removal.
- A `stage:` label is removed — triage re-evaluates and reapplies the correct stage.
- The issue is **reopened**.

**What happens on re-evaluation:**

- If the issue now meets quality standards: `needs-info` is removed, `stage:planning` is applied, and a ✅ comment is posted.
- If the issue still has gaps: `needs-info` remains (or is re-applied if missing) and a brief re-check comment is posted only if the failure state changed.
- Issues already at `stage:implementation` are never reset by a re-trigger.

> **No manual `stage:planning` label is required** — simply update the issue or remove `needs-info` and the pipeline continues automatically.

---

## What the Implementation Stage Creates

When `stage:approved` is applied, the workflow:

1. Creates a feature branch: `feature/<issue-number>-<slug>`
2. Scaffolds a spec folder: `specs/<issue-number>-<slug>/`
   - `brief.md` — background and problem statement (pre-filled from issue)
   - `plan.md` — AL object list and implementation checklist stub
   - `acceptance-criteria.md` — GIVEN/WHEN/THEN stub
   - `change-log.md` — initial entry
3. Opens a **draft PR** linked to the issue

A developer (or the **bc-dev** Copilot agent) should then check out the branch, complete the spec documents, and implement the AL objects.

---

## Copilot Agent Integration

This pipeline is designed to work alongside the existing Copilot agents in this repo:

| Stage | Relevant Agent |
|---|---|
| Planning review / refinement | `bc-pm` — reads brief, produces spec documents |
| Implementation | `bc-dev` — reads spec, implements AL objects |
| PR preparation | `bc-pr` — generates PR description, runs quality checklist |
| Documentation | `bc-doc` — generates customer-facing docs from spec |
| Orchestration | `bc-workflow` — routes to the right agent at each stage |

Once the implementation branch is created, hand off to `bc-workflow` with the issue/ticket ID.

---

## Permissions Required

The workflows use the built-in `GITHUB_TOKEN` with the following permissions:

| Permission | Used By |
|---|---|
| `issues: write` | Add labels, post comments |
| `contents: write` | Create branch, commit spec files |
| `pull-requests: write` | Open draft PR |

No additional secrets or tokens are required.

---

## Extending the Pipeline

- **Add a triage checklist**: Edit the quality checks in `issue-orchestrator.yml` (the `Triage issue quality` step).
- **Customise the plan template**: Edit the `Generate and publish plan` step in `issue-planning.yml`.
- **Add CI checks**: Add steps to `issue-implementation.yml` after branch creation (e.g., run AL linting, check `app.json` version).
- **Restrict which issues trigger automation**: Add a label filter at the top of `issue-orchestrator.yml` (e.g., only run when `agent:auto` label is present).
