---
name: cal-to-al-conversion
description: "Converts BC14 C/AL customizations to AL extensions for BC29 online. Use when: run txt2al, convert C/AL to AL, create tableextension/pageextension from delta files, refactor base code modifications to event subscribers, replace DotNet/File/Automation for the cloud, structure extensions, fix compile errors after conversion."
---

# C/AL → AL conversion

Turn the areas decided as `CONVERT` / `REDESIGN` in `docs/assessment/fit-gap.md` into compilable extensions in `al/<app>/`. Work **one area at a time** – pilot first, then scale.

Conversion hop: **C/AL → AL conversion: BC14 (C/AL) → BC14 (AL)**.

## Prerequisites

- The area has an accepted decision in `docs/decisions/`.
- Txt2Al from a C/AL version (it is not shipped with AL-only versions). For `--tableDataOnly` (data upgrade) it must be BC14 CU11 (14.0.41862) or later.
- AL Language extension and symbols for BC29 (sandbox or `.alpackages`: System, Business Foundation where applicable, Base Application, Application).

## Procedure

### 1. Prepare the conversion input

```powershell
# BC14 development shell – one file per object for compare/convert
Split-NAVApplicationObjectFile -Source .\source\customer\all.txt -Destination .\work\split\customer
Split-NAVApplicationObjectFile -Source .\source\base\all.txt -Destination .\work\split\base
Compare-NAVApplicationObject -OriginalPath .\work\split\base -ModifiedPath .\work\split\customer -DeltaPath .\work\delta
```

Copy only the delta and new-object files of the **current area** to `work\convert\<area>\`. Exports for Txt2Al must be in the new syntax (`-ExportToNewSyntax`).

### 2. Run Txt2Al

```cmd
txt2al --source=.\work\convert\<area> --target=.\work\al\<area> --rename --extensionStartId=<free id> --dotNetTypePrefix=BC --format --dataClassificationDefaulting=CustomerContent
```

- Delta files of modified standard objects → `tableextension` / `pageextension`.
- New objects → full AL objects.
- **Code modifications inside standard triggers and functions are not convertible** – redesign them (step 4).

### 3. Create the extension project

`al/<app>/app.json`: `"target": "Cloud"`, `runtime` and `application` matching BC29, `idRanges` (50000..99999), `features: ["NoImplicitWith", "TranslationFile"]`. Copy the generated AL into feature folders.

> Keep **table and field IDs and names identical** to C/AL. The data upgrade moves data by ID; renaming or renumbering loses it.

### 4. Refactor per finding (`findings.csv` of the area)

| Finding | Pattern |
|---|---|
| Base code modification | Find the published event in BC29 (`OnBefore…`/`OnAfter…`, table `OnAfterInsertEvent`, …) and confirm it in the symbols. No event → record it in the conversion log and the decision; consider an event request at github.com/microsoft/ALAppExtensions. Prompt: `refactor-to-event-subscriber`. |
| `DotNet`, `RunOnClient` | XML → `XmlDocument` types; JSON → `JsonObject`; HTTP → `HttpClient`; text/regex → `Regex` codeunit and `Text` methods; anything else → an Azure Function behind `HttpClient`. |
| `File`, server file methods, `UPLOAD`/`DOWNLOAD`, `Report.SaveAsPdf` to a path | `Temp Blob` + `InStream`/`OutStream`, `UploadIntoStream`, `DownloadFromStream`, `Report.SaveAs(…, OutStream)`. Shared folders → SharePoint / Azure Blob via API. |
| `Automation`, `OCX` | Excel → `Excel Buffer` (stream-based); Word → Word report layouts; UI → control add-in. |
| Codeunit 1 triggers | See *Transitioning from codeunit 1* on Microsoft Learn (e.g. `CompanyOpen` → `LogInManagement`, `OnGlobalInsert/Modify/…` → `GlobalTriggerManagement`). Subscribe to integration events; re-check every mapping against the BC29 symbols. |
| ABCTP / Outlook mail | Email module: `Email Message` and `Email` codeunits. |
| TempBlob table | Codeunit `Temp Blob`. |
| MenuSuite | `UsageCategory` / `ApplicationArea` on pages and reports; role center actions. |
| Option fields | `enum` (`Extensible = true` where partners must extend); keep ordinal values. |
| RDLC / Word layouts | `rendering` section with layout files in `layouts/`. |

### 5. Compile and clean

- Fix errors by category, not file by file, until there are zero errors.
- Enable CodeCop, UICop and PerTenantExtensionCop; fix the warnings that matter for BC29.
- `ToolTip` on fields and actions; English captions with translations (XLIFF) for German where needed.
- `permissionset` objects for new tables.

### 6. Record

- A section per area in `docs/runbooks/conversion-log.md`: objects converted, redesigned items, events used, events missing, open issues.
- Update the decision record for every redesign.

## Rules

- Never edit `source/`. Generated AL is a starting point – review every trigger.
- One area per iteration; compile green before moving on.
- Verify each AL method and event signature against Microsoft Learn or the symbols before use.
