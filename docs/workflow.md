# BC Development Lifecycle — Full Workflow

This document describes all stages of the Business Central ALM workflow, from receiving an ADO ticket to deploying to PROD. Each stage has a defined owner, inputs, outputs, and — where applicable — a GitHub Copilot agent to assist.

---

## Overview

```
Stage 1:  ADO Ticket Received
Stage 2:  Spec Drafting (BC PM Agent)
Stage 3:  Spec Review & Approval
Stage 4:  Feature Branch Created
Stage 5:  AL Implementation (BC Developer Agent)
Stage 6:  Pull Request (BC PR Agent)
Stage 7:  Code Review & Merge
Stage 8:  Release Branch Composition (BC Deploy Agent)
Stage 9:  TEST Deployment
Stage 10: Customer Testing
Stage 11: Documentation (BC Doc Agent)
Stage 12: PROD Deployment (BC Deploy Agent)
```

---

## Stage 1 — ADO Ticket Received

**Owner:** Project Manager / Functional Consultant  
**Input:** Customer request, bug report, or change request in Azure DevOps  
**Output:** ADO work item with title, description, and priority  
**Agent:** None at this stage

The process starts with a ticket in Azure DevOps. The ticket should include:
- What the customer wants or what the bug is
- Which BC environment or module is affected
- Business priority (P1 critical / P2 standard / P3 backlog)

If the ADO MCP server is configured in `.vscode/mcp.json`, the PM agent can read tickets directly.

---

## Stage 2 — Spec Drafting

**Owner:** Developer / Functional Consultant with BC PM Agent  
**Input:** ADO ticket ID  
**Output:** `specs/ABC-{ID}/` folder with 4 documents  
**Agent:** [BC PM](.github/agents/bc-pm.agent.md)

Use the **BC PM agent** and provide the ticket ID (e.g. `ABC-123`). The agent will:

1. Read the ADO ticket (via MCP) or ask you to paste the ticket content
2. Create `specs/ABC-{ID}-short-description/` folder
3. Draft `brief.md` — plain language customer requirement
4. Draft `plan.md` — technical approach with affected AL objects
5. Draft `acceptance-criteria.md` — testable Given/When/Then criteria
6. Create `change-log.md` — v1.0 initial entry
7. Flag any missing information (object IDs, BC version, permissions scope)
8. Open a spec PR

**Do not start AL development until the spec PR is merged.**

---

## Stage 3 — Spec Review & Approval

**Owner:** Senior Developer / Architect  
**Input:** Spec PR  
**Output:** Merged spec, green light for development  
**Agent:** None (human review)

The spec PR is reviewed for:
- Technical feasibility
- Correct object planning (extension tables vs. base modifications)
- Completeness of acceptance criteria
- Scope alignment with ADO ticket

The spec is the contract between PM, developer, and customer. Changes to scope after approval go through the change-log and increment the spec version.

---

## Stage 4 — Feature Branch Created

**Owner:** Developer  
**Input:** Merged spec  
**Output:** `feature/ABC-{ID}-short-description` branch  
**Agent:** [BC Workflow](.github/agents/bc-workflow.agent.md) or [BC Developer](.github/agents/bc-dev.agent.md)

Branch naming convention:

```bash
git checkout -b feature/ABC-123-payment-tolerance
```

See [branching-strategy.md](branching-strategy.md) for full naming conventions.

---

## Stage 5 — AL Implementation

**Owner:** Developer with BC Developer Agent  
**Input:** Spec documents, feature branch  
**Output:** AL objects committed to feature branch, tests written  
**Agent:** [BC Developer](.github/agents/bc-dev.agent.md)

Use the **BC Developer agent** and tell it the spec folder (e.g. `work on specs/ABC-123-payment-tolerance/`). The agent will:

1. Read `plan.md` to understand which AL objects to create or modify
2. Read `acceptance-criteria.md` to understand what the implementation must satisfy
3. Guide creation of AL objects following coding standards:
   - Tables with extension tables for new fields
   - Pages and page extensions
   - Codeunits with single responsibility
   - Reports and queries as needed
   - Enums and interfaces
4. Ensure no hardcoded values — Labels and setup tables
5. Verify `app.json` version is bumped (minor for feature, build for fix)
6. Generate test codeunit stubs using GIVEN/WHEN/THEN structure
7. Check permission sets cover all new objects

**Always-on:** AL coding standards from `.github/instructions/al-coding-standards.instructions.md` apply to every `.al` file automatically.

---

## Stage 6 — Pull Request

**Owner:** Developer with BC PR Agent  
**Input:** Feature branch with committed AL objects  
**Output:** Open PR with description, checklist verified, ADO linked  
**Agent:** [BC PR](.github/agents/bc-pr.agent.md)

Use the **BC PR agent** to prepare the PR. The agent will:

1. Read the spec documents to generate the PR description
2. Summarize commits into a human-readable change list
3. Fill in the `.github/PULL_REQUEST_TEMPLATE.md` checklist
4. Verify:
   - Code compiles (no syntax errors visible in files)
   - AL Analyzer rules followed (no hardcoded values, naming conventions)
   - `app.json` version is bumped
   - Permission sets updated
   - Test codeunit exists for new logic
   - Spec folder is referenced in the PR
5. Ensure ADO work item is linked in the PR

The PR description becomes the basis for `bc-doc` output later, so quality here saves work at documentation stage.

---

## Stage 7 — Code Review & Merge

**Owner:** Senior Developer / Architect  
**Input:** Open PR  
**Output:** Merged to `main`  
**Agent:** None (human review)

Reviewers check:
- AL object quality and adherence to coding standards
- Test coverage (test codeunit present and meaningful)
- No accidental base table modifications
- `app.json` version bump is correct
- No secrets or environment-specific values hardcoded

After merge, the feature branch is kept alive until after PROD deployment (it's the deployment artifact reference).

---

## Stage 8 — Release Branch Composition

**Owner:** Release Manager / Senior Developer with BC Deploy Agent  
**Input:** Set of merged feature branches to include in this release  
**Output:** `release/YYYY-MM-wave-N` branch  
**Agent:** [BC Deploy](.github/agents/bc-deploy.agent.md)

The **BC Deploy agent** helps compose the release branch:

1. Lists all merged PRs since the last release
2. Asks which tickets to include in this wave
3. Verifies each selected ticket has:
   - Merged spec PR
   - Merged code PR
   - No outstanding blockers in ADO
4. Provides `git` commands to compose the release branch from selected merges
5. Creates `release/2025-06-wave-1` branch

**Key principle:** A release branch is a composition of selected features — not a dump of everything on `main`. This enables selective deployment: only approved, tested features go to TEST.

See [branching-strategy.md](branching-strategy.md) for the full composition model.

---

## Stage 9 — TEST Deployment

**Owner:** Release Manager  
**Input:** `release/YYYY-MM-wave-N` branch  
**Output:** Extension deployed to TEST environment  
**Agent:** [BC Deploy](.github/agents/bc-deploy.agent.md) (guidance)

Deployment to TEST is typically handled by AL-Go for GitHub pipelines or the BC Admin Center API. The BC Deploy agent can:
- Explain the BC Admin Center API deployment process
- Provide the correct app version to upload
- Update ADO ticket statuses to "In Test"

---

## Stage 10 — Customer Testing

**Owner:** Customer / Functional Consultant  
**Input:** Feature deployed to TEST  
**Output:** Customer sign-off or feedback  
**Agent:** None (human process)

The acceptance criteria from `specs/ABC-{ID}/acceptance-criteria.md` are the test script. The customer (or functional consultant on their behalf) verifies each Given/When/Then criterion.

Outcomes:
- **Approved:** Move to Stage 11 (documentation)
- **Changes required:** Log feedback in `change-log.md`, update spec, return to Stage 5

---

## Stage 11 — Documentation

**Owner:** Developer / Technical Writer with BC Doc Agent  
**Input:** All 4 spec files + final AL diff  
**Output:** `docs/functional/ABC-{ID}-title.md` + updated `docs/changelog.md`  
**Agent:** [BC Doc](.github/agents/bc-doc.agent.md)

The **BC Doc agent** is the gate before PROD. It reads:
- `specs/ABC-{ID}/brief.md` — what was requested
- `specs/ABC-{ID}/plan.md` — what was planned
- `specs/ABC-{ID}/acceptance-criteria.md` — what was accepted
- `specs/ABC-{ID}/change-log.md` — what changed during development
- Git diff of the feature branch — what was actually implemented

It then generates:
1. `docs/functional/ABC-{ID}-title.md` — customer-facing functional documentation
2. Updated entry in `docs/changelog.md`
3. Warns if the implementation diverged from the spec (triggers a spec update)

The documentation output is a PR that **must be approved before PROD deployment**.

---

## Stage 12 — PROD Deployment

**Owner:** Release Manager  
**Input:** Approved documentation PR, release branch  
**Output:** Extension deployed to PROD, ADO ticket closed  
**Agent:** [BC Deploy](.github/agents/bc-deploy.agent.md)

Final deployment to PROD via BC Admin Center API. After successful deployment:

- Feature branch is merged into `main` (if not already via the PR)
- ADO ticket is closed
- Release branch is tagged: `v2025-06-wave-1`
- Customer is notified

---

## Stage Summary Table

| Stage | Name | Owner | Agent |
|---|---|---|---|
| 1 | ADO Ticket Received | PM | — |
| 2 | Spec Drafting | PM + Dev | BC PM |
| 3 | Spec Review | Senior Dev | — (human) |
| 4 | Feature Branch | Dev | BC Workflow |
| 5 | AL Implementation | Dev | BC Developer |
| 6 | Pull Request | Dev | BC PR |
| 7 | Code Review | Senior Dev | — (human) |
| 8 | Release Composition | Release Mgr | BC Deploy |
| 9 | TEST Deployment | Release Mgr | BC Deploy |
| 10 | Customer Testing | Customer | — (human) |
| 11 | Documentation | Dev / TW | BC Doc |
| 12 | PROD Deployment | Release Mgr | BC Deploy |
