# Changelog

## 0.4.1 — Marketplace preparation

- New extension icon and Marketplace metadata (keywords, links, banner). The extension is
  marked as a **preview**. (#76)
- The publisher ID is now `AlexanderErdelyi`, matching the Visual Studio Marketplace publisher.
  (#76)
- BC ALM runs only in **trusted** workspaces and is disabled in Restricted Mode and virtual
  workspaces, because it runs git, the GitHub CLI and PowerShell. (#76)

## 0.4.0 — Template catalogs, variants and versions

- **Template catalogs**: a repository can hold several templates, the root template plus one
  `.templates/<id>/` folder each. Every template is its own source (`path` in
  `bcAlm.templateSources` and in the lock). `Update-FromTemplate.ps1` takes `-TemplatePath`. (#67)
- **Catalog sources**:
  - The Template Sources view groups sources by repository.
  - **Add Template Source…** lists the repository's templates and adds the ones you pick.
  - **Browse Templates…** offers Use in This Project, Add to My Sources, Preview Components and
    Open README. (#68)
- **Add New Template to This Repository…**: blank, seeded from your project, or a variant.
  - It is delivered as a direct commit or as a pull request, through a fork if needed.
  - After a pull request you can **Try It Now** from the PR branch.
  - **Create New Template…** first asks for the location: a catalog or a new repository. (#69)
- **Contributing to a catalog**:
  - **Contribute…** and **Save to My Template…** offer catalog templates you haven't added.
  - They propose a version bump with a changelog entry and request the template's maintainers
    as reviewers.
  - They offer to copy or move a component between templates of the same repository. (#70)
- **Variants**: `extends` and `remove` in the template block.
  - Files in the variant folder replace whole components; values are inherited from the base.
  - The Components view marks **variant override** and **base changed**.
  - New commands: **Compare with Base Template** and **Create Variant…**. (#71)
- **Versions**: per-template tags `<id>/vX.Y.Z`.
  - **Release Version…** suggests the bump from conventional commits, updates the version and
    changelog, and creates the tag.
  - Sources can follow `latest`, a pinned version, or a branch; **Change Version / Branch…**
    switches between them.
  - Pinned sources show "vX.Y.Z available", with **Upgrade to Newest Version**.
  - `Update-FromTemplate.ps1 -Branch latest` works too. (#72)
- **This repository is a catalog**:
  - `.templates/README.md`;
  - the `bc-alm-lite` example variant;
  - `.github/CODEOWNERS` and a template contribution PR template;
  - the `template-validate` workflow, backed by the new `out/src/cli/validate.js` CLI
    (manifests, `extends`/`remove`, customization files, version bump and changelog). (#73)
- **Distinct icons**:
  - Add Template Source: plug
  - Create New Template: new folder
  - Use in This Project: arrow
  - Browse Templates: library
  - Create Variant: branch
  - Release Version: tag
  - Upgrade to Newest Version: arrow up
  - Change Version / Branch: versions (#74)

## 0.3.0 — Multi-template management

- **Template manifests**: a template repository can describe itself in a top-level `template`
  block in `template.config.json` (`id`, `name`, `description`, `version`, `icon`). Sources
  without one fall back to the repository name. (#58)
- **Components grouped by template**: the Components view groups components by template, plus
  a **Local** group for project-only files. Switch with **Group Components by Template/Kind**
  or `bcAlm.components.groupBy`. (#59)
- **Turn a whole template on or off**: **Disable Template**, **Enable Template**, **Activate
  Only This Template** and **Switch Active Templates…** (also from the status bar). Disabled
  templates are stored in `values.sync.templates.disabled` and honored by
  `Update-FromTemplate.ps1`. Your edits are kept, as with single components. (#60)
- **Choose Components…** per source: pick what you take from each template. Dependencies are
  added automatically, and components you left out are recorded as `exclude` in the lock, so
  they don't show up as new again. (#61)
- **Create New Template…**: a blank template, one seeded from this project's components (project
  values are turned back into placeholders), or a copy of an existing template under a new
  identity. The repository is created on GitHub and added as a source. (#62)
- **Template Sources view**:
  - shows the template name, the ref and "n components · m installed";
  - classifies errors (no access, bad ref, network);
  - adds **Change Branch/Tag…** and **Open Template Repository**;
  - offers **Choose Components…** after **Use in This Project**.
  "Create Template" is now **Copy a Template into My Own Repository…**. (#63)
- **Team sharing**: **Share Template Sources with My Team…** copies a settings snippet or saves
  it to workspace settings. **Add This Project's Sources to My Settings** picks up the sources
  recorded in a teammate's `.bc-alm/template.lock.json`. (#64)

## 0.2.2

- Fixed: Publish / Contribute Upstream no longer fails with `EPERM` on Windows when removing its
  temp clone. Git pack files are read-only, and cleanup now retries and never hides the real
  result. Leftover work folders older than a day are removed on startup. (#56)
- Fixed: **Create Template** no longer fails with "cannot be forked" when you own the upstream.
  You can now pick the owner (you or one of your orgs). Options:
  - Fork, or reuse your existing fork.
  - Duplicate, which keeps history and records `upstream`.
  - Independent copy. (#57)
- Contribute Upstream reuses your existing fork when the direct push is rejected, and explains
  when you own the upstream instead of trying to fork it. (#57)
- **Sync from Upstream** works for duplicates as well as forks. It merges with git and opens a
  `bc-alm/upstream-sync-*` branch and pull request when there are conflicts. Copies without
  shared history get a clear message. (#57)

## 0.2.1

- Projects are found when the workspace only opens subfolders of the repository, for example a
  `.code-workspace` with `app/` and `test/`. The extension walks up to the git root to find
  `.bc-alm/`, and adding `.bc-alm/` itself as a workspace folder no longer treats it as the
  project root. Config and lock changes outside the workspace folders are watched too.
- `PROJECT.md` no longer shows the template's GitHub slug as the repository for Azure DevOps
  projects.

## 0.2.0

- Template bookkeeping now lives in `.bc-alm/`: config, lock, `PROJECT.md`,
  `.templatesyncignore` and template scripts. Root-layout projects are migrated automatically, or
  with **Move BC ALM Files into .bc-alm/**.
- Add BC ALM to This Repository:
  - targets the git root, not the selected workspace folder;
  - prefills name, publisher, ID range, prefix, work-item system and ADO/GitHub details from
    `app.json`, AppSourceCop and the git remote;
  - no longer overwrites existing files, and lists the `*.template` files to merge;
  - components you ticked are installed and show as up to date, not "available".
- Fixed: template files were skipped when the temp folder resolved to a Windows short (8.3) path.
- Fixed: the initializer no longer rewrites the template scripts and the sync workflow guard with
  project values. Previously the first sync after initializing a GitHub project dropped the `#`
  link conversion.

## 0.1.0

Initial release.

- New project from template and add BC ALM to an existing repository. Both run the template's
  PowerShell initializers.
- Components view with lock-based status, update, 3-way merge, keep mine, reset, install,
  disable/enable and keep-local.
- Template sources: multiple sources, per-component source, create your own template (fork or
  copy), fork sync.
- Save to my template (overwrite / save as new; direct commit / pull request) and contribute
  upstream.
- Scaffolds, live validation with quick fixes, Review with Copilot.
- Guidance & What's New view.
