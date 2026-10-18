# Reference — Area / Module Doc Set (Track B)

The procedure for documenting **a whole functional area or AL module** as a multi-page set under
`docs/modules/<area>/`. Knowledge/reference documentation — **not** a PROD gate. Page types and
layout: [`documentation-structure.md`](documentation-structure.md). Shared writing rules:
[`writing-guide.md`](writing-guide.md). Keeping it current:
[`documentation-drift.md`](documentation-drift.md). Optional publishing:
[`wikijs-publishing.md`](wikijs-publishing.md).

The set is: `index` (overview), `architecture`, `setup-guide`, `user-guide`, `object-reference` —
only the pages the area actually needs. Markdown in the repo is the source of truth.

---

## B0 — Find the gaps (optional)

```powershell
./.github/skills/bc-docs-feature/references/scripts/Get-DocsCoverage.ps1                    # per module
./.github/skills/bc-docs-feature/references/scripts/Get-DocsCoverage.ps1 -Undocumented -Module app/Setup
```

Use it to pick the area and to make sure nothing in scope is forgotten.

## B1 — Analyse the source

Read the actual AL of the module (e.g. `app/src/<module>/`). List **every** object, field, and
public method; map relationships (codeunit→table, page→table, event-subscriber chains, cross-module
calls). Never document from the spec or memory alone. `Get-ALObjectIndex.ps1 -Filter <text>` and
`-ExtensionsOf <Base>` give the inventory; use symbol search / find-usages (or text search) to find
subscribers and cross-references before reading files in large chunks.

## B2 — Plan the pages

Propose which of the five page types to create (given the module's size and whether it has real
setup / day-to-day workflow) and the `docs/modules/<area>/` layout, including topic folders for broad
areas. **Present the plan and get confirmation before generating.** `index` + `architecture` are
always present; `object-reference` unless the area has fewer than ~3 objects; `setup-guide` /
`user-guide` only when there is real configuration or a real day-to-day workflow. Ask whether
screenshots are wanted ([`interactive-ui-evidence.md`](interactive-ui-evidence.md)).

## B3 — Write the markdown

Generate the pages per [`documentation-structure.md`](documentation-structure.md) (page sections +
front-matter; start topic folders from [`templates/`](templates/)) and
[`writing-guide.md`](writing-guide.md) (each page one Diátaxis mode, layered audience, real UI
names, tables for facts, numbered steps for tasks). English slugs; titles and content in the
project's documentation language. Document everything — no omissions.

## B4 — Cross-link

Wire each page's nav bar to its siblings, link the `index` to all sub-pages, and cross-link related
areas (e.g. `sales` ↔ `finance`) instead of duplicating content.

## B5 — Record what the pages describe

```powershell
./.github/skills/bc-docs-feature/references/scripts/Update-DocsObjectMetadata.ps1 `
    -DocFolder docs/modules/<area>[/<topic>] -Detect
```

Review the detected references, add base objects by name (`'Table Customer'`) to track your
extensions on them, then commit the `metadata.json` with the pages. From now on
`Test-DocsObjectDrift.ps1` flags the folder when any of those objects changes.

## B6 — Open the docs PR

Title `docs: <area> documentation`; link the related work items / issues. Publishing to Wiki.js
happens only if the user explicitly asks for it, after the markdown is reviewed.

---

## Quality bar (area/module set)

One Diátaxis mode per page · built from a real source analysis, complete (every object/field/public
method) · real BC UI names · tables for facts, numbered steps for tasks · English slugs ·
documentation language per project · links resolve · related areas cross-linked, not duplicated ·
`metadata.json` recorded.
