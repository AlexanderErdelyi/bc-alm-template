---
name: bc-docs-feature
description: "Produces professional Business Central documentation grounded in the actual implementation: customer-facing feature docs with a changelog entry (the PROD gate, with a spec-vs-implementation divergence check) and multi-page area/module doc sets (overview, architecture, setup, user guide, object reference), plus documentation drift and coverage checks, and optional Wiki.js publishing. Use when: write functional docs, document a feature for the customer, update the changelog, PROD documentation gate, end-user docs for BC, how-to documentation, document a module or area, create overview/architecture/setup/user-guide/object-reference pages, check documentation drift or coverage, publish or sync docs to Wiki.js."
---

# BC · Documentation

Produce accurate documentation from the spec **and the actual implementation**, at the right depth
for its audience. Core procedure of the **`bc-doc`** agent. Tooling overview:
[`documentation-tooling.md`](references/documentation-tooling.md).

This is a **router**: decide the shape, then load only the reference(s) that shape needs. Do not read
every reference up front — read a reference when a step tells you to.

## Step 0 — Decide the shape

| Signal | Shape → read |
|---|---|
| "document ABC-123", "functional docs for this feature", "update the changelog", PROD gate | **Track A — feature doc** → [`references/feature-doc.md`](references/feature-doc.md) |
| "document the sales area", "document the finance module", "overview + architecture + object reference" | **Track B — area / module doc set** → [`references/module-doc.md`](references/module-doc.md) |
| "which docs are outdated?", "what is not documented yet?" | **Maintenance** → [`references/documentation-drift.md`](references/documentation-drift.md) + [`documentation-tooling.md`](references/documentation-tooling.md) |
| "publish / sync the docs to Wiki.js" | **Publishing (opt-in)** → [`references/wikijs-publishing.md`](references/wikijs-publishing.md) |

If unsure, ask one short question. Each track file is self-contained — follow it end to end.

## References (load on demand)

| Reference | Read it when |
|---|---|
| [`references/feature-doc.md`](references/feature-doc.md) | Track A — documenting one shipped work item / issue (the PROD gate, changelog) |
| [`references/module-doc.md`](references/module-doc.md) | Track B — documenting a whole area/module |
| [`references/documentation-structure.md`](references/documentation-structure.md) | Deciding which pages to produce and how to lay them out (mainly Track B) |
| [`references/templates/topic-index.md`](references/templates/topic-index.md) | Skeleton for a **topic hub** inside an area (e.g. `finance/document-output/index.md`) |
| [`references/templates/topic-page.md`](references/templates/topic-page.md) | Skeleton for a **page inside a topic folder** |
| [`references/writing-guide.md`](references/writing-guide.md) | Writing any content — the Diátaxis-based quality bar |
| [`references/documentation-drift.md`](references/documentation-drift.md) | Recording which AL objects a doc covers, and finding docs that code changes have left behind |
| [`references/interactive-ui-evidence.md`](references/interactive-ui-evidence.md) | Capturing, annotating, masking and embedding Business Central screenshots |
| [`references/wikijs-publishing.md`](references/wikijs-publishing.md) | **Only if** the user explicitly asks to publish/sync to Wiki.js |

Scripts live in [`references/scripts/`](references/scripts/) (PowerShell 5.1 and 7). They find the
repository root, the AL sources (every folder with an `app.json`) and `docs/` automatically; override
with `-RepoRoot`, `-DocsRoot` (and `-SourcePath` where offered) if your layout differs.

## Publishing to Wiki.js is optional

Writing/updating the **repo markdown is the deliverable**. Publishing to Wiki.js is a **separate,
opt-in step** — do it **only when the user explicitly asks** to publish / upload / sync. Most doc
tasks (a PROD-gate feature doc, a work-in-progress area doc) never touch a wiki, and projects without
Wiki.js ignore it entirely. When requested, read
[`references/wikijs-publishing.md`](references/wikijs-publishing.md) — not before. The wiki URL comes
from `WIKIJS_URL`/`-WikiUrl`, the API key only from `WIKIJS_API_KEY` or a git-ignored `.env`.

## Universal rules (both tracks)

- Document **what exists**, verified against the AL source — never the spec or memory alone. Use the
  real page, field and action captions so the docs match the BC UI.
- Write user-facing text in the project's documentation language (ask if unknown; default English);
  keep AL object/field names and file/path slugs in English.
- **Organise by subject, never by ticket.** Folders and page titles are named after the topic
  (`document-output`), never after a work item (`us-123-e-invoice`). Every page must be readable
  without knowing the originating work item; work items / issues go into the `related-work-items`
  front-matter key and a closing `## Origin and related work` section (Track B). Track A's
  `docs/functional/ABC-{ID}-*.md` file is the one deliberate exception — it is the release record.
  See [`references/documentation-structure.md`](references/documentation-structure.md).
- **After documenting AL objects, record them** with `Update-DocsObjectMetadata.ps1 -DocFolder <folder>
  -Object 'Codeunit 50103', 'Table Customer'` so a later code change can be traced back to the docs it
  invalidates. Always reference objects **with their type** — IDs are unique per type, not globally.
  See [`references/documentation-drift.md`](references/documentation-drift.md).
- The writing bar in [`references/writing-guide.md`](references/writing-guide.md) applies to all
  content: one Diátaxis mode per page, tables for facts, numbered steps for tasks, real BC UI names.
- Never put secrets, personal data or customer data into docs or screenshots.

## Optional interactive UI evidence

When the documentation describes a page workflow, field, action, dialog or user-facing result, check
whether screenshots would make it clearer. If the user has not already said yes or no, ask once:

> Should I include screenshots from a Business Central environment? I will read the available launch
> configurations and ask you to choose one if the target is not unambiguous.

If yes, load [`references/interactive-ui-evidence.md`](references/interactive-ui-evidence.md) and
delegate the live build/publish/navigation/assertion work to the
[`bc-interactive-test`](../bc-interactive-test/SKILL.md) skill. Mask sensitive values and verify the
persisted result before describing a workflow as successful. If the user declines or no environment
is available, continue with text documentation and state that no screenshots were included.

## Stop conditions

- A spec document is missing (Track A) → stop and send the user to **`bc-spec-author`** (agent:
  `bc-spec`).
- Spec and implementation diverge (Track A) → do not write docs until the divergence is resolved or
  explicitly acknowledged and the spec's `change-log.md` is bumped.

## Next step

Once the feature docs are merged, all PROD prerequisites are satisfied → **`bc-ship-release`**
(agent: `bc-deploy`).
