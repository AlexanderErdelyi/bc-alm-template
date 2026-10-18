# Reference — Documentation Drift and Coverage

How to keep track of documentation that describes AL objects, so a later code change does not
silently leave the documentation wrong — and how to see what is not documented yet. Read this when
writing or updating an area/module doc set, or when the user asks "is any documentation out of
date?" / "what is not documented?".

---

## The problem this solves

Someone changes codeunit 50103. The change ships. Nobody remembers that
`docs/modules/sales/payment-tolerance/` describes exactly that codeunit in detail. The documentation
is now wrong and nothing says so.

The mechanism is deliberately simple: record **which objects a documentation folder describes** and
**what those objects looked like** when the documentation was last confirmed correct. A later check
recomputes the hashes and reports every documented object that has changed since.

It answers *"which documentation is now suspect"*. It does **not** answer *"what exactly changed"* —
for that it prints a ready-to-run `git diff` against the commit recorded in the metadata.

---

## The scripts

All in [`scripts/`](scripts/), sharing `ALObjects.Common.ps1` and `DocsRepo.Common.ps1`. They run in
Windows PowerShell 5.1 and PowerShell 7, from any folder inside the repository.

| Script | Purpose | Writes |
|---|---|---|
| `Get-ALObjectIndex.ps1` | Inventory every AL object (type, ID, name, module, files, hash) | only with `-OutFile` |
| `Update-DocsObjectMetadata.ps1` | Record/refresh which objects a doc folder covers | `metadata.json` in that folder |
| `Test-DocsObjectDrift.ps1` | Compare recorded vs. current hashes | nothing (exit code only) |
| `Get-DocsCoverage.ps1` | Show what is documented, open or excluded | only with `-OutFile` |

**Where they look** (all overridable):

| What | Default | Override |
|---|---|---|
| Repository root | `git rev-parse --show-toplevel`, else the folder containing `.github` | `-RepoRoot` |
| AL sources | every folder with an `app.json` (e.g. `app/`, `test/`), searched up to 5 levels deep | `-SourcePath app/src` |
| Docs root | `docs/` next to `.github` (if inside the repo), else `<repo>/docs` | `-DocsRoot` / `-DocFolder` |
| Coverage policy | `.github/docs-coverage-policy.json`, else the skill default `references/docs-coverage-policy.json` | `-PolicyFile` |

The **module** of an object is `<app folder>/<first folder below src>`, e.g. `app/Setup` — so a
repo organised by feature folders gets a per-feature coverage report for free.

---

## Workflow

### When writing documentation about AL objects

After the doc pages are written, record what they describe (paths are repo-relative):

```powershell
./.github/skills/bc-docs-feature/references/scripts/Update-DocsObjectMetadata.ps1 `
    -DocFolder docs/modules/sales/payment-tolerance `
    -Object 'Codeunit 50103', 'Table 50100', 'Table Customer'
```

`-Detect` scans the markdown for typed references such as "Codeunit 50103" and adds what it finds.
Treat it as a suggestion and review the result.

### Checking for drift

```powershell
./.github/skills/bc-docs-feature/references/scripts/Test-DocsObjectDrift.ps1
```

```text
  [outdated] docs/modules/sales/payment-tolerance
             last confirmed: 2026-01-15T10:20:38+01:00
             - changed: codeunit 50103 ABC Payment Tolerance Mgt.
             What exactly changed:
             git diff 0701ddf -- app/src/Codeunits/ABCPaymentToleranceMgt.Codeunit.al
```

Exit code `0` = no drift (or no documentation tracked yet), `1` = at least one documented object
changed. Usable as a PR check.

### Closing the loop

Review and correct the documentation, then re-record:

```powershell
./.github/skills/bc-docs-feature/references/scripts/Update-DocsObjectMetadata.ps1 `
    -DocFolder docs/modules/sales/payment-tolerance
```

Without arguments it keeps the recorded references and refreshes only the hashes — that is the
"documentation is correct again" statement.

---

## Rules that make this work

1. **Always reference objects with their type.** `Codeunit 50103`, never `50103`.
   Object IDs are unique **per type**, not globally — a table, a page and a codeunit can all be
   50100. An untyped reference is rejected rather than guessed, and the script lists the candidates.
2. **Reference base objects by name to catch extensions.** `Table Customer` has no file in this repo
   — it is Microsoft's. Recording it tracks every `tableextension` this app layers on it, and the
   drift report names the exact extension that changed. The same works for page, report and enum
   extensions.
3. **Refreshing hashes is a statement, not a formality.** It says "I have read the documentation and
   it matches the code again". Refreshing without reading defeats the whole mechanism.
4. **One object may be documented in several places.** That is fine and expected — the drift report
   simply lists every affected folder, which is exactly the "where is this already documented?"
   answer.

---

## What the hash covers

```text
SHA256( for each file of the object: "<path>=<file hash>" )
```

- The object's `.al` file, LF-normalised so a CRLF checkout is not mistaken for a change.
- **For reports also the layout files** referenced via `RDLCLayout` / `WordLayout` / `ExcelLayout` /
  `LayoutFile`. A layout change alters the printed document without touching the `.al` file, and a
  hash over the `.al` alone would miss it entirely.

Deliberate limits, so the mechanism stays fast and the files stay small:

| Limit | Consequence |
|---|---|
| Whole-file hash, not per field or procedure | A new field and a reformatted comment look the same — both flag the doc as suspect. The `git diff` hint closes that gap. |
| Commented-out objects are ignored | A fully commented-out file contains no live object; it is correctly skipped. |
| Several objects in one file share its hash | Rare, and it only ever over-reports. |
| Base objects have no own hash | Only the extensions on them are tracked; a change inside Microsoft's application is invisible here. |

---

## metadata.json

Lives in the documentation folder it describes and is committed with the pages.

```json
{
  "schema": 1,
  "docFolder": "docs/modules/sales/payment-tolerance",
  "recordedAt": "2026-01-15T10:20:38+01:00",
  "gitCommit": "0701ddf",
  "objects": [
    {
      "ref": "codeunit 50103",
      "type": "codeunit",
      "id": 50103,
      "name": "ABC Payment Tolerance Mgt.",
      "resolved": true,
      "hash": "fc9a3d69…",
      "files": [ "app/src/Codeunits/ABCPaymentToleranceMgt.Codeunit.al" ],
      "extensions": []
    },
    {
      "ref": "Table Customer",
      "type": "table",
      "id": null,
      "name": "Customer",
      "resolved": false,
      "hash": null,
      "files": [],
      "extensions": [
        { "type": "tableextension", "id": 50102, "name": "Customer ABC Ext.", "file": "app/src/TableExtensions/CustomerABCExt.TableExt.al", "hash": "e6f72026…" }
      ]
    }
  ]
}
```

`resolved: false` with a populated `extensions` list is the normal, correct shape for a base object.
Paths are relative to the repository root, so `git diff` output matches them directly.

`gitCommit` is what makes the drift report actionable: it is the commit at which the documentation
was last confirmed, so `git diff <commit> -- <files>` shows committed, staged and unstaged changes
since that point.

---

## Coverage: what is not documented yet

```powershell
./Get-DocsCoverage.ps1                                      # summary per module
./Get-DocsCoverage.ps1 -Undocumented -Module app/Setup      # the open items of one module
./Get-DocsCoverage.ps1 -Undocumented -ChangedSince main     # recently touched and still undocumented
./Get-DocsCoverage.ps1 -IncludeExcluded                     # what the policy excludes, and why
```

Coverage is **derived on every run** — all objects, minus what `metadata.json` files cover, minus
what the policy excludes. It is deliberately not stored, because a stored coverage file is wrong as
soon as anyone adds an object or writes a page.

Objects that intentionally need no documentation belong in
`.github/docs-coverage-policy.json` (default: [`docs-coverage-policy.json`](docs-coverage-policy.json)) (rules by `type`,
`namePattern` and/or `filePattern`, each with a `reason`). Without it the report would list the same
test, install, upgrade and permission objects forever and stop being read.
