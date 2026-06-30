# Spec-Driven Development

Spec-driven development means that every feature or bug fix begins with a written specification — created, reviewed, and merged before a single line of AL code is written. The spec lives in the repository alongside the code it describes.

---

## Why Specs in the Repo?

Traditional approaches keep specs in Azure DevOps descriptions, SharePoint, or email threads. The problems:

| Problem | Impact |
|---|---|
| Specs and code diverge silently | No way to know if the final implementation matches what was agreed |
| Agents can't access external tools reliably | Copilot agents can always read files in the repo |
| Documentation is written from memory | Functional docs should reflect what was actually built, not what was intended |
| No version history of requirements | Can't trace when acceptance criteria changed and why |
| Junior developers lack context | The spec folder is a self-contained briefing for any developer picking up the work |

When specs are in the repository:
- They are version-controlled alongside the code
- Every change to requirements is tracked via git history
- GitHub Copilot agents read them directly without needing external integrations
- The spec becomes the source of truth for PR descriptions, documentation, and customer sign-off
- New team members can understand a feature by reading its spec folder

---

## Spec Folder Structure

Every ADO work item gets its own folder under `specs/`:

```
specs/
├── _TEMPLATE/                          ← Copy this to start a new spec
│   ├── README.md
│   ├── brief.md
│   ├── plan.md
│   ├── acceptance-criteria.md
│   └── change-log.md
│
├── ABC-123-payment-tolerance/          ← One folder per ticket
│   ├── brief.md
│   ├── plan.md
│   ├── acceptance-criteria.md
│   └── change-log.md
│
└── ABC-124-vat-report-fix/
    ├── brief.md
    ├── plan.md
    ├── acceptance-criteria.md
    └── change-log.md
```

**Naming convention:** `specs/ABC-{ID}-short-description/`
- Use the ADO ticket ID prefix
- Short description in kebab-case (3-5 words)
- No version numbers in folder name — the `change-log.md` tracks versions

---

## The 4 Spec Documents

### 1. `brief.md` — Customer Request

Written first. Plain language. No technical jargon. Answers:
- What does the customer want?
- Why do they want it (business value)?
- Who requested it and when?
- What is out of scope?
- What open questions need answering before development starts?

**Audience:** Customer, PM, Business Analyst  
**Written by:** PM agent or functional consultant  
**Reviewed by:** Customer or customer proxy

---

### 2. `plan.md` — Technical Approach

Written after `brief.md` is approved. Technical detail. Answers:
- Which AL objects are affected (object type, ID, name, action)?
- What new objects need to be created?
- What existing objects need to be modified?
- How will it be implemented technically?
- What are the risks and dependencies?
- Which BC version must it be compatible with?
- Are there performance considerations?

**Audience:** Developer, Senior Developer, Architect  
**Written by:** Developer or PM agent (with developer review)  
**Reviewed by:** Senior Developer / Architect before development starts

---

### 3. `acceptance-criteria.md` — What Done Looks Like

Written after `plan.md`. Testable criteria. Answers:
- What specific behaviours must the implementation exhibit?
- Are there edge cases that must be handled?
- What error scenarios must produce specific responses?
- How will the feature be tested?
- Who signs off?

**Format:** Given/When/Then (BDD-style)

```markdown
### AC-01: Basic Tolerance Calculation
**Given** a customer payment with a payment tolerance percentage of 1% set  
**When** the customer pays an amount within 1% of the invoice total  
**Then** the remaining balance is automatically written off as payment tolerance  
**And** a payment tolerance entry is created in the ledger
```

**Audience:** Customer, Functional Consultant, Developer, Test  
**Written by:** PM agent or functional consultant  
**Reviewed by:** Customer — this is the contract

---

### 4. `change-log.md` — Spec Version History

Tracks every change to the spec after the initial approval. Answers:
- What changed?
- Who requested the change?
- When was it approved?
- Why was it changed?

Every spec starts at `v1.0`. Changes requested during testing increment the version. The `change-log.md` ensures full traceability when the final implementation differs from the original spec.

---

## Spec Lifecycle

```
1. BC Spec agent creates spec files in specs/ABC-{ID}/ (after BC Plan shapes the user story)
         │
         ▼
2. Spec PR opened (separate from code PR)
         │
         ▼
3. Brief reviewed and approved by customer proxy
         │
         ▼
4. Plan reviewed and approved by senior developer/architect
         │
         ▼
5. Acceptance criteria reviewed and agreed with customer
         │
         ▼
6. Spec PR merged → development is unblocked (Stage 4 in workflow)
         │
         ▼
7. Developer works from spec (BC Dev agent reads plan.md)
         │
         ▼
8. Customer tests against acceptance-criteria.md
         │
         ▼
9. If changes requested → change-log.md updated, spec re-versioned
         │
         ▼
10. BC Doc agent reads all 4 files to generate functional documentation
         │
         ▼
11. Feature deployed to PROD → spec folder archived in main
```

---

## How Agents Use Specs

Each agent knows where to find spec documents by convention:

| Agent | What it reads | Why |
|---|---|---|
| **BC PM** | ADO ticket / backlog | Triages, prioritizes, and grooms work items |
| **BC Plan** | Triaged ticket | Shapes the user story + acceptance criteria |
| **BC Spec** | User story + ticket | Authors all 4 spec documents |
| **BC Developer** | `plan.md` + `acceptance-criteria.md` | Understands what to build and what done looks like |
| **BC PR** | `brief.md` + `plan.md` | Generates PR description and checks implementation against spec |
| **BC Deploy** | `change-log.md` + `plan.md` | Verifies spec is approved before including in release |
| **BC Doc** | All 4 documents + git diff | Generates customer documentation and changelog |
| **BC Orchestrator** | Checks if `specs/ABC-{ID}/` exists | Determines current workflow stage |

Agents reference the spec folder by ticket ID. When you tell `bc-dev` to "work on ABC-123", it automatically looks for `specs/ABC-123-*/` using glob matching.

---

## Approval Gates

| Gate | Who approves | What they check |
|---|---|---|
| Spec PR merge | Senior Developer + Customer proxy | Brief accurate, plan feasible, criteria testable |
| Code PR merge | Senior Developer | Implementation matches plan, quality standards met |
| Customer testing | Customer | Acceptance criteria satisfied |
| Documentation PR | Senior Developer | Docs accurate, changelog complete |
| PROD deployment | Release Manager | All gates passed, deployment window agreed |

Skipping approval gates is allowed only for P1 hotfixes, and only the code PR gate can be relaxed (spec and docs still required, done retrospectively if needed).

---

## Getting Started with Spec-Driven Development

1. Copy the template:
   ```bash
   cp -r specs/_TEMPLATE specs/ABC-123-your-feature-name
   ```

2. Fill in `brief.md` first — even before involving a developer

3. Open a spec PR before starting development

4. Use the **BC Spec agent** to help fill in the spec from an ADO ticket:
   > "Create a spec for ABC-123" — the agent will draft all 4 documents

5. Reference the spec folder in your feature PR:
   > "This PR implements `specs/ABC-123-payment-tolerance/`"
