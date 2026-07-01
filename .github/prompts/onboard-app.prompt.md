---
mode: 'agent'
description: 'Onboard a new or existing AL app into the BC ALM template: capture the ALM decisions, apply them with the initializer, and scaffold repo instructions and the first spec.'
tools: ['search/codebase', 'search/textSearch', 'edit/editFiles', 'execute/runInTerminal', 'web/githubRepo', 'web/fetch', 'github/*']
---

# Onboard This App into the BC ALM Workflow

Bring **${input:appName:the app / project name}** under this template's conventions so agents, skills, specs and CI all work against it. Do this as a guided, confirm-before-write flow — never guess a value I can supply.

## 1. Assess what's here
Read the current state before proposing anything:
- `app/app.json` and `test/app.json` (or any `app.json` in the repo) — current name, publisher, `idRanges`, `application`/`platform`/`runtime`.
- `template.config.json` — is it still template defaults (`initialized: false`)? What does `values` say?
- Existing `.github/copilot-instructions.md`, `.github/instructions/`, `.vscode/*`, and any `*.code-workspace`.
Summarize what's already correct and what still points at the `ABC` / sample defaults.

## 2. Capture the ALM decisions
Confirm each of these with me (show the current/default value and let me accept it):
- **App prefix** and **object-ID range** (assigned by Microsoft for AppSource, or your internal range).
- **App name** and **publisher**.
- **Target BC version** (`application`/`platform` app.json minimums and AL `runtime`) — the default targets the latest wave; check the latest supported version if I ask.
- **Work-item system** — GitHub Issues or Azure DevOps Boards (this decides `AB#` vs `#` linking and which MCP tools the agents keep).
- **Branching** and **commit** conventions (defaults: `feature/<id>-<name>` from `main`; Conventional Commits).
- **Environments** for deploys (default `TEST` → `PROD`).
- Where the VS Code-discoverable customizations should live (`customizationsPath`: repo root, or under `app/` if you open the app folder directly).

## 3. Apply with the initializer
Once confirmed, run the initializer non-interactively with the captured values (preview first):
```powershell
pwsh ./scripts/Initialize-Template.ps1 -WhatIf -AppPrefix <PFX> -ObjectIdFrom <n> -ObjectIdTo <n> -AppName '<name>' -Publisher '<pub>' -RepoSlug <owner/repo> -WorkItemSystem <GitHub|ADO>
```
Show me the `-WhatIf` output, then re-run without `-WhatIf` on my go. This rewrites prefixes, IDs, slugs, BC versions and `template.config.json`. (Equivalently, hand off to the **bc-init** agent.)

## 4. Scaffold repo instructions
Custom instructions are how Copilot learns this app's rules. Ensure they exist and are accurate:
- If `.github/copilot-instructions.md` is missing or generic, run the **`/generate-copilot-instructions`** prompt (or hand off to **bc-doc**) to write repo-wide + path-scoped instruction files grounded in the real code.
- Verify `.github/instructions/al-coding-standards.instructions.md` reflects the confirmed prefix and ID range.

## 5. First ticket
- Copy `specs/_TEMPLATE` to `specs/<PREFIX>-<id>-<slug>/` for the first piece of work, or hand off to **bc-pm** / **bc-spec**.
- Point me at `bc-orchestrator` as the entry point for day-to-day work.

Finish with a short checklist of what changed and what I still need to do manually (e.g. `az login`, enable the `al` MCP server, request a symbols/sandbox).
