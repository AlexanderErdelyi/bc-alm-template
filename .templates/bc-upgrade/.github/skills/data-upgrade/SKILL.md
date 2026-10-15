---
name: data-upgrade
description: "Plans and scripts the data upgrade from BC14 to BC29 for your-organization: data ownership, table migration extension, DestinationAppsForMigration, migration.json, empty apps, upgrade codeunits, runbook, rehearsals. Use when: data upgrade, upgrade codeunit, keep data of custom fields, Start-NAVDataUpgrade, upgrade runbook, table migration extension, txt2al tableDataOnly."
---

# Data upgrade

- **Application upgrade: BC14 (AL) → BC25 (AL)** – BC14 to BC24 upgrade directly to any later version up to BC25.
- **Application upgrade: BC25 (AL) → BC29 (AL)** – Since v26, BC14 to BC24 must upgrade to BC25 first; BC25 and later upgrade directly.

Skip this skill if the route decision in `docs/decisions/` is a reimplementation without data upgrade.

## Prerequisites (record their status in `docs/runbooks/data-upgrade-plan.md`)

- [ ] Source update is compatible with the chosen target update (compatibility matrix on Microsoft Learn).
- [ ] Txt2Al with `--tableDataOnly` (BC14 CU11, 14.0.41862, or later).
- [ ] SQL Server full-text search installed (`SELECT FULLTEXTSERVICEPROPERTY('IsFullTextInstalled')` = 1).
- [ ] SQL Server version and compatibility level supported by the target (cloud migration later needs SQL Server 2016+ and compatibility level 130 or higher).
- [ ] Partner license for the target version.
- [ ] Customization apps compile against every target in the path; table and field IDs unchanged.
- [ ] Permission sets as AL objects (recommended) or XML data – decided.
- [ ] Data encryption disabled or key exported.

## Table migration artifacts (Application upgrade: BC14 (AL) → BC25 (AL))

| Artifact | Location | Content |
|---|---|---|
| Table migration extension v1 | `upgrade/TableMigration/v1/` | Non-system tables from Txt2Al `--tableDataOnly`; old runtime, no dependencies, `"target": "OnPrem"`, only the target System app in `.alpackages` |
| Table migration extension v2 | `upgrade/TableMigration/v2/` | Empty, with `migration.json` app rules for System Application, Business Foundation, Base Application and each customization app that takes ownership of tables or fields (app IDs from the Microsoft article). Keep the temporary-table stubs listed there. |
| Empty apps | `upgrade/Empty/<app>/` | Only `app.json` with the same `id`/`name` as the real app and the old version/runtime, no dependencies |

## Other artifacts

| Artifact | Location | Content |
|---|---|---|
| Upgrade codeunits | `al/<app>/Upgrade/` | Transformations that are not 1:1 (option → enum with changed ordinals, field splits, data moved to standard fields, obsoleted tables) with upgrade tags. Prompt: `write-upgrade-codeunit`. |
| Runbook script | `upgrade/Invoke-DataUpgrade.ps1` | The tasks of the Microsoft article in order, parameterized, one function per task, `-WhatIf` by default |

## Procedure

1. **Map data ownership** from `.bcupgrade/cache/inventory/objects.csv`: custom tables → owning app; custom fields in standard tables → owning `tableextension`; data to drop → in no app. Write the table to `docs/runbooks/data-upgrade-plan.md`.
2. **Find transformations**: compare each owned table and field between source and target definitions (type, length, option values, names). Every difference needs upgrade code or a decision.
3. **Generate the artifacts** above.
4. **Write the runbook** in the task order of the Microsoft article for each hop (for the table migration: convert database → `DestinationAppsForMigration` → license → publish table migration v1 and empty apps → sync → `Start-NAVDataUpgrade` → install empty apps → publish v2, Microsoft and customization apps → sync in dependency order → `Start-NAVAppDataUpgrade` v2 → remove the table migration extension → upgrade/install the final apps → control add-ins → permission sets → `Set-NAVApplication`).
5. **Plan rehearsals**: at least two on a database copy; capture durations and record counts per table before and after (`docs/runbooks/data-upgrade-validation.md`).
6. **Next**: when the on-premises target is reached, continue with skill `cloud-migration`.

## Microsoft Learn

- [Supported upgrade paths to Business Central on-premises](https://learn.microsoft.com/dynamics365/business-central/dev-itpro/upgrade/upgrade-paths)
- [Upgrading Customized C/AL Application to Microsoft Base Application for version 25](https://learn.microsoft.com/dynamics365/business-central/dev-itpro/upgrade/upgrade-to-microsoft-base-app-v25)
- [Upgrading to Dynamics 365 Business Central 2024 release wave 2](https://learn.microsoft.com/dynamics365/business-central/dev-itpro/upgrade/upgrade-overview-v25)
- [Supported upgrade paths to Business Central on-premises](https://learn.microsoft.com/dynamics365/business-central/dev-itpro/upgrade/upgrade-paths)
- [Upgrading to Dynamics 365 Business Central 2026 release wave 2](https://learn.microsoft.com/dynamics365/business-central/dev-itpro/upgrade/upgrade-overview-v29)

## Rules

- Never run the runbook against production without explicit confirmation; default to `-WhatIf`.
- Never change IDs of tables or fields that carry data.
- Check every uncertain cmdlet parameter on Microsoft Learn first.
