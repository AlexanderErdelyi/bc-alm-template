---
name: bc-ship-release
description: "Composes a Business Central release branch from selected merged features and guides deployment to TEST and PROD; optionally promotes a feature through environment branches (develop, release/UAT, main). Use when: compose a release branch, build a release wave, deploy to TEST, deploy to PROD, cut a release, select features for a wave, promote a feature to UAT, back-merge main, BC Admin Center deployment, hotfix deployment."
---

# BC · Ship a Release

Compose a `release/*` branch from a chosen set of merged features and guide deployment. Core
procedure of the **`bc-deploy`** agent. **Selective deployment** is the point: not every
merged feature has to go into the same wave.

## 0 — Pick the mode
Read `template.config.json` → `values`:

| Setting | Value | Follow |
|---|---|---|
| `branchingStrategy` | `feature-release-selective` (default) | Sections 1–6 + Hotfixes below |
| `branchingStrategy` | `environment-promotion` (optional) | [Environment-promotion mode](#environment-promotion-mode-optional) — reuses 4a for the changelog |
| `versioning` | `manual` (default) | `app.json` version is bumped in each feature PR; verify it in step 3 |
| `versioning` | `pipeline` (optional) | **Never** ask for or make a manual `app.json` bump; the version comes from the pipeline run/tag (see `bc-cicd-pipeline` → `references/versioning.md`) |

Environment names come from `values.environments` and the production branch from
`values.defaultBranch`; TEST/PROD below are examples.

## 1 — List merged features
List PRs merged to `main` since the last release tag. For each: ticket ID, description, merge
date, and whether `docs/functional/ABC-{ID}-*.md` exists.

## 2 — Select features for the wave
Ask the user which merged features to include (numbered list). Do not assume "all".

## 3 — Verify readiness (per feature)
- [ ] Spec folder exists with all 5 story documents.
- [ ] Feature PR merged (not just open).
- [ ] No open blockers on the PR.
- [ ] `app.json` version correct (`versioning: manual` only — with `pipeline`, skip this check).
- [ ] No object-ID collisions between included features.

Block any feature that fails and tell the user why.

## 4 — Compose the release branch

```bash
git checkout main && git pull origin main
git checkout -b release/2025-06-wave-1
git merge feature/ABC-123-payment-tolerance --no-ff -m "feat: include ABC-123 payment tolerance"
git push origin release/2025-06-wave-1
git tag rc/2025-06-wave-1 release/2025-06-wave-1 && git push origin rc/2025-06-wave-1
```

If feature branches were deleted after merge, cherry-pick the merge-commit SHA instead
(`git log --oneline main | grep ABC-123`).

## 4a — Assemble the release changelog (if the repo uses `changelog.d/`)
The customer-facing changelog is built from **fragment files**, not from raw commit subjects.

1. **Read all fragments:** list `changelog.d/*.md` (ignore `README.md`). Parse each one's YAML
   front matter (`workitem`, `type`, `module`) and body (headline + optional detail bullets).
2. **Cross-check** against a git-log fallback:
   ```bash
   git log --pretty=format:"%s" --no-merges <last-tag>..HEAD | grep -oE "#[0-9]+" | sort -u
   ```
   For any ticket id in the log with **no** matching fragment, warn the user and offer to create
   one. If there are **no fragments at all**, fall back to the grouped git-log changelog.
3. **Group** by `type` in Keep a Changelog order — `Added`, `Changed`, `Fixed`, `Deprecated`,
   `Removed`, `Security` — then by `module`, then work item.
4. **Build the version section** and insert it into `CHANGELOG.md` immediately after the
   `## [Unreleased]` block (newest on top):

   ```markdown
   ## [{version}] - {date}

   ### Added
   - **{module}**: {headline} (#{workitem})
     - {detail bullet}

   ### Fixed
   - **{module}**: {headline} (#{workitem})
   ```
5. **Delete the consumed fragments** (`git rm changelog.d/*.md`, keeping only `README.md`) — a
   released fragment must never linger, or it would be double-counted next release.

## 5 — Deploy to TEST
- **AL-Go for GitHub:** push of `release/*` triggers the deployment workflow if configured in
  `.github/AL-Go-Settings.json` (`environments: [{ name: TEST, branch: release/* }]`). Check
  the Actions tab. See [`../../../docs/al-go-upgrade.md`](../../../docs/al-go-upgrade.md).
- **Manual:** build the `.app`, then BC Admin Center → Environments → TEST → Upload Extension.

## 6 — Deploy to PROD (gated)
Prerequisites — **all** must be true:
- [ ] TEST deployment succeeded.
- [ ] Features customer-approved.
- [ ] Functional docs merged for every included feature (else go to **`bc-docs-feature`**).
- [ ] Release notes prepared.

Then tag `v2025-06-wave-1`, deploy to PROD, verify, close ADO tickets, notify the customer.
With `versioning: pipeline` the build already tags the version (`v28.0.5.0`); use that version as
the `{version}` of the changelog section and keep the wave tag only if your team wants both.

## Hotfixes
Branch from `main` (not a release branch); merge the fix to `main`; deploy to PROD directly;
backport to any active `release/*` via cherry-pick if TEST needs it too.

## Environment-promotion mode (optional)
Use only when `branchingStrategy` is `environment-promotion` (see
[`docs/branching-strategy.md`](../../../docs/branching-strategy.md#alternative-environment-promotion)).
There is **no release-branch composition**: one long-lived branch per environment (example names —
`develop` → DEV, `release/UAT` → TEST/UAT, `values.defaultBranch` → PROD) and the **same feature
branch** is promoted by a separate PR into each, gated by testing at each stage.

| # | PR: feature branch → | Environment | Gate before the next PR | PR tier (`bc-ship-pull-request`) |
|---|---|---|---|---|
| 1 | `develop` | DEV | Internal QA passed | Tier A — minimal |
| 2 | `release/UAT` | TEST / UAT | Customer acceptance / sign-off | Tier B — functional (what to test) |
| 3 | `main` | PROD | — (squash merge) | Tier C — technical |

1. **Confirm the previous stage is green.** The feature is merged and deployed to the previous
   environment and its gate passed. If not, stop and route back to `bc-pr` / `bc-dev`.
2. **Open the promotion PR** from the **same** `feature/ABC-{ID}-*` branch into the next environment
   branch (`bc-ship-pull-request` writes the description for that tier). Never PR `develop` →
   `release/UAT` or `release/UAT` → `main`, and never merge an environment branch into the feature
   branch. Conflicts are resolved on a throw-away helper branch (see the branching doc).
3. **Deploy.** The merge triggers the pipeline for that environment (check the Actions / Pipelines
   run), or deploy manually: BC Admin Center → Environments → {environment} → Upload Extension.
   Notify the customer when a feature reaches TEST/UAT.
4. **Before the PR into `main`** — the PROD gate from section 6 applies: TEST/UAT succeeded, customer
   approved, functional docs merged (else **`bc-docs-feature`**), release notes prepared. Assemble the
   changelog from `changelog.d/` exactly as in **4a**, as part of the PROD PR or right after it.
5. **Merge into `main` (squash)** → PROD deployment. With `versioning: pipeline` the production build
   computes and tags the version; do not hand-edit `app.json`. Verify, close the work item, notify
   the customer.
6. **Back-merge `main`** into `release/UAT` and `develop`, then delete the feature branch:
   ```bash
   git fetch origin
   git switch release/UAT && git merge origin/main && git push origin release/UAT
   git switch develop && git merge origin/main && git push origin develop
   ```
7. **Hotfix:** cut `hotfix/ABC-{ID}-*` from `main`, optionally PR it into `release/UAT` to verify,
   PR it into `main` (squash), deploy to PROD, then back-merge as in step 6.

## ADO status map

| Stage | ADO status |
|---|---|
| Release composed | Testing |
| Deployed to TEST | In Test |
| Customer approved | Approved |
| Deployed to PROD | Done / Closed |

In environment-promotion mode: PR merged to `develop` → *In Test (internal)*; PR merged to
`release/UAT` → *In Test (UAT)*; customer approved → *Approved*; PR merged to `main` →
*Done / Closed*. With GitHub Issues, use the equivalent labels or project-board columns.
