---
name: inventory
description: "Object inventory and blocker scan of the BC14 (C/AL) exports of your-organization. Use when: analyse the export, inventory customizations, which objects are modified, count custom objects, find DotNet / Automation / file system usage, scan for BC29 blockers, size the upgrade."
---

# Inventory

A deterministic, reproducible inventory of the source application, so that every later phase works from facts instead of reading huge exports.

## Inputs

| Input | Location |
|---|---|
| Customer application (BC14 CU14 DE) | `source/customer/` |
| Standard application, same version and localization | `source/base/` |
| Add-on exports | `source/addons/<vendor>/` |
| Record counts (optional) | `source/usage/` |

How to export: `source/README.md`. Without the base export, modified standard objects can only be estimated – say so in every result.

## Procedure

1. **Check inputs.** If `source/customer/` is empty, stop and point to `source/README.md`.
2. **Get the inventory.** BC Upgrade Pilot writes it to `.bcupgrade/cache/inventory/`:
   - `objects.csv` – `Kind, Type, Id, Name, Scope, Modified, VersionList, CustomTags, CustomFields, Procedures, Changes, Lines, Findings, File, StartLine, EndLine`
   - `findings.csv` – `Type, Id, Name, RuleId, Severity, Category, File, Line, Text`
   - `summary.md` – generated totals

   If the folder is missing, ask the user to run the BC Upgrade Pilot inventory. If that is not available, write a deterministic script in `work/` that produces the same columns – never count or classify objects by reading them in chat.
3. **Isolate real customizations** when the base export exists: compare base and customer exports (`Compare-NAVApplicationObject` in the BC14 development shell, after `Split-NAVApplicationObjectFile`) into delta files in `work/delta/`. Delta findings are far more precise for modified standard objects, because full objects also contain Microsoft code.
4. **Read `summary.md`, then query the CSVs** – never load them fully into context:
   ```powershell
   Import-Csv .bcupgrade/cache/inventory/objects.csv | Where-Object Scope -ne 'StandardUnmodified' | Sort-Object { [int]$_.Findings } -Descending | Select-Object -First 30 Type,Id,Name,Lines,CustomFields,Findings
   Import-Csv .bcupgrade/cache/inventory/findings.csv | Where-Object Severity -eq 'Blocker' | Group-Object Type,Id,Name | Sort-Object Count -Descending
   ```
5. **Identify customization areas.** Group relevant objects by Version List tag (`CustomTags`), then by name prefix or domain. Each group is a candidate extension.
6. **Identify add-ons** (`Scope = ThirdParty`, ID ranges). For each, ask whether the vendor has a BC29 online (AppSource) version – those are `ISV`, not `CONVERT`.
7. **Write `docs/assessment/inventory.md`**: export source and date, localization, counts per scope, customization areas (group → object count), add-on ranges, blocker totals, open questions.

## Severities

`Blocker` (cannot run on BC29 online), `Rework` (must be rewritten), `Review` (manual check), `Info`.

## Rules

- Open an object only by its line range (`File`, `StartLine`, `EndLine`).
- Never modify `source/` or `.bcupgrade/`.
- Add missing scan rules to the tool or script, not as ad-hoc searches, so results stay reproducible.
