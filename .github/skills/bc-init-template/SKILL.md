---
name: bc-init-template
description: "Guides an adopter through initializing this BC ALM template for their own project — interviews them for prefix, object ID range, publisher, repo, work-item system, branching and commit conventions, runs scripts/Initialize-Template.ps1 to apply everything, then regenerates project-specific copilot-instructions grounded in the real app. Use when: initialize the template, set up this repo for my project, customize the template, run guided setup, configure prefix and object range, onboard a new BC repo, replace ABC placeholders, first-time setup, generate project-specific copilot-instructions, my copilot-instructions still describe the template."
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
| 2 | **Ticket / branch prefix** | `ticketPrefix` | `ABC` | The key in `PREFIX-123` references and `feature/PREFIX-{ID}-*` branch names. Often your ADO project key or Jira key; may equal the app prefix; type `none` for bare IDs. (Spec folders no longer carry it — they are grouped by module/area.) |
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

## Ground the instructions in the real project

The script only replaces **tokens** — it does not rewrite prose. The template ships a
`.github/copilot-instructions.md` (and path-scoped `.github/instructions/*.instructions.md`) that
**describe this ALM template itself**. After a real project is initialized, those must be
regenerated so Copilot's always-on context describes the **adopter's actual app**, not the template.

1. Read the real project: `app.json` (name, publisher, `idRanges`, target versions), representative
   AL source, `.vscode/*`, `docs/`, and the ALM decisions just confirmed.
2. Regenerate `.github/copilot-instructions.md` following the procedure in
   [`.github/prompts/generate-copilot-instructions.prompt.md`](../../prompts/generate-copilot-instructions.prompt.md)
   — repo-wide guidance + focused path-scoped instruction files, all grounded in the code. (Equivalently,
   hand off to **bc-doc**.)
3. The file lives at `<customizationsPath>/.github/copilot-instructions.md` (repo root, or under
   `app/` for an app-folder layout). It is listed in `.templatesyncignore` and skipped by
   `Update-FromTemplate.ps1`, so the project-specific version is **safe from future template syncs** —
   regenerate with confidence.
4. Show the user a diff before writing and flag any rule you inferred so they can confirm it.

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

## Fine-tuning an existing-repo overlay

When the template was laid onto an **existing** repo with
[`scripts/Install-IntoExistingRepo.ps1`](../../../scripts/Install-IntoExistingRepo.ps1)
(rather than "Use this template"), run the interview + initializer as above, then reconcile the
overlay. The installer is deliberately non-destructive, so a few things need a human decision:

1. **Confirm the customizations location.** The installer auto-detects an app-folder layout
   (e.g. `app/.github`) and records it in `template.config.json` → `values.sync.customizationsPath`.
   Verify it matches where the repo actually keeps its agents/skills (open that folder in VS Code
   to confirm they're discovered). If wrong, re-run the installer with `-Configure -CustomizationsPath <path>`.
2. **Resolve `*.template` files.** Merge-sensitive files (`copilot-instructions.md`, PR template,
   `.vscode/*`, `.gitignore`) were written as `<file>.template` next to the originals. Diff each,
   fold in what you want, then delete the `.template`.
3. **Deduplicate overlapping skills/agents.** If the repo already had its own skills/agents under
   different names, the `bc-*` set now coexists with them. Decide per capability whether to keep the
   template's `bc-*` version, keep the repo's original, or merge — then delete the loser so there's
   one procedure per lifecycle stage. Do not leave two skills that fire on the same `Use when:` triggers.
4. **Pick the single work-item backend.** The template ships both ADO (`AB#`) and GitHub (`#`) wiring;
   Q7 chose one and the initializer converted linking. Remove or ignore the unused backend's
   references so commits/PRs link consistently.
5. **Right-size the included categories.** An existing repo rarely needs `metaDocs`, `referenceDocs`,
   `issueOps` or the `sampleApp` — the lean default leaves them off. If the repo already runs its own
   CI (e.g. Azure DevOps pipelines), leave `issueOps` off and delete the root `.github/workflows/template-sync.yml`
   (or add it to `.templatesyncignore`) if GitHub Actions aren't used there.
6. **Re-verify models & MCP** as in "Finish up" — the overlaid agents carry the template's `model:`
   lines; align them to the repo's Copilot picker and confirm `.vscode/mcp.json`.

## Guardrails

- Never invent values — ask. Only the user knows their prefix, range, and org.
- Always show the `-WhatIf` preview before a destructive run.
- Do not edit files by hand for the mechanical tokens; the script is the single source of truth.
  Reserve manual edits for nuanced prose the script can't infer (e.g. a bespoke commit convention).
