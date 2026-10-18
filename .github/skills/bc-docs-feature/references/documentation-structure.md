# Reference — Documentation Structure

How to decide **what documents to produce** and **how to lay them out**. Read this after the
skill's decision step, once you know whether you are writing a **feature doc** or an
**area/module doc set**.

---

## Two documentation shapes

| Shape | Scope | Lives in | Produces |
|---|---|---|---|
| **Feature doc** (Track A) | One work item / issue that shipped | `docs/functional/ABC-<ID>-<slug>.md` | A single customer-facing page + a changelog entry. The **PROD gate**. |
| **Area / module doc set** (Track B) | A whole functional area or AL module | `docs/modules/<area>/` | A multi-page set: overview, architecture, setup, user guide, object reference. |

**Rule of thumb:** "document work item 123" or "write functional docs for this feature" →
**feature doc**. "Document the sales module", "document the finance area", or "we need overview +
architecture + object reference" → **area/module doc set**.

A feature doc can later be folded into the relevant area doc set; they are not mutually exclusive.

---

## Feature doc — layout

One page, customer-facing, derived from the spec **and** the merged implementation.

```
docs/functional/ABC-<ID>-<slug>.md
docs/changelog.md
```

Required sections (procedure and template: [`feature-doc.md`](feature-doc.md)):

1. **Title + metadata** — plain-language title; Release, Work item, Date.
2. **Overview** — 2–3 sentences: what it does and why (from `brief.md`).
3. **How to use** — numbered steps per use case (from `acceptance-criteria.md`), real page/field names.
4. **Configuration** — setup page/fields, if any.
5. **Notes and limitations** — edge cases, known limits.
6. **Related** — work item / issue link, spec folder path.

---

## Area / module doc set — layout

A small **documentation product**, not one page. Markdown is the source of truth in the repo; if the
project mirrors docs to Wiki.js, the mirror is the **same markdown** (see
[`wikijs-publishing.md`](wikijs-publishing.md)).

```
docs/modules/<area>/
  index.md               # Overview / hub
  architecture.md        # Objects, relationships, data flow
  setup-guide.md         # Configuration / onboarding
  user-guide.md          # Day-to-day usage (how-to)
  object-reference.md    # Field- and method-level reference
```

- **`<area>`** is the functional area or module folder (e.g. `sales`, `finance`, `warehouse`).
  Business-facing areas and technical modules can both live here; cross-link them.
- **Not every set needs all five pages.** `index` and `architecture` are always present.
  `object-reference` is present unless the area has fewer than ~3 objects. `setup-guide` and
  `user-guide` are added when there is real configuration or a real day-to-day workflow.
- **File names (slugs) are English** — `architecture`, `setup-guide`, `user-guide`,
  `object-reference` — even when the documentation language is not English. Never translate the
  slug. Page **titles** follow the documentation language.
- **Broad areas split into topic folders.** The five-page set fits a technical module. A business
  area such as `finance` usually grows subject by subject instead — see
  [Topic folders inside an area](#topic-folders-inside-an-area).

### The five page types

Each page type maps to a documentation purpose (see the Diátaxis mapping in
[`writing-guide.md`](writing-guide.md)).

| Page | Purpose | Primary audience | Answers |
|---|---|---|---|
| `index` (Overview) | Orientation + navigation hub | Everyone | "What is this and where do I go?" |
| `architecture` | Objects, relationships, data flow | Developer / consultant | "How is it built and how does data move?" |
| `setup-guide` | Configuration / onboarding | Admin / consultant | "How do I get it running?" |
| `user-guide` | Day-to-day tasks | End user | "How do I do X?" |
| `object-reference` | Field/method-level reference | Developer | "What exactly is field/method Y?" |

**Overview (`index`)** — one-paragraph purpose, a quick-facts block (object counts, platform,
dependencies, object-ID range), a key-capabilities list, and links to the sub-pages.

**Architecture (`architecture`)** — an object table grouped by type (ID · Name · Purpose), a
data-flow description (Setup → Runtime → Processing → Output), key relationships (codeunit→table,
page→table, event-subscriber chains), and integration points to other modules/systems. Mermaid
diagrams are encouraged.

**Setup guide (`setup-guide`)** — prerequisites, then numbered configuration steps with the real
setup page/field names, then the "after completion" state and optional troubleshooting.

**User guide (`user-guide`)** — task-oriented how-tos: each task is a short numbered procedure with
the real BC UI names, expected results, and notes/warnings.

**Object reference (`object-reference`)** — one card per object grouped by type then sorted by ID:
header `Table 50100 — ABC Payment Setup`, one-line purpose, a full field table (ID · Name · Type ·
Description) for tables/pages, a method table (Name · Parameters · Return · Description) for
codeunits, and key relationships. **Document every object, every field, every public method** — no
omissions.

---

## Topic folders inside an area

Broad areas (`finance`, `sales`, `purchase`) cover more than one subject. When an area accumulates
pages that belong to **one coherent subject**, group them in a **topic folder** with its own index
instead of flattening everything into the area root.

```
docs/modules/<area>/
  index.md                     # Area hub: lists the topics, defines the area boundary
  <topic>/
    index.md                   # Topic hub: what the topic covers, its pages, its boundary
    <page-slug>.md             # Topic pages (reference / how-to / decision / architecture ...)
```

Example:

```
docs/modules/finance/
  index.md                                   # "Finance — Overview", lists the topics
  document-output/
    index.md                                 # "Document output — invoices and credit memos"
    invoice-credit-memo-layouts.md
    invoice-credit-memo-text-matrix.md
    e-invoice-content-decision.md
```

### Rules

1. **Name the folder after the subject, never after a work item, story, feature or project.**
   `document-output/` — correct. `us-123-e-invoice/`, `feature-456/`, `project-x/` — wrong.
   A topic outlives the work item that created it, and later, unrelated work items must be able to
   add pages to the same topic without the folder name becoming a lie.
2. **Every page stands on its own.** A reader who has never heard of the originating work item must
   be able to read the page top to bottom and understand it. Do not write "Based on: US 123" into
   the header block and do not phrase content as "what this story changed".
3. **Work-item traceability is metadata, not structure.** Put work items in the
   `related-work-items` front-matter key and in an `## Origin and related work` section at the end
   of the page, linking the work items / issues and the `specs/` folder.
4. **Titles must not contain work-item IDs.** `E-invoice content — decision guide`, not
   `US 123 — e-invoice decision`.
5. **Slugs stay English; titles follow the documentation language** — the same rule as for area
   pages.
6. **Introduce a topic folder from two pages onwards.** A single page can stay in the area root;
   as soon as a second page on the same subject appears, create the topic folder and move both.
7. **The area index lists topics, not individual pages.** Page-level navigation belongs in the
   topic index. Keep the area index broad — the area title must describe the whole area
   (`Finance — Overview`), never the currently dominant topic
   (`Finance — document output and e-invoicing` is wrong).

### Topic index — required sections

| Section | Content |
|---|---|
| Intro | One paragraph: what subject the topic covers, for whom. |
| Scope table | The BC objects/reports/processes in scope, if the topic is object-bound. |
| `## Scope boundaries` | What is explicitly **not** here, with a link to where it lives instead. |
| `## Pages` | Table of the topic's pages: page · kind · content. |
| `## Start by question` | Optional: question → page, for reader-driven entry. |
| `## Origin and related work` | Work items and spec folders that produced the current state, plus the note that the topic grows independently of them. |

### Templates

Start from these instead of writing the skeleton by hand:

- [`templates/topic-index.md`](templates/topic-index.md) — the topic hub
- [`templates/topic-page.md`](templates/topic-page.md) — a page inside the topic folder

---

## Front-matter (area/module pages)

Every area/module markdown page starts with YAML front-matter. It is harmless when you never publish,
and it is what the optional Wiki.js sync reads:

```yaml
---
module: <area-or-module>
topic: <topic-slug>                 # only for pages inside a topic folder
page-type: index | architecture | setup-guide | user-guide | object-reference | reference | how-to | decision
wiki-path: <prefix>/<area>/[<topic>/]<page-slug>   # optional; only when the page is mirrored to Wiki.js
wiki-title: <page title in the documentation language>
wiki-tags: ["bc", "<area>", "<topic>", "<page-type>"]
related-work-items: ["<id>", "<id>"]   # optional: work items / issues that produced the page
---
```

- **`wiki-path`** is the opt-in for publishing: pages without it are never sent anywhere. Use
  English slugs; the index page has no sub-slug (`<prefix>/<area>`); a topic index is
  `<prefix>/<area>/<topic>`. Path conventions: [`wikijs-publishing.md`](wikijs-publishing.md).
- **`wiki-title`** is the human-readable title — do **not** repeat the module name in it (the wiki
  navigation already provides that context). Good: `Architecture and data flow`. Bad:
  `sales — Architecture`. Never put a work-item ID in the title.
- **`topic`** is the English topic slug and must match the folder name. Omit it for pages that sit
  directly in the area root.
- **`related-work-items`** carries the work-item / issue IDs that produced or last changed the page.
  It is the only place where ticket numbers belong in the metadata — never in the path or the title.

Feature docs under `docs/functional/` do not need front-matter unless they are also mirrored to
Wiki.js.

---

## Navigation

- **Area/module set:** each page carries a one-line nav bar linking its siblings, and the `index`
  links to every sub-page. Cross-link related areas (e.g. `sales` ↔ `finance`) rather than
  duplicating.
- **Topic folder:** the nav bar links the **topic siblings** and adds a second line back to the
  area, e.g.
  `**Document output:** **Overview** · [Layouts](invoice-credit-memo-layouts.md) · [Text matrix](invoice-credit-memo-text-matrix.md)`
  `**Related:** [Finance](../index.md)`.
  The current page is bold and unlinked.
- **Feature doc:** link back to the work item / issue and the spec folder under `specs/`.

---

## Cross-checking against the source

Documentation must describe **what exists**, not what was planned. Before writing:

- For a **feature doc**, run the divergence check (spec vs merged AL) — [`feature-doc.md`](feature-doc.md).
- For an **area/module set**, analyse the actual AL objects — read the AL, list every
  object/field/public method, and map relationships. Never document from memory or from the spec
  alone. After writing, record the objects in `metadata.json` —
  [`documentation-drift.md`](documentation-drift.md).
