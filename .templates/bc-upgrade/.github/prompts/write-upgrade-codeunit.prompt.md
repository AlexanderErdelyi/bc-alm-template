---
description: "Write an upgrade codeunit for a data transformation in the BC14 → BC29 data upgrade."
argument-hint: "Table/field and the transformation"
---

Write an upgrade codeunit for `${input:transformation:Table, field and transformation}`.

1. Check the transformation in the ownership map of `docs/runbooks/data-upgrade-plan.md`; add it there if missing.
2. Create or extend the upgrade codeunit (`Subtype = Upgrade`) in `al/<app>/Upgrade/`:
   - `OnUpgradePerCompany` (or `OnUpgradePerDatabase` for system data) calls one local procedure per transformation.
   - Each procedure checks and sets an upgrade tag (`Upgrade Tag` codeunit, tag `<AFFIX>-<id>-<yyyymmdd>`) and registers it in `OnGetPerCompanyUpgradeTags`/`OnGetPerDatabaseUpgradeTags`.
   - Use `DataTransfer` for bulk copies between tables/fields where possible; loop with `Modify` only when logic is needed.
   - No `Commit`, no UI, no `Error` for expected data issues – log them.
3. Describe how to validate the result after a rehearsal (record counts, sample checks) in the plan.
