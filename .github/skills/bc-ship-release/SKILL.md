---
name: bc-ship-release
description: "Composes a Business Central release branch from selected merged features and guides deployment to TEST and PROD. Use when: compose a release branch, build a release wave, deploy to TEST, deploy to PROD, cut a release, select features for a wave, BC Admin Center deployment, hotfix deployment."
---

# BC · Ship a Release

Compose a `release/*` branch from a chosen set of merged features and guide deployment. Core
procedure of the **`bc-deploy`** agent. **Selective deployment** is the point: not every
merged feature has to go into the same wave.

## 1 — List merged features
List PRs merged to `main` since the last release tag. For each: ticket ID, description, merge
date, and whether `docs/functional/ABC-{ID}-*.md` exists.

## 2 — Select features for the wave
Ask the user which merged features to include (numbered list). Do not assume "all".

## 3 — Verify readiness (per feature)
- [ ] Spec folder exists with all 4 documents.
- [ ] Feature PR merged (not just open).
- [ ] No open blockers on the PR.
- [ ] `app.json` version correct.
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

## Hotfixes
Branch from `main` (not a release branch); merge the fix to `main`; deploy to PROD directly;
backport to any active `release/*` via cherry-pick if TEST needs it too.

## ADO status map

| Stage | ADO status |
|---|---|
| Release composed | Testing |
| Deployed to TEST | In Test |
| Customer approved | Approved |
| Deployed to PROD | Done / Closed |
