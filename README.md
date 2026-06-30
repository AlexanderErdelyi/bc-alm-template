# BC ALM Template

> **A complete, opinionated Application Lifecycle Management template for Microsoft Dynamics 365 Business Central AL development teams.**

Combines spec-driven development, GitHub Copilot custom agents for every workflow stage, a documented branching strategy, and AL coding standards — all version-controlled in one place and ready to fork.

---

## What This Template Gives You

| Component | What it does |
|---|---|
| **10 Copilot agents** | Roles across the lifecycle — orchestrator, PM (triage), plan, spec, dev, PR, deploy, doc, plus CI/CD and setup utilities — routed via `handoffs:` |
| **Reusable skills** | [Copilot Agent Skills](.github/skills) — portable, trigger-fired procedures for each lifecycle phase (the "how" behind the agents) |
| **Spec-driven development** | Structured spec folder per ticket: brief → plan → acceptance criteria → change log |
| **Branching strategy** | Documented model: `feature/*` from `main`, `release/*` composed selectively |
| **AL coding standards** | Always-on Copilot instructions applied to every `.al` file |
| **PR template** | BC-specific checklist: ADO link, affected objects table, quality gates |
| **Architecture docs** | [`WHEN-TO-USE.md`](.github/WHEN-TO-USE.md) decision map + [`AGENT-ARCHITECTURE.md`](.github/AGENT-ARCHITECTURE.md) design record |
| **AL agent tooling** | Pre-wired for Microsoft's [AL MCP & LSP servers + ALTool](docs/al-agent-tools.md) — agents build, compile, and navigate AL semantically (not by regex) |
| **BCQuality (optional)** | Hook Microsoft's [BCQuality](https://github.com/microsoft/BCQuality) review knowledge base into the AL quality gate ([docs](docs/bcquality.md)) |

---

## The Full BC Development Workflow

```
ADO Ticket
    │
    ▼
[BC PM Agent] ──────► Ticket triaged + groomed
    │
    ▼
[BC Plan + BC Spec] ─► Spec Created (brief + plan + acceptance-criteria)
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

## The 10 Copilot Agents

| Agent | Default model | What it does |
|---|---|---|
| **bc-orchestrator** | Claude Sonnet 4.6 | **Orchestrator.** Give it a ticket ID — it detects your current workflow stage and routes you to the right agent (via `handoffs:` and the `agent` tool). Start here. |
| **bc-pm** | Claude Sonnet 4.6 | **Project Manager.** Ticket intake, triage, prioritization and backlog grooming (ADO/GitHub). Gets work ready to plan. |
| **bc-plan** | Claude Sonnet 4.6 | **Planner.** Turns a triaged ticket into a crisp user story with testable acceptance criteria. |
| **bc-spec** | Claude Opus 4.8 | **Spec Author.** Writes the developer-ready 4-document spec folder from the user story. |
| **bc-dev** | Claude Sonnet 4.6 | **Developer.** AL implementation specialist. Reads the spec, guides object creation, enforces standards, generates test stubs. |
| **bc-pr** | Claude Opus 4.8 | **Pull Request.** Self-reviews, generates the PR description, runs the AL quality checklist, links the work item. |
| **bc-deploy** | Claude Sonnet 4.6 | **Deploy.** Manages release branches. Composes `release/wave-N` from selected features and guides TEST/PROD deployment. |
| **bc-doc** | Claude Sonnet 4.6 | **Documentation.** Reads specs and code. Generates customer-facing functional docs and changelog. Required gate before PROD. |
| **bc-workflow** | Claude Sonnet 4.6 | **Workflow Engineer (utility).** Authors and maintains CI/CD — GitHub Actions and AL-Go for GitHub pipelines. |
| **bc-init** | Claude Sonnet 4.6 | **Template Initializer (utility).** One-time guided setup that adapts this template to your project. |

All agents live in [`.github/agents/`](.github/agents/).

> **Note on models:** each agent sets a single `model:` that must match a name in your Copilot
> model picker. They are managed centrally in [`template.config.json`](template.config.json) under
> `models`. Defaults are **Claude Sonnet 4.6** for most agents and **Claude Opus 4.8** for the
> deep-reasoning ones (`bc-spec`, `bc-pr`). To change them, edit `template.config.json` and re-run
> the initializer (it rewrites each agent's `model:` line), or edit a `.agent.md` directly. If
> VS Code flags a model as unknown, add the ` (copilot)` suffix (e.g. `Claude Sonnet 4.6 (copilot)`).

Each agent is a thin persona backed by a **skill** that holds the actual procedure, and
declares **`handoffs:`** so you can step to the next phase in one click. `bc-workflow` and
`bc-init` are **utility** agents that sit outside the PLAN → DOCS lifecycle. See the
[architecture record](.github/AGENT-ARCHITECTURE.md).

---

## The Reusable Skills

[GitHub Copilot Agent Skills](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills)
are portable `SKILL.md` procedures that fire automatically when your request matches their
`Use when:` triggers — in chat, the CLI, or from an agent. They are the single source of truth
for *how* each phase is done, so agents and skills never drift apart.

| Skill | Phase | Purpose |
|---|---|---|
| [`bc-triage-backlog`](.github/skills/bc-triage-backlog/SKILL.md) | TRIAGE | Intake, triage, prioritize and groom work items (ADO/GitHub) |
| [`bc-plan-user-story`](.github/skills/bc-plan-user-story/SKILL.md) | PLAN | Ticket → user story + acceptance criteria |
| [`bc-spec-author`](.github/skills/bc-spec-author/SKILL.md) | SPEC | Author the 4-document spec folder |
| [`bc-build-feature`](.github/skills/bc-build-feature/SKILL.md) | BUILD | Implement AL objects to spec + standards + tests |
| [`bc-review-self`](.github/skills/bc-review-self/SKILL.md) | REVIEW | Pre-PR self-review against the AL quality gate |
| [`bc-ship-pull-request`](.github/skills/bc-ship-pull-request/SKILL.md) | SHIP | Compose the PR description + checklist + ADO link |
| [`bc-ship-release`](.github/skills/bc-ship-release/SKILL.md) | SHIP | Compose a release branch, deploy TEST/PROD |
| [`bc-docs-feature`](.github/skills/bc-docs-feature/SKILL.md) | DOCS | Customer-facing functional docs + changelog |
| [`bc-cicd-pipeline`](.github/skills/bc-cicd-pipeline/SKILL.md) | CI/CD | Author/maintain GitHub Actions & AL-Go for GitHub pipelines |
| [`bc-util-commit-message`](.github/skills/bc-util-commit-message/SKILL.md) | util | Conventional commits with ADO work-item linking |

See [`.github/SKILLS.md`](.github/SKILLS.md) for the index and
[`.github/WHEN-TO-USE.md`](.github/WHEN-TO-USE.md) for a decision map of agents vs skills.

> **Coexistence with plugin skills.** Copilot discovers skills from every active source at once —
> this repo's `.github/skills/`, your personal skills, and any **enabled plugin** (e.g. a
> marketplace plugin shipping fine-grained `al-*` skills). A skill fires when your request matches
> its `Use when:` triggers, no matter where it lives. These template skills (`bc-*`, lifecycle
> procedures) are deliberately **self-contained** and use a distinct prefix, so they don't collide
> with or override plugin skills — the two stack: `bc-*` drives *what* to do per phase, your
> `al-*` plugin skills inform *how* the AL should look. Keep trigger phrases distinct to avoid
> loading redundant context.

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

### 1. Use this template

Click **"Use this template" → "Create a new repository"** (top of the repo page) to create
your own copy. Don't clone directly — the template structure is what you're copying.

> **Maintainers:** for the "Use this template" button to appear, enable it once in
> **Settings → General → Template repository**. Also consider protecting `main`
> (Settings → Branches) since the workflow assumes `main` is production-ready.

### 1b. Or: add the template to an existing repo

Already have a BC repo? Overlay the template instead of starting fresh. From a clone of *this*
template, run:

```powershell
pwsh ./scripts/Install-IntoExistingRepo.ps1 -TargetRepo C:\path\to\your-existing-repo -WhatIf
# review the plan, then run it for real (drop -WhatIf)
```

The installer copies the agents, skills, instructions, meta-docs, `docs/`, the initializer, and
`template.config.json` into your repo. It **never clobbers your existing files**:

- **New paths** (agents, skills, instructions, …) are added; anything you already have is skipped
  (use `-Force` to overwrite).
- **Merge-sensitive files** (`.github/copilot-instructions.md`, `PULL_REQUEST_TEMPLATE.md`,
  `.vscode/*`, `.gitignore`) are written next to yours with a `.template` suffix so you can diff
  and merge by hand.
- The **sample AL app** (the `app/` and `test/` projects) is **not** copied unless you pass
  `-IncludeSampleApp` — your own AL code is left untouched.

Then continue with step 2 (run the initializer) inside your repo.

### 2. Initialize the template for your project

Run the guided initializer to replace the sample prefix, object ID range, publisher, repo slug,
and work-item style with your own — either the **`bc-init`** Copilot agent or
`./scripts/Initialize-Template.ps1 -Interactive`. See
[Customizing This Template](#customizing-this-template) for details. Do this once, before your
first feature.

### 3. Copy the spec template for your first ticket

```bash
cp -r specs/_TEMPLATE specs/ABC-123-your-feature-name
```

Fill in `brief.md` first, then open a spec PR before writing any AL code.

### 4. Install the recommended AL extensions

When you open the repo in VS Code, it will prompt you to install the recommended extensions
from [`.vscode/extensions.json`](.vscode/extensions.json) — the AL Language extension plus the
team toolchain (Object ID Ninja, AL Test Runner, CRS, NAB AL Tools, GitLens, Docker). Accept the
prompt, or run **Extensions: Show Recommended Extensions** from the Command Palette.

### 5. Configure ADO MCP (optional but recommended)

Edit [`.vscode/mcp.json`](.vscode/mcp.json) with your Azure DevOps organization and project. This lets the `bc-pm` and `bc-orchestrator` agents read your ADO tickets directly.

### 6. Use the agents

Open GitHub Copilot Chat in VS Code or GitHub.com and select an agent from the dropdown:

- **Not sure where to start?** → `BC Orchestrator` — give it a ticket ID
- **New ticket to triage?** → `BC PM` — intake, triage, and groom the backlog
- **Need a spec?** → `BC Plan` (user story) then `BC Spec` — give it an ADO ticket ID or paste the description
- **Implementing?** → `BC Developer` — tell it to work on `specs/ABC-123/`
- **Ready to ship?** → `BC PR` → `BC Deploy` → `BC Doc` → `BC Deploy`

---

## The Sample AL App

This template includes a small, working AL extension so you can see the conventions applied
to real code (and have something that compiles from day one). It is structured as a
**two-project workspace** — a production app and a separate test app — the same layout
AL-Go for GitHub uses:

```
app/                         ← Production app (compiles to the shipped extension)
├── app.json                 ← Manifest: publisher ABC, object range 50100–50199
└── src/
    ├── Setup/               ← "ABC Payment Setup" table + setup card page
    ├── TableExtensions/     ← "Customer ABC Ext." adds a Payment Tolerance % field
    ├── Codeunits/           ← "ABC Payment Tolerance Mgt." business logic
    └── Permissions/         ← "ABC Payment" permission set
test/                        ← Separate test app (depends on app/ + Microsoft test libs)
├── app.json                 ← Test manifest: Library Assert / Any dependencies
└── src/                     ← GIVEN/WHEN/THEN test codeunit (see test/README.md)
bc-alm-template.code-workspace  ← Multi-root workspace tying app/ + test/ together
.vscode/                     ← AL launch + analyzer settings
```

It's the same "Payment Tolerance" example used throughout the
[AL coding standards](.github/instructions/al-coding-standards.instructions.md), so the docs
and the code stay in sync. Delete it (and keep just the structure) once you start your own
feature, or use it as a reference.

> **Target version** — the sample is pinned to **BC 2026 wave 1 (v28, runtime 16.0)** and is
> verified to compile clean (production + tests) against symbols from the public Microsoft
> symbols feed. To retarget a different release, edit `values.bcVersion` in
> [`template.config.json`](template.config.json) and re-run the initializer — it rewrites
> `application`/`platform`/`runtime` in both `app/app.json` and `test/app.json`. See
> [docs/al-agent-tools.md](docs/al-agent-tools.md#symbols--building-from-the-cli-no-docker--no-online-sandbox)
> for headless symbol download + CLI build steps.

> Need a full CI/CD build, test, signing, and deployment pipeline? See
> [docs/al-go-upgrade.md](docs/al-go-upgrade.md) for an optional upgrade path to
> **AL-Go for GitHub**.

---

## AL Agent Tools — MCP & LSP

Microsoft ships first-party tooling that lets AI agents (including GitHub Copilot) **build,
compile, publish, and navigate** AL code reliably instead of guessing from text. This template
is pre-wired for it. Full guide: **[docs/al-agent-tools.md](docs/al-agent-tools.md)**.

| Surface | What it gives an agent | How it's enabled here |
|---|---|---|
| **AL MCP Server** ([`launchmcpserver`](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-al-tool#almcp)) | `al_build`, `al_compile`, `al_getdiagnostics`, `al_symbolsearch`, `al_downloadsymbols`, … over stdio | Ready-to-enable entry in [`.vscode/mcp.json`](.vscode/mcp.json) (disabled key `_al` → rename to `al`) |
| **AL LSP Server** ([`launchlspserver`](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-al-tool#al-lsp)) | Semantic go-to-definition, find-references (cross-project), rename, type hierarchy — follows `internalsVisibleTo` / `propagateDependencies` instead of regex | Spawned by your agent/editor as a child process; repo-specific launch command + config in [docs](docs/al-agent-tools.md#2b-enable-the-al-lsp-server-for-agents) |
| **ALTool CLI** ([`al` / ALTool](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-al-tool)) | `al workspace compile`, `al compile`, headless symbol fetch + build | `dotnet tool install --global Microsoft.Dynamics.BusinessCentral.Development.Tools`; works against the shipped `bc-alm-template.code-workspace` |

> The AL **LSP** server (`launchlspserver`) is newer than the MCP server — it requires BC 2026
> wave 1+ ALTool. If `al launchlspserver --help` is unknown, run
> `dotnet tool update --global Microsoft.Dynamics.BusinessCentral.Development.Tools`.

---

## BCQuality — Microsoft's AL Review Knowledge Base (optional)

[**microsoft/BCQuality**](https://github.com/microsoft/BCQuality) is an MIT-licensed, machine-
readable catalog of Business Central quality rules and review guidance maintained by Microsoft
and the BC community. This template can wire it into the `bc-review-self` quality gate so AL
findings cite a Microsoft-/community-vetted rule instead of an opinion.

```powershell
./scripts/Add-BCQuality.ps1            # vendor a tracked copy (or -Mode submodule)
```

Or opt in during the guided **`bc-init`** setup. See **[docs/bcquality.md](docs/bcquality.md)**
for how reviews consume it and how to keep the copy up to date.

---

## Customizing This Template

After creating your repo from the template, run the **guided initializer** — it replaces the
prefix, object ID range, publisher, repo slug, ADO org, and work-item style across the whole repo
(and renames the sample AL files) in one pass.

**Option A — Copilot agent (conversational):** open Copilot Chat and select the **`BC Template
Initializer`** (`bc-init`) agent. It interviews you, previews the changes, then applies them.

**Option B — PowerShell script:** run it interactively, or pass values for CI:

```powershell
# Interactive — prompts for each value (Enter accepts the default)
./scripts/Initialize-Template.ps1 -Interactive

# Preview a non-interactive run without writing anything
./scripts/Initialize-Template.ps1 -AppPrefix XYZ -TicketPrefix PROJ `
  -ObjectIdFrom 60000 -ObjectIdTo 60099 -Publisher "Contoso Ltd." `
  -AppName "Contoso Payment Tolerance" -RepoSlug "contoso/bc-app" `
  -AdoOrg contoso -WorkItemSystem GitHub -WhatIf
```

The values it manages live in [`template.config.json`](template.config.json); after a run it
records your choices there and generates a `PROJECT.md` summary. The tokens it replaces:

| Placeholder | What it is | Replace with | Where |
|---|---|---|---|
| `ABC` | App / object name prefix | Your assigned BC partner prefix | `app/app.json`, `app/src/**`, `test/**`, instructions, agents, docs |
| `50100`–`50199` | Object ID range | Your assigned object ID range | `app/app.json` & `test/app.json` (`idRanges`), `app/src/**`, `test/src/**`, `.vscode/launch.json` |
| `ABC-{ID}` / `AB#` | Ticket reference style | Your ADO project key (or GitHub `#`) | agents, docs, PR template |
| `AlexanderErdelyi/bc-alm-template` | Repo slug | `your-org/your-repo` | `.github/ISSUE_TEMPLATE/config.yml`, `app/app.json`, `test/app.json`, docs |
| `your-organization` | ADO org | Your Azure DevOps organization | prompted by `.vscode/mcp.json` on first use |
| `bcVersion` | Target BC version (`application`/`platform`/`runtime`) | Your target BC release (default v28 / runtime 16.0) | `app/app.json` & `test/app.json` |

Then (the initializer reminds you of these):

1. Generate a fresh GUID for the `id` in **both** `app/app.json` and `test/app.json`. The
   target BC version is driven by `values.bcVersion` in
   [`template.config.json`](template.config.json) — edit it there and the initializer writes
   `application`/`platform`/`runtime` into both manifests.
2. Set each agent's model in [`template.config.json`](template.config.json) (`models`) to match
   your Copilot model picker, then re-run the initializer (or edit a `.agent.md` directly).
3. Configure the Azure DevOps MCP server — see [`.vscode/mcp.json`](.vscode/mcp.json) (it
   prompts for your ADO org and uses your `az login` session).

---

## Repository Structure

```
bc-alm-template/
├── README.md
├── LICENSE
├── CONTRIBUTING.md
├── .gitignore
├── app/                                    ← Sample production app (app.json + src/)
├── test/                                   ← Sample test app (app.json + src/, depends on app/)
├── bc-alm-template.code-workspace          ← Multi-root workspace (app/ + test/)
├── template.config.json                    ← Project tokens (prefix, range, org…) for the initializer
├── scripts/
│   ├── Initialize-Template.ps1             ← Guided/CI setup: replace tokens across the repo
│   ├── Install-IntoExistingRepo.ps1        ← Overlay the template onto an existing repo
│   ├── Start-ALLanguageServer.ps1          ← Launch the AL LSP server for agents (repo-tuned)
│   └── Add-BCQuality.ps1                   ← Optional: add Microsoft's BCQuality review knowledge base
├── docs/
│   ├── workflow.md                         ← Full 12-stage lifecycle
│   ├── branching-strategy.md               ← Branch model and naming conventions
│   ├── spec-driven-development.md          ← Spec-driven dev explained
│   ├── al-agent-tools.md                   ← AL LSP / AL MCP server / ALTool for agents
│   ├── bcquality.md                        ← Optional Microsoft BCQuality knowledge base for AL review
│   └── al-go-upgrade.md                    ← Optional AL-Go for GitHub upgrade path
├── .github/
│   ├── copilot-instructions.md             ← Repo-wide Copilot instructions
│   ├── AGENT-ARCHITECTURE.md               ← Why the agent/skill system is shaped this way
│   ├── WHEN-TO-USE.md                      ← Decision map: which agent/skill to use
│   ├── SKILLS.md                           ← Skills index
│   ├── agents/
│   │   ├── bc-orchestrator.agent.md        ← Orchestrator (start here)
│   │   ├── bc-pm.agent.md                  ← Intake / triage / backlog
│   │   ├── bc-plan.agent.md                ← User story + acceptance criteria
│   │   ├── bc-spec.agent.md                ← Technical spec author
│   │   ├── bc-dev.agent.md
│   │   ├── bc-pr.agent.md
│   │   ├── bc-deploy.agent.md
│   │   ├── bc-doc.agent.md
│   │   ├── bc-workflow.agent.md            ← CI/CD & AL-Go pipelines (utility)
│   │   └── bc-init.agent.md                ← One-time template initializer (utility)
│   ├── skills/                             ← Reusable Copilot Agent Skills (bc-*)
│   │   ├── README.md
│   │   ├── bc-triage-backlog/SKILL.md
│   │   ├── bc-plan-user-story/SKILL.md
│   │   ├── bc-spec-author/SKILL.md
│   │   ├── bc-build-feature/SKILL.md       ← + references/al-patterns.md
│   │   ├── bc-review-self/SKILL.md
│   │   ├── bc-ship-pull-request/SKILL.md
│   │   ├── bc-ship-release/SKILL.md
│   │   ├── bc-docs-feature/SKILL.md
│   │   ├── bc-cicd-pipeline/SKILL.md
│   │   ├── bc-util-commit-message/SKILL.md
│   │   └── bc-init-template/SKILL.md       ← Backs the bc-init setup agent
│   ├── instructions/
│   │   └── al-coding-standards.instructions.md
│   ├── ISSUE_TEMPLATE/                     ← Feature + bug issue forms
│   ├── workflows/                          ← Issue orchestration pipeline
│   ├── ISSUE_ORCHESTRATION.md
│   └── PULL_REQUEST_TEMPLATE.md
├── specs/
│   └── _TEMPLATE/
│       ├── README.md
│       ├── brief.md
│       ├── plan.md
│       ├── acceptance-criteria.md
│       └── change-log.md
└── .vscode/
    ├── extensions.json                      ← Recommended AL extensions (team toolchain)
    ├── mcp.json
    ├── settings.json
    └── launch.json
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

This is a public template — PRs welcome. If you've adapted this for your team and have improvements to the agents, spec templates, or documentation, please contribute back. See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

Released under the [MIT License](LICENSE).
