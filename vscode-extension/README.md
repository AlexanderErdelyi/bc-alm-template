# BC ALM — Business Central Copilot Template Manager

Manage the [BC ALM template](https://github.com/AlexanderErdelyi/bc-alm-template) in your
Business Central projects: its Copilot agents, skills, prompts, instructions and workflows.

## Features

- **New project / add to existing repo**: guided setup (prefix, object range, repo, Azure
  DevOps or GitHub, content categories) that runs the template's own initializer.
- **Components view**: every agent, skill, prompt, instruction, workflow and doc with its
  status. Statuses: *up to date*, *update available*, *conflict*, *modified*, *custom*, *new*,
  *disabled*.
- **Safe updates**: `template.lock.json` remembers what was installed, so unedited files update
  in one click. Edited files get a **3-way merge**, *keep mine* or *reset*. Your prefix, range,
  models and extra tools are re-applied automatically.
- **Pick what you use**: install, disable, or pin ("always keep my version") individual
  components. The same policy is honored by `Update-FromTemplate.ps1` and the template-sync
  GitHub Action.
- **Your own template**: create a company template, add more template sources, **save** a
  customized component to it (overwrite or save as new; commit or PR), sync it from upstream,
  or **contribute** improvements back upstream. Create Template offers:
  - **Fork**: not possible in the account that owns the upstream. Reuses your existing fork.
  - **Duplicate**: keeps history and the upstream link. Use this when you own the upstream.
  - **Independent copy**: GitHub "Use this template". It shares no history and can't be synced.

  **Sync from Upstream** fast-forwards or merges. On conflicts it pushes a
  `bc-alm/upstream-sync-*` branch and offers a pull request.
- **Authoring help**: scaffolds for new agents, skills, prompts and instructions. Live
  diagnostics with quick fixes based on current GitHub Copilot / VS Code guidance. A
  "Review with Copilot" action.
- **Guidance & What's New**: a curated best-practices guide, the template's change log since
  your version, and Copilot updates from the GitHub changelog.

## Requirements

- `git` on PATH.
- PowerShell 7 (`pwsh`) or Windows PowerShell 5.1, for creating and adding projects.
- Optional: GitHub CLI (`gh`) for pull requests, forks and fork sync.

## Getting started

1. Open the **BC ALM** view in the Activity Bar.
2. Click **New Project from Template…**, or open an existing repo and run **Add BC ALM to This
   Repository…**.
3. In an existing BC ALM project created before the extension, run **Record Template
   Baseline** once.

Full guide: [docs/vscode-extension.md](https://github.com/AlexanderErdelyi/bc-alm-template/blob/main/docs/vscode-extension.md).

## Settings

| Setting | Purpose |
| --- | --- |
| `bcAlm.templateSources` | Template repositories (URL or local path), refs and optional `upstream` to sync from. |
| `bcAlm.checkForUpdatesOnStartup` | Check for template updates when a project opens. |
| `bcAlm.fetchIntervalMinutes` | Minimum minutes between automatic fetches. |
| `bcAlm.powershellPath` | PowerShell executable for project creation. |
| `bcAlm.validation.enabled` | Diagnostics for customization files. |
| `bcAlm.whatsNew.feedUrl` / `bcAlm.whatsNew.keywords` | Copilot updates feed and filter. |
