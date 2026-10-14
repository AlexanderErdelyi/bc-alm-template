# BC ALM VS Code extension

The **BC ALM** extension (source in [`vscode-extension/`](../vscode-extension/)) is the
point-and-click front end for this template. It lets you:

- **start** a new BC project from the template, or add BC ALM to an existing repository
- **keep up to date**: see which agents, skills, prompts, instructions and docs changed
  upstream, and update, merge or skip each one
- **choose** which components a project uses: install, disable, or pin to your local version
- **build your own** agents, skills, prompts and instructions with scaffolds and live validation
  against current GitHub Copilot / VS Code guidance
- **share** customizations: save them to your own template repository (overwrite or as a new
  component), or contribute them back to the source template as a pull request
- **stay current**: read a curated best-practices guide and a filtered Copilot changelog feed

It uses the same files as the scripts (`template.config.json`, `template.lock.json`). The
[template-sync GitHub Action](../.github/workflows/template-sync.yml) and
[`Update-FromTemplate.ps1`](../scripts/Update-FromTemplate.ps1) follow the same rules, so the
extension, a local script run and the weekly PR always agree.

## Install

Until the extension is on the Marketplace, install the VSIX:

1. Download `bc-alm-<version>.vsix` from the
   [Releases](https://github.com/AlexanderErdelyi/bc-alm-template/releases) page (tags `ext-v*`),
   or build it yourself: `cd vscode-extension && npm ci && npm run package`.
2. In VS Code, open **Extensions** → **…** → **Install from VSIX…**.

You need `git` on PATH. Creating or adding a project also needs PowerShell (`pwsh` 7
preferred; Windows PowerShell 5.1 works), because those steps run the template's own scripts.

## Start a project

Open the **BC ALM** view in the Activity Bar.

| Command | What it does |
| --- | --- |
| **BC ALM: New Project from Template…** | Clones a template source into a new folder, asks for prefix, object ID range, repo, work-item system and content categories, then runs `Initialize-Template.ps1` and records `.bc-alm/template.lock.json`. |
| **BC ALM: Add BC ALM to This Repository…** | Runs `Install-IntoExistingRepo.ps1` against the repository root (you pick customizations location and categories), initializes it and records the baseline. Values are prefilled from your repo, see below. |
| **Record Template Baseline** | For projects created before the extension existed: writes `template.lock.json` without changing any file. Files that equal an older template version are detected automatically, so they still update cleanly. |
| **Move BC ALM Files into .bc-alm/** | Moves a root-layout project (config, lock, `PROJECT.md`, template scripts) into `.bc-alm/` and updates references. The extension offers this when it opens such a project. |

### Adding BC ALM to an existing repository

- **Repository root, not a subfolder.** In a multi-root workspace (for example `app/` + `test/`)
  the wizard resolves the git root. If you picked a subfolder, it asks whether to use the repository
  root (recommended) or only that folder, and suggests the subfolder as customizations location.
- **Values come from your repo.** Name, publisher and object ID range come from your app's
  `app.json` (the non-test app). The prefix comes from AppSourceCop `mandatoryPrefix`, or is guessed
  from your AL object names. The work-item system, ADO organization/project or GitHub slug and
  default branch come from the `origin` remote. Each prompt shows where the suggestion came from.
- **Your files are kept.** Existing files are never overwritten. Merge-sensitive files
  (`.vscode/*`, `copilot-instructions.md`, the PR template) are written next to yours as
  `*.template`, and missing patterns are appended to `.gitignore`. The wizard lists every
  `*.template` file so you can merge and delete them.
- **What you tick is installed.** Every agent, skill, prompt and instruction you select is
  installed and shows as up to date in the Components view afterwards.
- **Workspaces that only open subfolders work.** The extension looks for `.bc-alm/` in each
  workspace folder and its parents, up to the git root. A workspace with only `app/` and `test/`
  finds the project at the repository root. You don't need to add the repository root or `.bc-alm/`
  as a workspace folder.

### Where the files go: `.bc-alm/`

The template's own bookkeeping lives in one folder, so your repo root stays clean:

```
.bc-alm/
  template.config.json    # your values and sync settings
  template.lock.json      # what was installed from which template commit
  PROJECT.md              # project decisions recorded by the initializer
  .templatesyncignore
  scripts/                # Initialize-Template.ps1, Update-FromTemplate.ps1, ...
```

Agents, skills, prompts, instructions, specs and workflows stay where Copilot and GitHub read them
(`.github/`, or `<customizationsPath>/.github/`). Root-layout projects are migrated automatically by
the next `Update-FromTemplate.ps1` run or with **Move BC ALM Files into .bc-alm/**. The scripts
accept `-ClassicLayout` to keep the old layout.

## Components view: updates without losing your edits

Every template file belongs to a **component**. A component is an agent, a skill folder, a
prompt, an instruction file, a workflow, a doc, or a single file such as a script. Each one
shows a status:

| Status | Meaning | Typical action |
| --- | --- | --- |
| Up to date | Matches the template (with your values applied). | — |
| Update available | The template changed and you haven't edited the file. | **Update** (or **Apply All Safe Updates**) |
| Conflict | The template changed **and** you edited the file. | **Merge (3-way)**, **Compare**, **Keep mine** or **Reset** |
| Modified | You edited it; nothing new upstream. | Nothing, or **Save to My Template** |
| New / Available | New in the template, or not installed in this project. | **Install** |
| Missing | Tracked, but you deleted it locally. | **Install** again or **Disable** |
| Removed upstream | The template deleted it; your copy is kept. | Delete it or keep it as your own |
| Custom | Exists only in your project. | **Save to My Template** / **Contribute** |
| Disabled | Turned off for this project. | **Enable** |

How it decides: `template.lock.json` stores, for every synced file, the template commit and
the hash of what was installed. If your file still has that hash, the update is safe. If not,
you changed it, and the extension offers a 3-way merge with `git merge-file`. The merge uses the
installed version as the base, your file as one side and the new template version as the other.
Conflict markers are left for you to resolve in the editor.

**Your values are applied first.** Template text is re-parameterized with your prefix, object
range, repo, ticket prefix and work-item system. Agents keep your `model:` choices
(`updateModels: false`) and your `extraTools`. So comparisons and merges only show real changes.

### Per-component policy

Stored in `template.config.json` → `values.sync.components` and honored by the script and the
Action too:

```jsonc
"components": {
  "disabled":  ["agent:bc-deploy", "workflow:issue-planning"],  // never installed or re-added
  "keepLocal": ["skill:bc-ship-release"]                         // yours; upstream status still shown
}
```

- **Disable** moves the component's files to `.bc-alm/disabled/` so Copilot no longer discovers
  them. Your edits are kept, and **Enable** restores them.
- **Always Keep My Version** pins a component: syncs never touch it, but the view still tells you
  when upstream has something new so you can compare.
- `updateInstructions: false` and `updateExtensions: false` act as implicit `keepLocal` for
  instructions and `.vscode/extensions.json`.

Commit `template.lock.json`, `template.config.json` and `.bc-alm/` so your team and the
template-sync Action share the same state.

## Template sources: your own template

The **Template Sources** view lists the repositories you pull from. The default is this
template; configure more in `bcAlm.templateSources`. Typical setups:

- **Company template**: **Create My Own Template Repository…** creates your own copy of a GitHub
  template source under your account or one of your organizations:
  - **Fork**: GitHub doesn't allow it in the account that owns the upstream, or when the account
    already has a fork. In that case the existing fork is offered.
  - **Duplicate**: a new repository with the full history, with the original recorded as
    `upstream` in `bcAlm.templateSources`. Use this when you own the upstream.
  - **Independent copy**: GitHub's "Use this template". It shares no history and can't be synced.

  Projects then use it as their primary source. **Pull Upstream Updates into My Template** keeps
  it current:
  - For forks, it tries `gh repo sync` first.
  - Otherwise it merges with git.
  - On conflicts it pushes a `bc-alm/upstream-sync-*` branch and offers a pull request.
- **Multiple sources**: add a second source (e.g. a team's extra skills). **Track Component from
  Another Template Source…** switches a single component to a different source.

The lock records the source per file. Its first source is the default for
`Update-FromTemplate.ps1` and the Action, so a project created from your company template keeps
syncing from it.

## Build and share your own customizations

- **New Agent / Skill / Prompt / Instruction…** scaffolds a file that follows current
  conventions: frontmatter, a "Use when:" description, the skill folder layout, and `applyTo`
  globs.
- **Validation** runs while you type. Diagnostics cover missing descriptions, retired keys such
  as `infer` and chat modes, invalid skill names, unknown handoff targets, oversized agent
  bodies and broken links. Quick fixes are offered where possible. Disable it with
  `bcAlm.validation.enabled`.
- **Review This Customization with Copilot** opens Copilot Chat with a review prompt grounded in
  the best-practices guide.
- **Save to My Template…** publishes a project component to a template source:
  - **Overwrite** the component with the same name, or **Save as new** under another name (files
    and references are renamed).
  - Project values are turned back into the template's placeholders, e.g. your prefix becomes the
    template prefix and project-only tools are removed. You get a diff to confirm first.
  - Delivery is either a **direct commit** or a **pull request** on the template repository.
- **Contribute to Source Template (Pull Request)…** does the same against the upstream template
  so improvements can flow back. If you can't push to it, your existing fork is used, or one is
  created. If you own the upstream, the branch is pushed there directly.

## Guidance and what's new

The **Guidance & What's New** view combines:

- **Best practices**: a curated guide shipped with the extension (custom agents, agent skills,
  prompt files, instructions, MCP, tool scoping, model choice), with links to the official docs.
- **Template changes**: the commit log of each template source since your locked commit, so you
  can see *why* something changed before updating.
- **Copilot updates**: entries from the GitHub Changelog feed filtered by `bcAlm.whatsNew.keywords`.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `bcAlm.templateSources` | upstream template @ `main` | Template repositories (git URL or local path), refs and optional `upstream` to sync from. |
| `bcAlm.checkForUpdatesOnStartup` | `true` | Fetch sources and compute status when a project opens. |
| `bcAlm.fetchIntervalMinutes` | `60` | Minimum time between automatic fetches. |
| `bcAlm.powershellPath` | auto | PowerShell used for project creation. |
| `bcAlm.validation.enabled` | `true` | Live diagnostics for customization files. |
| `bcAlm.whatsNew.feedUrl` / `keywords` | GitHub Changelog (Copilot) | What's New feed and filter. |

## Command line and CI parity

You don't need the extension to benefit from the lock and policy:

```powershell
pwsh ./scripts/Update-FromTemplate.ps1 -WhatIf              # preview
pwsh ./scripts/Update-FromTemplate.ps1                      # apply; edited files are kept and listed
pwsh ./scripts/Update-FromTemplate.ps1 -OverwriteLocalChanges  # take the template version everywhere
```

The script reads the same `template.lock.json` and `components` policy, re-applies your values,
skips disabled and keepLocal components, keeps files you edited (and reports them), and writes
the new baseline into the lock. It never deletes files removed upstream; it only lists them.

## Developing the extension

```powershell
cd vscode-extension
npm ci
npm test          # compile + unit and integration tests (node:test)
npm run package   # build the .vsix
```

Press **F5** with the `vscode-extension` folder open to launch an Extension Development Host.
The engine lives in `src/core/` and has no `vscode` imports, so it can be tested with plain
Node. The UI (tree views, commands, wizards, diagnostics) is in `src/ui/`. CI is
[`.github/workflows/vscode-extension.yml`](../.github/workflows/vscode-extension.yml). It
builds and tests every change, and attaches the VSIX to a GitHub release when you push an
`ext-v*` tag.
