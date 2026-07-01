---
mode: 'agent'
description: 'Create a phased, personalized onboarding plan for a new member of a Business Central ALM project.'
tools: ['search/codebase', 'search/textSearch', 'web/githubRepo', 'web/fetch', 'github/*']
---

# Create My Business Central Onboarding Plan

I'm a new team member joining **${input:project:Project or team name}** and I need a structured plan to get productive on this Business Central (AL) codebase.

My background: ${input:background:Briefly describe your experience — e.g. new to AL, experienced AL dev new to this team, .NET dev new to BC, functional consultant learning dev}.

Ground the plan in **this repository** — read the README, `.github/AGENT-ARCHITECTURE.md`, `.github/WHEN-TO-USE.md`, `docs/`, `template.config.json`, and the sample `app/` + `test/` projects before writing it. Prefer concrete, repo-specific steps over generic advice.

Produce a phased plan with these phases.

## Phase 1 — Foundation
- Environment setup: VS Code + the AL extension, the recommended extensions (`.vscode/extensions.json`), the AL Dev Tools (`dotnet tool install --global Microsoft.Dynamics.BusinessCentral.Development.Tools`), and Docker/cloud sandbox access. Give step-by-step instructions and common troubleshooting tips.
- Symbols + build: how to download symbols and build `app/` and `test/` (see `docs/al-agent-tools.md`), and how to verify the toolchain works end-to-end.
- The most important docs to read first, in order, with a one-line reason for each.

## Phase 2 — Exploration
- Codebase discovery: start from the README and `app/app.json` (prefix, object-ID range, BC version), then walk the sample objects to learn the team's AL conventions.
- Conventions: read `.github/instructions/al-coding-standards.instructions.md` and `.github/copilot-instructions.md` and summarize the rules I must always follow.
- The ALM workflow: how specs (`specs/`), agents, skills, branching (`docs/branching-strategy.md`) and the issue pipeline (`.github/ISSUE_ORCHESTRATION.md`) fit together.
- Find me 2–3 beginner-friendly first tasks suited to my background — check open GitHub issues (or the `specs/` backlog) and suggest specific ones, favouring docs fixes or small, well-scoped changes.

## Phase 3 — Integration
- Team processes: how a ticket flows from intake → spec → implementation → PR → deploy, and which agent owns each stage (`bc-orchestrator` routes when unsure).
- My first contribution: pick one first task, outline the spec-first steps, the branch name, and the PR checklist it must satisfy.
- Early wins that build confidence, and hands-on practice over reading theory.

For each phase, break complex topics into manageable steps, link the exact repo files/commands, and end with concrete next actions.
