# BC ALM Template

> **A complete, opinionated Application Lifecycle Management template for Microsoft Dynamics 365 Business Central AL development teams.**

Combines spec-driven development, GitHub Copilot custom agents for every workflow stage, a documented branching strategy, and AL coding standards — all version-controlled in one place and ready to fork.

---

## What This Template Gives You

| Component | What it does |
|---|---|
| **6 Copilot agents** | One agent per workflow stage — PM, Dev, PR, Deploy, Doc, and an orchestrator |
| **Spec-driven development** | Structured spec folder per ticket: brief → plan → acceptance criteria → change log |
| **Branching strategy** | Documented model: `feature/*` from `main`, `release/*` composed selectively |
| **AL coding standards** | Always-on Copilot instructions applied to every `.al` file |
| **PR template** | BC-specific checklist: ADO link, affected objects table, quality gates |
| **Workflow documentation** | Every stage from ADO ticket to PROD deployment documented |

---

## The Full BC Development Workflow

```
ADO Ticket
    │
    ▼
[BC PM Agent] ──────► Spec Created (brief + plan + acceptance-criteria)
    │                  specs/ABC-{ID}/
    ▼
Spec PR Reviewed & Merged
    │
    ▼
[BC Dev Agent] ──────► Feature Branch: feature/ABC-{ID}-short-description
    │                  AL objects implemented, tests written
    ▼
[BC PR Agent] ───────► Pull Request opened
    │                  Description from spec + commits, checklist verified
    ▼
PR Reviewed & Merged to main
    │
    ▼
[BC Deploy Agent] ───► Release Branch: release/YYYY-MM-wave-N
    │                  Composed from selected feature merges
    ▼
Deployed to TEST environment
    │
    ▼
Customer Testing
    │
    ▼
Customer Approves
    │
    ▼
[BC Doc Agent] ──────► docs/functional/ABC-{ID}-title.md created
    │                  docs/changelog.md updated
    ▼
Documentation PR Reviewed & Merged
    │
    ▼
[BC Deploy Agent] ───► PROD Deployment via BC Admin Center API
    │
    ▼
ADO Ticket Closed ✅
```

---

## The 6 Copilot Agents

| Agent | Model | What it does |
|---|---|---|
| **bc-workflow** | claude-sonnet-4-5 | **Orchestrator.** Give it a ticket ID — it detects your current workflow stage and routes you to the right agent. Start here. |
| **bc-pm** | claude-sonnet-4-5 | **Project Manager.** Drafts technical specifications from ADO tickets. Creates the 4 spec documents in the correct folder structure. |
| **bc-dev** | claude-sonnet-4-5 | **Developer.** AL implementation specialist. Reads your spec, guides object creation, enforces coding standards, generates test stubs. |
| **bc-pr** | gpt-4o | **Pull Request.** Generates PR description from spec and commits. Runs the AL quality checklist. Ensures ADO work item is linked. |
| **bc-deploy** | gpt-4o | **Deploy.** Manages release branches. Composes `release/wave-N` from selected feature branches. Guides TEST and PROD deployment. |
| **bc-doc** | claude-sonnet-4-5 | **Documentation.** Reads specs and code changes. Generates customer-facing functional docs and changelog. Required gate before PROD. |

All agents live in [`.github/agents/`](.github/agents/).

---

## Spec-Driven Development

Every ticket gets its own spec folder before a single line of AL is written:

```
specs/
└── ABC-123-payment-tolerance/
    ├── brief.md              ← Customer request in plain language
    ├── plan.md               ← Technical approach, affected AL objects
    ├── acceptance-criteria.md ← Given/When/Then criteria, edge cases
    └── change-log.md         ← Version history of the spec
```

**Why in the repo?**
- Specs are version-controlled alongside the code they describe
- Agents read spec files by convention — `bc-dev` reads your plan, `bc-doc` reads your acceptance criteria
- Specs become the source of truth for PR descriptions, functional docs, and customer sign-off
- Easy to review: spec PR is separate from code PR

Start from the template: [`specs/_TEMPLATE/`](specs/_TEMPLATE/)

See the full explanation: [docs/spec-driven-development.md](docs/spec-driven-development.md)

---

## Branching Strategy (Summary)

```
main  ◄──────────────────────── PROD environment (protected)
  │
  ├── feature/ABC-123-payment-tolerance   ◄── DEV (one per ticket)
  ├── feature/ABC-124-vat-report-fix      ◄── DEV
  │
  └── release/2025-06-wave-1              ◄── TEST (composed selectively)
        = merge of ABC-123 + ABC-124
```

**Key decisions:**
- Feature branches are cut from `main` (not from a `develop` branch)
- Release branches are composed by cherry-picking or merging specific feature branches — not all of them
- This solves the "selective deployment" problem: you can ship ABC-123 without shipping ABC-124 if it isn't ready
- `main` is always production-ready and protected

Full documentation: [docs/branching-strategy.md](docs/branching-strategy.md)

---

## Getting Started

### 1. Fork or use as template

Click **"Use this template"** (top right) to create your own repo. Do not clone directly — the template structure is what you're copying.

### 2. Copy the spec template for your first ticket

```bash
cp -r specs/_TEMPLATE specs/ABC-123-your-feature-name
```

Fill in `brief.md` first, then open a spec PR before writing any AL code.

### 3. Configure ADO MCP (optional but recommended)

Edit [`.vscode/mcp.json`](.vscode/mcp.json) with your Azure DevOps organization and project. This lets the `bc-pm` and `bc-workflow` agents read your ADO tickets directly.

### 4. Use the agents

Open GitHub Copilot Chat in VS Code or GitHub.com and select an agent from the dropdown:

- **Not sure where to start?** → `BC Workflow` — give it a ticket ID
- **Need a spec?** → `BC PM` — give it an ADO ticket ID or paste the ticket description
- **Implementing?** → `BC Developer` — tell it to work on `specs/ABC-123/`
- **Ready to ship?** → `BC PR` → `BC Deploy` → `BC Doc` → `BC Deploy`

---

## Repository Structure

```
bc-alm-template/
├── README.md
├── docs/
│   ├── workflow.md                         ← Full 12-stage lifecycle
│   ├── branching-strategy.md               ← Branch model and naming conventions
│   └── spec-driven-development.md          ← Spec-driven dev explained
├── .github/
│   ├── agents/
│   │   ├── bc-workflow.agent.md
│   │   ├── bc-pm.agent.md
│   │   ├── bc-dev.agent.md
│   │   ├── bc-pr.agent.md
│   │   ├── bc-deploy.agent.md
│   │   └── bc-doc.agent.md
│   ├── instructions/
│   │   └── al-coding-standards.instructions.md
│   └── PULL_REQUEST_TEMPLATE.md
├── specs/
│   └── _TEMPLATE/
│       ├── README.md
│       ├── brief.md
│       ├── plan.md
│       ├── acceptance-criteria.md
│       └── change-log.md
└── .vscode/
    └── mcp.json
```

---

## AL Coding Standards

The file [`.github/instructions/al-coding-standards.instructions.md`](.github/instructions/al-coding-standards.instructions.md) is applied automatically by GitHub Copilot to every `.al` file. It enforces:

- PascalCase object naming with assigned object ID range prefix
- No hardcoded text — Label variables only
- No hardcoded IDs — setup tables or enums
- Extension tables for new fields on base objects
- Event subscribers over direct modifications
- `WITH (NoLocks)` for read-only queries
- `app.json` versioning rules (major.minor.build.revision)
- Permission sets for every new object
- GIVEN/WHEN/THEN test codeunit structure

---

## Credits

Agent patterns inspired by [github/awesome-copilot](https://github.com/github/awesome-copilot) — a community collection of GitHub Copilot custom agents and instructions.

BC/AL-Go branching model informed by [microsoft/AL-Go](https://github.com/microsoft/AL-Go) conventions for Business Central extensions.

---

## Contributing

This is a public template — PRs welcome. If you've adapted this for your team and have improvements to the agents, spec templates, or documentation, please contribute back.
