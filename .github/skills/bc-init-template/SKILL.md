---
name: bc-init-template
description: "Guides an adopter through initializing this BC ALM template for their own project — interviews them for prefix, object ID range, publisher, repo, work-item system, branching and commit conventions, then runs scripts/Initialize-Template.ps1 to apply everything. Use when: initialize the template, set up this repo for my project, customize the template, run guided setup, configure prefix and object range, onboard a new BC repo, replace ABC placeholders, first-time setup."
---

# BC · Initialize the Template

Turn a fresh copy of this template into a project-specific repository. You **interview** the
adopter for the values below, confirm a summary, then apply them with the deterministic
initializer script. This is the core procedure of the **`bc-init`** agent.

> One-time setup. After the repo is initialized (`template.config.json` -> `"initialized": true`),
> this skill is no longer needed — point the user at `bc-orchestrator` to start their first feature.

## When to run

- Right after creating a repo from the template ("Use this template" on GitHub), or
- When adapting an existing copy to a new prefix / range / org.

## The interview

Ask these **one at a time**, showing the current default from `template.config.json` in brackets
and accepting it on empty input. Group them so it feels quick, but never bundle several questions
into one prompt.

| # | Question | Token | Default | Notes |
|---|---|---|---|---|
| 1 | App / object **prefix** (2-4 chars) | `appPrefix` | `ABC` | Your registered BC partner/AppSource prefix. Used in every object name and file name. |
| 2 | **Ticket / spec prefix** | `ticketPrefix` | `ABC` | The key in `PREFIX-123` and `specs/PREFIX-{ID}-*`. Often your ADO project key or Jira key; may equal the app prefix. |
| 3 | App **display name** | `appName` | `ABC Payment Tolerance` | The extension's name in `app.json`. |
| 4 | **Publisher** | `publisher` | `ABC` | Your company name (`app.json` publisher). |
| 5 | Object ID **range** (from / to) | `objectIdFrom` / `objectIdTo` | `50100` / `50199` | Your assigned range. Sample object IDs are shifted to match. |
| 6 | GitHub **repo slug** (`owner/repo`) | `repoSlug` | `AlexanderErdelyi/bc-alm-template` | Appears in `app.json` url, issue-template config, docs. |
| 7 | **Work-item system** | `workItemSystem` | `ADO` | `ADO` -> keep `AB#` commit linking. `GitHub` -> convert to `#`. |
| 8 | Azure DevOps **org** / **project** | `adoOrg` / `adoProject` | `your-organization` / — | Skip / leave blank if using GitHub Issues only. |
| 9 | Default (production) **branch** | `defaultBranch` | `main` | |
| 10 | **Branching strategy** | `branchingStrategy` | `feature-release-selective` | The model in `docs/branching-strategy.md`. Keep the default unless the team uses something else. |
| 11 | **Commit convention** | `commitConvention` | `conventional` | e.g. Conventional Commits, or a custom `PREFIX-123: ...` style. |
| 12 | **Environments** | `environments` | `TEST,PROD` | Ordered deployment targets. |
| 13 | **Agent models** (optional) | `models.*` | Sonnet 4.6 / Opus 4.8 | Per-agent model. Keep the defaults or set names from the user's Copilot picker in `template.config.json` `models`. The script writes them into each agent's `model:` line. |
| 14 | **BCQuality** (optional) | `bcQuality.mode` | `off` | Add Microsoft's [BCQuality](https://github.com/microsoft/BCQuality) knowledge base to back AL review. `vendor` (tracked copy) / `submodule` / `off`. If on, run `scripts/Add-BCQuality.ps1` after the initializer. See [`docs/bcquality.md`](../../../docs/bcquality.md). |
| 15 | **Target BC version** (optional) | `bcVersion.*` | v28 / runtime 16.0 | Target Business Central release. Set `application`/`platform`/`runtime` in `template.config.json` `bcVersion`; the script writes them into both `app/app.json` and `test/app.json`. |

## Confirm, then apply

1. Echo a compact summary table of the chosen values and ask the user to confirm.
2. Run a **dry run first** so they can preview the blast radius:

   ```powershell
   ./scripts/Initialize-Template.ps1 -AppPrefix XYZ -TicketPrefix PROJ `
     -ObjectIdFrom 60000 -ObjectIdTo 60099 -Publisher "Contoso Ltd." `
     -AppName "Contoso Payment Tolerance" -RepoSlug "contoso/bc-app" `
     -AdoOrg contoso -WorkItemSystem GitHub -WhatIf
   ```

3. On approval, run the same command **without `-WhatIf`** to apply. (Or run
   `./scripts/Initialize-Template.ps1 -Interactive` to let the script prompt directly.)

The script then:
- replaces the prefix, ticket prefix, repo slug, and ADO org across all text files;
- shifts every sample object ID into the new range;
- sets `app.json` name + publisher and renames AL files carrying the old prefix;
- writes `platform`/`application`/`runtime` into both `app/app.json` and `test/app.json` from the `bcVersion` map;
- converts `AB#` -> `#` when the work-item system is GitHub;
- writes each agent's `model:` line from the `models` map in `template.config.json`;
- writes the choices back to `template.config.json` and generates `PROJECT.md`.

## Finish up (guide the user through these)

1. **Review** `git status` / `git diff` — nothing is committed automatically.
2. **New GUID** for `app.json` `id` (each extension needs a unique app id).
3. **Target version** — the initializer sets `app.json` `platform`/`application`/`runtime` from
   `template.config.json` `bcVersion` (default v28 / runtime 16.0). Edit that block to retarget,
   then re-download matching symbols (see [`docs/al-agent-tools.md`](../../../docs/al-agent-tools.md)).
4. **Models** — defaults are Sonnet 4.6 for most agents and Opus 4.8 for `bc-spec` / `bc-pr`. To
   change them, edit the `models` map in `template.config.json` and re-run the initializer (it
   rewrites each agent's `model:` line). Each name must match your Copilot model picker exactly.
5. **Extensions** — accept VS Code's prompt to install the recommended AL extensions
   (`.vscode/extensions.json`).
6. **BCQuality** (optional) — if the adopter opted in (Q14), run the fetch and build the index:

   ```powershell
   ./scripts/Add-BCQuality.ps1 -Mode vendor      # or -Mode submodule
   pwsh ./vendor/bcquality/tools/Build-KnowledgeIndex.ps1
   ```

   This backs the `bc-review-self` AL gate with Microsoft-/community-curated BC rules. See
   [`docs/bcquality.md`](../../../docs/bcquality.md).
7. **MCP** — if using ADO, the org is already set; confirm `.vscode/mcp.json`.
8. Hand off to **`bc-orchestrator`** to start the first feature.

## Guardrails

- Never invent values — ask. Only the user knows their prefix, range, and org.
- Always show the `-WhatIf` preview before a destructive run.
- Do not edit files by hand for the mechanical tokens; the script is the single source of truth.
  Reserve manual edits for nuanced prose the script can't infer (e.g. a bespoke commit convention).
