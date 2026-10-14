# Changelog

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
