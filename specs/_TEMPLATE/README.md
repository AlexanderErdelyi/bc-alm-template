# Spec Template

Use this folder as the starting point for every new BC development ticket.

## How to Use

### 1. Copy this folder

```bash
cp -r specs/_TEMPLATE specs/ABC-123-your-feature-name
```

Replace `ABC-123-your-feature-name` with:
- Your ADO ticket ID (e.g. `ABC-123`)
- A short kebab-case description (3-5 words)

Example: `specs/ABC-123-payment-tolerance`

### 2. Fill in the documents in order

| Order | File | Who writes it | Who reviews it |
|---|---|---|---|
| 1st | `brief.md` | PM / Functional Consultant | Customer proxy |
| 2nd | `plan.md` | Developer | Senior Dev / Architect |
| 3rd | `acceptance-criteria.md` | PM / Functional Consultant | Customer |
| Always | `change-log.md` | Everyone | — |

### 3. Open a spec PR before starting development

The spec must be reviewed and merged **before** a feature branch is created and development starts. This ensures:
- The developer builds the right thing
- The customer has agreed on what "done" looks like
- The PR description and documentation can be generated from the spec

### 4. Reference the spec in your feature PR

When you open your code PR, reference the spec folder:
```
📄 Spec: specs/ABC-123-payment-tolerance/
```

### 5. Agents read these files by convention

| Agent | What it reads |
|---|---|
| BC Plan | Drafts `brief.md`, `acceptance-criteria.md` (user story) |
| BC Spec | Creates/completes all 4 files |
| BC Developer | `plan.md`, `acceptance-criteria.md` |
| BC PR | `brief.md`, `plan.md` |
| BC Doc | All 4 files |
| BC Orchestrator | Checks folder exists |

---

## File Descriptions

- **`brief.md`** — The customer request in plain language. Non-technical. Answers: what, why, who, when. This is what the customer agreed to.

- **`plan.md`** — The technical approach. Lists every AL object to be created or modified. This is what the developer will implement.

- **`acceptance-criteria.md`** — Testable Given/When/Then criteria. This is what "done" looks like. The customer tests against this.

- **`change-log.md`** — Version history of the spec. Every change after v1.0 must be logged here with the reason.
