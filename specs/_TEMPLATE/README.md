# Spec Template

Specs are organised by **module / functional area**, not by ticket hierarchy. Each work item gets a
folder named `<type>-<ID>-<slug>` under the area it belongs to. This folder holds the scaffolds you
copy to start a new area or a new story.

```
specs/
├── _TEMPLATE/
│   ├── _area/                     ← copy to specs/<Area>/ (first story in an area)
│   │   ├── index.md
│   │   └── roadmap.md
│   └── _story/                    ← copy to specs/<Area>/<type>-<ID>-<slug>/
│       ├── index.md
│       ├── brief.md
│       ├── plan.md
│       ├── acceptance-criteria.md
│       └── change-log.md
│
└── Finance/                       ← an example area
    ├── index.md
    ├── roadmap.md
    └── us-123-payment-tolerance/  ← one folder per work item
        ├── index.md
        ├── brief.md
        ├── plan.md
        ├── acceptance-criteria.md
        └── change-log.md
```

## How to Use

### 1. Create the story folder (and the area, if new)

```bash
# first story in an area only:
cp -r specs/_TEMPLATE/_area  specs/Finance

# every story:
cp -r specs/_TEMPLATE/_story specs/Finance/us-123-payment-tolerance
```

Naming:
- **`<Area>`** — a module / functional area, named how your codebase and business think about it
  (`Finance`, `Sales`, `Base/Invoicing` — any depth). No app/ticket prefix.
- **`<type>`** — work-item type: `us` (user story), `bug`, `feat`, `epic`, `task`, `spike`.
- **`<ID>`** — the work-item ID, bare number (e.g. `123`).
- **`<slug>`** — 3–5 words, kebab-case, from the ticket title.

Then add a row for the new story in the area `index.md`.

### 2. Fill in the story documents in order

| Order | File | Who writes it | Who reviews it |
|---|---|---|---|
| 1st | `brief.md` | PM / Functional Consultant | Customer proxy |
| 2nd | `plan.md` (incl. task breakdown) | Developer | Senior Dev / Architect |
| 3rd | `acceptance-criteria.md` | PM / Functional Consultant | Customer |
| Always | `index.md`, `change-log.md` | Everyone | — |

### 3. Open a spec PR before starting development

The spec must be reviewed and merged **before** a feature branch is created and development starts. This ensures:
- The developer builds the right thing
- The customer has agreed on what "done" looks like
- The PR description and documentation can be generated from the spec

### 4. Reference the spec in your feature PR

```
📄 Spec: specs/Finance/us-123-payment-tolerance/
```

### 5. Agents read these files by convention

Agents locate a ticket's spec with a recursive glob — `specs/**/*-{ID}-*/` — so a story is found
regardless of which area it lives in.

| Agent | What it reads |
|---|---|
| BC Plan | Drafts `brief.md`, `acceptance-criteria.md` (user story) |
| BC Spec | Creates/completes the story folder + area overview |
| BC Developer | `plan.md` (approach + task breakdown), `acceptance-criteria.md` |
| BC PR | `brief.md`, `plan.md` |
| BC Doc | All story documents |
| BC Orchestrator | Checks the story folder exists (recursive) |

---

## File Descriptions

### Story (`_story/`)

- **`index.md`** — Overview & navigation: status, work-item link, links to the four documents, optional diagram.
- **`brief.md`** — The customer request in plain language. Non-technical. What, why, who, when.
- **`plan.md`** — The technical approach. Every AL object to create/modify, plus the **task breakdown** and optional diagrams.
- **`acceptance-criteria.md`** — Testable Given/When/Then criteria. What "done" looks like.
- **`change-log.md`** — Version history of the spec. Every change after v1.0 is logged here.

### Area (`_area/`)

- **`index.md`** — Module/area overview: the list of stories with status, links, and high-level diagrams.
- **`roadmap.md`** — Epic/feature narrative and sequencing. Epics may span areas — cross-link child stories here.
