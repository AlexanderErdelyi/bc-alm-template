# Changelog

All notable changes to the **BC ALM** extension are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.4.3] - 2026-10-15

### Added

- First public release on the Visual Studio Marketplace, as a **preview**. (#79)

### Changed

- The Marketplace page has been rewritten:
  - getting started, requirements, a command overview and support links;
  - **Install from the Marketplace** is now the main install path. (#78)

## [0.4.2] - 2026-10-15

### Added

- A **Privacy and security** section in the README. (#81)

### Changed

- If git, the GitHub CLI or PowerShell is missing, you now get a message with an install link
  instead of `spawn … ENOENT`. (#81)
- `bcAlm.powershellPath` can only be set in user settings, so a repository's workspace settings
  can't change which program runs. (#81)

### Security

- Tokens and `user:password@` parts of URLs are masked in the output channel, notifications and
  error messages. (#81)
- File writes that would land outside the project folder are refused. (#81)

## [0.4.1] - 2026-10-14

### Added

- New extension icon and Marketplace details (keywords, links, banner). The extension is marked
  as a **preview**. (#76)

### Changed

- The publisher is now `AlexanderErdelyi`. Existing installs update in place. (#76)
- BC ALM runs only in **trusted** workspaces. It is disabled in Restricted Mode and in virtual
  workspaces, because it runs git, the GitHub CLI and PowerShell. (#76)

## [0.4.0] - 2026-10-14

### Added

- **Template catalogs:**
  - One repository can hold several templates: the root template plus one `.templates/<id>/`
    folder each.
  - **Add Template Source…** lists them and adds the ones you pick.
  - **Browse Templates…** offers Use in This Project, Add to My Sources, Preview Components and
    Open README. (#67, #68)
- **Add New Template to This Repository…**:
  - Start blank, seeded from your project, or as a variant.
  - It's delivered as a direct commit or as a pull request, through a fork if needed.
  - After a pull request you can **Try It Now** from the PR branch. (#69)
- **Variants:** a template can extend another one, remove some components and override others.
  - The Components view marks **variant override** and **base changed**.
  - New commands: **Compare with Base Template** and **Create Variant…**. (#71)
- **Versions:**
  - **Release Version…** creates per-template tags (`<id>/vX.Y.Z`) and suggests the bump from
    conventional commits.
  - Sources follow `latest`, a pinned version, or a branch. Switch with **Change Version /
    Branch…**.
  - Pinned sources show "vX.Y.Z available", with **Upgrade to Newest Version**. (#72)

### Changed

- **Contribute…** and **Save to My Template…**:
  - also offer catalog templates you haven't added;
  - propose a version bump with a changelog entry;
  - request the template's maintainers as reviewers. (#70)
- **Create New Template…** first asks where the template goes: a catalog or a new repository.
  (#69)
- Catalog commands have distinct icons. (#74)

## [0.3.0] - 2026-10-14

### Added

- **Template manifests:** a template can describe itself (id, name, description, version, icon)
  in `template.config.json`. (#58)
- **Components grouped by template**, plus a **Local** group for project-only files. Switch with
  **Group Components by Template/Kind** or `bcAlm.components.groupBy`. (#59)
- **Turn a whole template on or off:**
  - **Disable Template**, **Enable Template**, **Activate Only This Template** and **Switch
    Active Templates…** (also from the status bar).
  - Your edits are kept. (#60)
- **Choose Components…** per source:
  - Dependencies are added automatically.
  - Components you left out don't show up as new again. (#61)
- **Create New Template…**: blank, seeded from this project, or a copy under a new identity.
  The repository is created on GitHub. (#62)
- **Team sharing:**
  - **Share Template Sources with My Team…**
  - **Add This Project's Sources to My Settings** (#64)

### Changed

- The Template Sources view now:
  - shows the template name, the ref and "n components · m installed";
  - explains errors (no access, bad ref, network);
  - adds **Change Branch/Tag…** and **Open Template Repository**. (#63)
- "Create Template" is now **Copy a Template into My Own Repository…**. (#63)

## [0.2.2] - 2026-10-14

### Changed

- **Create Template** lets you pick the owner (you or one of your orgs). You can fork (or reuse
  your fork), duplicate with history, or make an independent copy. (#57)
- Contribute Upstream reuses your existing fork when a direct push is rejected. (#57)
- **Sync from Upstream** works for duplicates as well as forks. On conflicts it opens a
  `bc-alm/upstream-sync-*` branch and pull request. (#57)

### Fixed

- Publish / Contribute Upstream no longer fails with `EPERM` on Windows when cleaning up its
  temporary clone. (#56)
- **Create Template** no longer fails with "cannot be forked" when you own the upstream. (#57)

## [0.2.1] - 2026-10-12

### Fixed

- Projects are found when the workspace opens only subfolders of the repository (for example
  `app/` and `test/`).
- `PROJECT.md` no longer shows the template's GitHub slug as the repository for Azure DevOps
  projects.

## [0.2.0] - 2026-10-12

### Changed

- Template bookkeeping now lives in `.bc-alm/` (config, lock, `PROJECT.md`, template scripts).
  Older projects are migrated automatically or with **Move BC ALM Files into .bc-alm/**.
- **Add BC ALM to This Repository…**:
  - targets the git root;
  - prefills values from `app.json`, AppSourceCop and the git remote;
  - no longer overwrites existing files.

### Fixed

- Template files were skipped when the temp folder resolved to a Windows short (8.3) path.
- The first sync after initializing a GitHub project no longer drops the `#` link conversion.

## [0.1.0] - 2026-10-12

### Added

- **Projects:** create a new project from a template, or add BC ALM to an existing repository.
- **Components view:** lock-based status, with:
  - update and 3-way merge;
  - keep mine and reset;
  - install, disable/enable and keep-local.
- **Template sources:** multiple sources, your own template (fork or copy), and fork sync.
- **Sharing:** Save to My Template and Contribute Upstream.
- **Authoring help:** scaffolds, live validation with quick fixes, and Review with Copilot.
- **Guidance & What's New** view.
