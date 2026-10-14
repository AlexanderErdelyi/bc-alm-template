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

Install **BC ALM** from the
[Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=AlexanderErdelyi.bc-alm),
either way:

- in the Extensions view, search for **BC ALM**;
- or from a terminal: `code --install-extension AlexanderErdelyi.bc-alm`.

**Fallback (offline, or a specific build):** install the VSIX instead.

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

- **Company template**: **Copy a Template into My Own Repository…** creates your own copy of a GitHub
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

## Working with several templates

A project can take components from more than one template, for example the BC ALM lifecycle
agents and a colleague's BC upgrade agents and skills.

**Template identity.** Each template repository describes itself in `template.config.json`:

```jsonc
"template": {
  "id": "bc-upgrade",            // stable id used in policies and the lock
  "name": "BC Upgrade",
  "description": "Agents and skills for BC upgrade projects.",
  "version": "1.0.0",
  "icon": "arrow-up"
}
```

If a source has no `template` block, the repository name is used as its id.

**Grouped Components view.** When more than one template is in use, components are grouped by
template, and project-only files go in a **Local** group. Use the title bar to switch between
**Group Components by Template** and **Group Components by Kind**.

**Turn templates on and off.** On a template node:
- **Disable Template**: moves all of its components to `.bc-alm/disabled/`, keeping your edits.
- **Enable Template**: restores them.
- **Activate Only This Template**: for example, only the upgrade agents during an upgrade
  project.

**Switch Active Templates…** (also in the status bar) toggles several templates at once. The
choice is stored in `values.sync.templates.disabled` and honored by `Update-FromTemplate.ps1`
and the template-sync Action.

**Choose what you take from each source.** **Choose Components…** on a source lists everything
it offers:
- Dependencies of the components you pick are added automatically.
- Components you deselect are disabled.
- Components you leave out are recorded as `exclude` on the source in the lock, so they don't
  keep showing up as new.

**Create a new template.** **Create New Template…** in the Template Sources view first asks
where the template should live:
- **In a catalog repository** (e.g. this one): the template goes into `.templates/<id>/` of an
  existing repository and is delivered as a commit or a pull request. See
  [Template catalogs](#template-catalogs-variants-and-versions).
- **In a new GitHub repository**, with three starting points:
  - **Blank**: the folder structure, a README and a `template.config.json` with your identity.
  - **Seed from this project**: pick components from your project. Your project values are
    turned back into placeholders.
  - **Copy an existing template**: copies the repository with its history under a new identity.
    This never forks, so it also works when you own the original.

  The repository is created on GitHub with `gh`, pushed, and added as a template source.

**Share with your team.**
- Commit `.bc-alm/template.lock.json`. It records every source (URL, ref, id, exclusions), so
  colleagues get the same templates.
- **Add This Project's Sources to My Settings** adds those sources to a colleague's
  `bcAlm.templateSources`.
- **Share Template Sources with My Team…** copies a `bcAlm.templateSources` snippet, or writes it
  to the workspace settings (`.vscode/settings.json`).

**Source actions.**
- **Change Version / Branch…**: follow `latest`, pin a released version, or track a branch.
- **Open Template Repository**: opens the repository on GitHub.
- Error badges explain whether a source failed because of access, a bad ref or the network.

## Template catalogs, variants and versions

One repository can hold several templates, so a team shares a single **catalog** instead of a
repository per template. This repository is one: the root template `bc-alm` plus
[`.templates/<id>/`](https://github.com/AlexanderErdelyi/bc-alm-template/blob/main/.templates/README.md) folders such as the `bc-alm-lite` variant.

```text
template.config.json        root template (id "bc-alm")
.github/agents|skills|...   root template components
.templates/
  bc-alm-lite/              template.config.json (+ README.md, CHANGELOG.md, own components)
  bc-upgrade/
```

**Use templates from a catalog.** The Template Sources view groups sources by repository.
- **Add Template Source…** lists the templates of the repository and adds the ones you pick, each
  as its own source with a `path` (`.templates/<id>`).
- **Browse Templates…** on a repository shows every template, including ones you haven't added
  yet. From there you can **Use in This Project**, **Add to My Sources**, **Preview Components**
  or **Open README**.
- **Contribute…** and **Save to My Template…** also offer catalog templates you haven't added.

**Add a template to a catalog.** **Add New Template to This Repository…** on a repository node
starts blank, seeded from your project, or as a variant:
- It checks that the id is unique and asks for **maintainers**, who review future pull requests.
- It writes `.templates/<id>/` with `template.config.json`, `README.md` and `CHANGELOG.md`, and
  delivers it as a direct commit, or as a pull request (through a fork if you can't push).
- After a PR you can **Try It Now** from the PR branch, or add it after the merge.

**Variants.** A variant reuses another template of the same repository and stores only what it
changes:

```jsonc
"template": {
  "id": "bc-alm-lite",
  "name": "BC ALM Lite",
  "version": "0.1.0",
  "extends": "bc-alm",                                     // base template (same repository)
  "remove": ["agent:bc-deploy", "skill:bc-ship-release"]   // base components left out
}
```

- Files in the variant folder add components or replace a base component as a whole.
- Without its own `values`, the variant inherits the base's placeholders.
- Base changes flow through automatically.
- In the Components view, overridden components show **variant override**, or **base changed**
  when the base moved on since. **Compare with Base Template** opens the diffs.
- **Create Variant…** builds one: pick the base, the components to override (from the base or
  from your project's version), and the components to remove.

**Versions.** Each catalog template is versioned on its own with tags `<id>/v<semver>` (for
example `bc-alm-lite/v0.1.0`).
- **Release Version…** (maintainers) does the release:
  - shows the commits since the last tag and suggests the bump from conventional commits;
  - updates `template.version` and `CHANGELOG.md`;
  - creates the tag.
  With pull-request delivery, run it again after the merge to tag.
- **Change Version / Branch…** sets what a source follows:
  - `latest`: the newest release;
  - a pinned `<id>/vX.Y.Z`: the source shows **vX.Y.Z available** and offers **Upgrade to
    Newest Version**;
  - a branch.
- `Update-FromTemplate.ps1 -Branch latest` resolves `latest` the same way, and
  `-TemplatePath .templates/<id>` selects the template.

**Contribution checks.** In this repository, the `template-validate` workflow checks every pull
request that touches templates:
- manifests: the id equals the folder, ids are unique, versions are semver, `extends` and
  `remove` targets exist, and there are no cycles;
- every agent, skill, prompt and instruction, with the extension's validator;
- a changed `.templates/<id>/` bumps its version and adds a `CHANGELOG.md` section.

`.github/CODEOWNERS` routes reviews to each template's maintainers. Run the same check locally
with `node vscode-extension/out/src/cli/validate.js --root . --base origin/main`.

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
  created. If you own the upstream, the branch is pushed there directly. For catalog templates it
  also proposes a version bump with a changelog entry and requests the template's maintainers as
  reviewers. When the component belongs to another template of the same repository, you choose
  to **Copy** it or **Move** it.

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
| `bcAlm.components.groupBy` | `auto` | Group components by `template`, by `kind`, or `auto` (by template when more than one is in use). |
| `bcAlm.checkForUpdatesOnStartup` | `true` | Fetch sources and compute status when a project opens. |
| `bcAlm.fetchIntervalMinutes` | `60` | Minimum time between automatic fetches. |
| `bcAlm.powershellPath` | auto | PowerShell used for project creation. Machine-scoped: user settings only, never from a repo's workspace settings. |
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
builds and tests every change. On an `ext-v*` tag it creates a GitHub release and publishes
to the Marketplace (see [Releasing](#releasing-to-the-marketplace)).

### Releasing to the Marketplace

1. **Bump the version** in `vscode-extension/package.json`:
   - `npm version X.Y.Z --no-git-tag-version` in `vscode-extension/`;
   - this also updates the lockfile.
2. **Rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD`** in `vscode-extension/CHANGELOG.md`
   ([Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format), and add a new empty
   `## [Unreleased]` above it. That section becomes the GitHub release notes.
3. **Run the [smoke test](#pre-release-smoke-test)** on the PR's VSIX, then merge the PR.
4. **Tag `main` and push the tag:**

   ```powershell
   git checkout main; git pull
   git tag ext-vX.Y.Z; git push origin ext-vX.Y.Z
   ```

5. **Approve the deployment.**
   - The run waits at the `publish` job.
   - Open **Actions → the run → Review deployments**, tick `marketplace` and approve.
   - The Marketplace listing updates within a few minutes.

What the workflow guarantees:

- **Version guard:** the tag must be `ext-v<package.json version>`. A mismatch (or any other
  tag shape) fails in the build job, before anything is released or published.
- **Exactly the tested VSIX is published.** The publish job reuses the build artifact; it does
  not rebuild.
- **Pre-releases:** tag `ext-vX.Y.Z-pre`.
  - The VSIX is packaged and published with `--pre-release`, and the GitHub release is
    marked as a pre-release.
  - Keep `package.json` at `X.Y.Z`: the Marketplace doesn't accept semver suffixes.
  - A version can't be published twice. The usual convention is odd minor versions for
    pre-releases (`0.5.x`) and even ones for stable (`0.6.x`).
- **Open VSX:**
  - Published too when the `marketplace` environment has an `OVSX_PAT` secret.
  - Otherwise the step is skipped with a warning.
- **Secrets:**
  - `VSCE_PAT` / `OVSX_PAT` live only in the `marketplace` environment.
  - That environment requires a reviewer and only accepts `ext-v*` tags.
  - The tokens are passed as environment variables, never on a command line.

**If publishing fails after the GitHub release was created:**
- Fix the cause, for example an expired PAT (renew it and update the secret).
- Then **Re-run failed jobs** on the same run.
- Don't push a new tag for the same version.

### Pre-release smoke test

Run this before every Marketplace release. Use a clean profile, so that no settings, other
extensions or cached template mirrors hide first-run problems.

```powershell
cd vscode-extension
npm run package                                   # or download bc-alm.vsix from the CI run
code --profile "BC ALM Smoke" --install-extension .\bc-alm-<version>.vsix
code --profile "BC ALM Smoke" C:\temp\bc-alm-smoke  # an empty folder
```

Record the OS, VS Code version and extension version, then tick each item:

- [ ] **Install:**
  - [ ] The BC ALM view appears in the Activity Bar.
  - [ ] The icon and preview badge show on the extension page.
  - [ ] The BC ALM output channel shows no errors.
- [ ] **Restricted Mode:** open the folder untrusted. BC ALM is disabled and explains why.
  Trusting the folder enables it.
- [ ] **No folder open:** run commands from a window with no folder. You get a readable "open a
  project first" message, not a stack trace.
- [ ] **Missing tools:**
  - [ ] With `gh` removed from PATH, run **Contribute to Source Template**. You get a message
    with the https://cli.github.com link.
  - [ ] Do the same with `git` missing: the message links https://git-scm.com.
- [ ] **New Project from Template…** with the default source, signed in as a GitHub user with
  **no write access** to the template. The project is created and initialized.
- [ ] **Components view:**
  - [ ] Check for Template Updates.
  - [ ] Compare with Template.
  - [ ] Update from Template.
  - [ ] Skip This Update.
  - [ ] Reset to Template Version.
  - [ ] Merge Template Changes (3-way).
  - [ ] Disable Component, then Enable Component.
  - [ ] Always Keep My Version, then Resume Template Sync.
  - [ ] Choose Components…
  - [ ] Group by Kind / Template.
- [ ] **Sources view:**
  - [ ] Add Template Source… and Browse Templates…
  - [ ] Change Version / Branch…
  - [ ] Set as Primary Source.
  - [ ] Remove Template Source.
  - [ ] Share Template Sources with My Team…
  - [ ] Add This Project's Sources to My Settings.
- [ ] **Authoring:**
  - [ ] New Agent / Skill / Prompt / Instruction…
  - [ ] Validate Copilot Customizations: findings appear in Problems.
  - [ ] Review This Customization with Copilot.
- [ ] **Contribute and own templates** (as a user without write access):
  - [ ] Contribute to Source Template offers a **fork-based** pull request.
  - [ ] Copy a Template into My Own Repository…
  - [ ] Save to My Template…
  - [ ] Pull Upstream Updates into My Template.
- [ ] **Catalogs:**
  - [ ] Create New Template… and Create Variant…
  - [ ] Release Version…
  - [ ] Upgrade to Newest Version.
  - [ ] Switch Active Templates…
- [ ] **Existing repo:**
  - [ ] Add BC ALM to This Repository…
  - [ ] Record Template Baseline.
  - [ ] Move BC ALM Files into .bc-alm/
- [ ] **Guidance:**
  - [ ] Open Best-Practices Guide.
  - [ ] Refresh What's New.
  - [ ] Open Link.
- [ ] **Output channel:** no tokens or `user:password@` URLs anywhere in the BC ALM log.

Repeat on Linux or in a Codespace when possible (PowerShell 7 required for project creation).
Post the results on the release issue.
