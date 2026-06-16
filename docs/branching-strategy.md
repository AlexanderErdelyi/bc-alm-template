# Branching Strategy

This document defines the Git branching model for BC ALM template repositories. It is opinionated and designed specifically for Microsoft Dynamics 365 Business Central Per-Tenant Extensions (PTEs) where selective deployment is a core requirement.

---

## Core Principle: Selective Deployment

The biggest practical challenge in BC development is that not all features are ready to ship at the same time. You might have five features in development, but only three are approved by customers for the next wave. If you use a shared `develop` branch, all five features are merged together — you cannot ship three without shipping all five.

**This is why we do not use Git Flow.**

Instead, this strategy is based on:
- Feature branches cut directly from `main`
- Release branches composed selectively from specific feature merges
- `main` is always production-ready

---

## Why Not Git Flow?

Git Flow uses a permanent `develop` branch where all features merge. The problems with this for BC:

| Problem | Why it hurts BC teams |
|---|---|
| All features merge to `develop` together | Can't ship ABC-123 without ABC-124 if they're both merged |
| `develop` may be unstable | TEST deployments from `develop` reflect everything, not a curated selection |
| Long-lived `develop` branch causes conflicts | Multiple developers working on AL objects in the same module |
| Doesn't map to BC environment model | DEV/TEST/PROD doesn't map cleanly to feature/develop/main |

The alternative: each feature branch is independent, and release branches are **assembled** from the features you choose.

---

## Branch Types

### `main`

- **Purpose:** Production-ready code at all times
- **Represents:** PROD environment
- **Protection:** Branch protection rules — no direct pushes, PR required, at least 1 approver
- **What merges here:** Feature branches, after customer approval and docs are complete
- **Never:** Force push, bypass protection, commit directly

### `feature/ABC-{ID}-short-description`

- **Purpose:** Development of a single ADO work item
- **Cut from:** `main` (always fresh from production baseline)
- **Represents:** DEV environment (deployed to a developer sandbox for local testing)
- **Naming:** `feature/ABC-123-payment-tolerance`
- **Lifetime:** Created when spec is approved, deleted after merging to `main` post-PROD deployment
- **Who creates it:** Developer (Stage 4 of the workflow)

### `bugfix/ABC-{ID}-short-description`

- **Purpose:** Non-critical bug fix, follows same process as feature
- **Cut from:** `main`
- **Naming:** `bugfix/ABC-456-posting-date-error`

### `hotfix/ABC-{ID}-short-description`

- **Purpose:** Critical production bug requiring immediate fix
- **Cut from:** `main` (from the production tag if needed)
- **Naming:** `hotfix/ABC-789-vat-crash`
- **Fast track:** Can bypass some stages (spec may be minimal, documentation follows deployment)
- **Warning:** Hotfixes still require a PR and reviewer approval — speed does not mean skipping quality gates

### `release/YYYY-MM-wave-N`

- **Purpose:** Testing candidate for a specific deployment wave
- **Cut from:** `main` + merged with selected feature branches
- **Represents:** TEST environment
- **Naming:** `release/2025-06-wave-1`, `release/2025-06-wave-2`, `release/2025-07-wave-1`
- **What it contains:** Only the features approved for this wave
- **Never merges back to main** — each feature merges to main individually after PROD approval

---

## Branch Naming Conventions

| Type | Pattern | Example |
|---|---|---|
| Feature | `feature/ABC-{ID}-kebab-description` | `feature/ABC-123-payment-tolerance` |
| Bug fix | `bugfix/ABC-{ID}-kebab-description` | `bugfix/ABC-456-posting-date-error` |
| Hotfix | `hotfix/ABC-{ID}-kebab-description` | `hotfix/ABC-789-vat-crash` |
| Release | `release/YYYY-MM-wave-N` | `release/2025-06-wave-1` |

Rules:
- Always include the ADO ticket ID
- Use kebab-case (lowercase, hyphens)
- Keep descriptions short (3-5 words)
- Use the month of the planned deployment in release branches, not the development month

---

## Environment Mapping

```
DEV       →  feature/* branches        (developer sandbox)
TEST      →  release/* branches        (shared test environment)  
PROD      →  main branch               (production)
```

Deployments:
- `feature/ABC-123-payment-tolerance` → Developer's personal sandbox (via AL-Go or manual publish)
- `release/2025-06-wave-1` → TEST environment (via AL-Go pipeline or BC Admin Center API)
- `main` → PROD environment (via BC Admin Center API, after approval)

---

## Selective Deployment: How Release Branches Work

The key differentiator of this model. Say you have three completed features:
- `feature/ABC-100-new-payment-field` — customer approved ✅
- `feature/ABC-101-vat-report` — customer approved ✅
- `feature/ABC-102-inventory-module` — still in testing ❌

You want to deploy ABC-100 and ABC-101 to TEST, but NOT ABC-102.

### Composing `release/2025-06-wave-1`

```bash
# Start from main (production baseline)
git checkout main
git checkout -b release/2025-06-wave-1

# Merge only the approved features
git merge feature/ABC-100-new-payment-field --no-ff
git merge feature/ABC-101-vat-report --no-ff

# Do NOT merge feature/ABC-102 — it's not ready
```

The release branch now contains exactly ABC-100 + ABC-101, deployed to TEST for customer validation.

ABC-102 will be part of `release/2025-06-wave-2` or `release/2025-07-wave-1` when it's ready.

> The **BC Deploy agent** will guide you through this composition and verify that each included feature has an approved spec and merged PR.

---

## Feature Branch Lifetime

```
Spec approved → branch created (from main)
     │
     ▼
Development on feature branch
     │
     ▼
PR merged to main ──────────────────────────────┐
     │                                           │
     ▼                                           │
Branch merged into release/wave-N               │
     │                                           │
     ▼                                           │
Deployed to TEST                                 │
     │                                           │
     ▼                                           │
Customer approved + docs merged                  │
     │                                           │
     ▼                                           │
PROD deployed ◄──────────────────────────────────┘
     │
     ▼
Feature branch deleted (can be archived as tag if needed)
```

**Key:** The feature branch is kept alive until after PROD deployment because it may be needed for reference or re-testing. Delete it only after the full cycle completes.

---

## Branch Protection Rules for `main`

Configure these in GitHub → Settings → Branches → Branch protection rules for `main`:

| Rule | Setting |
|---|---|
| Require a pull request before merging | ✅ Enabled |
| Required approvals | 1 (minimum, recommend 2 for production repos) |
| Dismiss stale pull request approvals when new commits are pushed | ✅ Enabled |
| Require status checks to pass before merging | ✅ Enabled (AL-Go build pipeline) |
| Require branches to be up to date before merging | ✅ Enabled |
| Do not allow bypassing the above settings | ✅ Enabled |
| Restrict who can push to matching branches | Optional — restrict to senior devs |

---

## Relation to AL-Go for GitHub

[AL-Go for GitHub](https://github.com/microsoft/AL-Go) is Microsoft's recommended CI/CD framework for Business Central. This branching strategy is designed to work with AL-Go:

- AL-Go's default workflow triggers on PR to `main` — aligns with our PR-to-main model
- AL-Go build pipelines can be triggered on `release/*` branches for TEST deployments
- The `app.json` version bump requirement aligns with AL-Go's version management
- AL-Go's branch naming conventions (`release/` prefix) are directly compatible

When using AL-Go, configure `AL-Go-Settings.json` to point deployments to the correct BC environments based on branch:
```json
{
  "environments": [
    { "name": "TEST", "branch": "release/*" },
    { "name": "PROD", "branch": "main" }
  ]
}
```

---

## Summary

| Decision | Choice | Reason |
|---|---|---|
| Feature branch base | `main` | Always start from PROD-stable baseline |
| Release branch method | Selective composition | Deploy only approved features |
| `develop` branch | Not used | Prevents selective deployment |
| `main` represents | PROD | Enforced by branch protection |
| `release/*` represents | TEST | One branch per deployment wave |
| Feature branch lifetime | Until post-PROD | Kept for reference/re-test |
