---
description: "AL coding rules for the BC29 online apps of your-organization. Use when writing or changing AL code in al/."
applyTo: "al/**/*.al"
---

# AL rules for BC29 (AL), online

## Structure

- One app per folder in `al/`, each with `app.json`. Subfolders per object type or feature area (e.g. `Tables/`, `Pages/`, `Codeunits/`, `Upgrade/`).
- File names: `<ObjectName>.<ObjectType>.al`, e.g. `CreditLimitCheck.Codeunit.al`.
- Object IDs within 50000..99999. Converted objects keep their original IDs.
- Affix `CCO` on new objects, and on fields, actions, procedures and controls added to standard objects.

## Rules

- No modification of standard objects: use table/page/report extensions, event subscribers and interfaces.
- Data-carrying tables and fields keep their IDs, names and data types from the source; changing them loses data.
- Subscribe only to events verified in the symbols or on Microsoft Learn. Missing events are recorded in `docs/runbooks/conversion-log.md`, not worked around by copying standard code.
- `DataClassification` on every table field; `ApplicationArea` and `ToolTip` on every page field and action.
- Labels for user-facing text (`Label` with `Comment` for placeholders); no hard-coded strings in `Error`/`Message`.
- No obsolete APIs: fix `AL0432`-type warnings instead of suppressing them.

## Online (BC29 SaaS)

- `"target": "Cloud"` in `app.json`. No `DotNet`, `Automation`, `File`, `[Scope('OnPrem')]` or OnPrem-only methods.
- Files: `InStream`/`OutStream`, `TempBlob`, `UploadIntoStream`/`DownloadFromStream`, or document storage via APIs.
- Integrations: `HttpClient` with OAuth, web services and APIs; background work with job queue entries.
- Permission sets for every new object; no reliance on SUPER.

## Upgrade code

- Upgrade codeunits (`Subtype = Upgrade`) in `Upgrade/`, guarded by upgrade tags so they run once. Never `Commit` in upgrade triggers.
