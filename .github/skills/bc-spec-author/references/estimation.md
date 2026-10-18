# Reference — Authoring `estimation.md` (work packages + hours, customer-facing)

Load this when the user (or the customer) asks for an **estimate / estimation / effort / how many
hours / quote / offer** for a story, or whenever a spec should ship with a costed task breakdown.
`estimation.md` is an **optional** spec document — create it on demand next to the other spec files;
it never replaces `plan.md`. Self-contained; read top to bottom.

## What it is

`estimation.md` is a **customer-facing** document with a developer appendix:

1. It groups the `plan.md` **Task Breakdown** into a handful of **work packages** the customer can
   understand — grouped by what the customer sees or gains, not by object type.
2. Each package gets a **one-line description**, a **priority flag** (Must / Should / Could) and an
   effort in **hours**, plus a **detail section** listing what is actually created.
3. Packages roll up into **scope options** (A Basic / B Recommended / C Complete).
4. An **appendix** maps every plan-task number back to its technical content, affected objects and
   acceptance criteria — so the same document also serves the developer and the `bc-dev` agent,
   which builds **only the option the customer approved**.

## Language & audience

- Write `estimation.md` in the **customer's preferred language** — the same language as the user
  story / work item. It is the one spec document that may not be English; all other spec files stay
  English. Translate the headings and labels of the template below (e.g. German *Muss / Sollte /
  Kann*, *Basis / Empfohlen / Vollständig*) and use the customer's number and date formats.
- Keep AL object, field, procedure and code identifiers in **English** (`ABC Batch Run Mgt.`,
  `GuiAllowed()`); use the customer's BC UI terms (the localized captions) for everything else.
- Package descriptions must be understandable **without BC development knowledge**: first what the
  customer sees or gains, then what is technically created. The appendix may be fully technical.
- Match the tone the team uses with this customer (formal/informal address) — also in the work-item
  comment that announces the estimate.
- The `change-log.md` row for the estimate stays in English like the rest of the spec.

It lives in the story folder alongside `plan.md`:

```text
specs/<Area>/<type>-<ID>-<slug>/
├── index.md
├── brief.md
├── plan.md
├── acceptance-criteria.md
├── estimation.md          # ← this document (optional; add when an estimate is requested)
└── change-log.md
```

For a **broken-down story** (task sub-folders), keep **one** `estimation.md` at the **story level**
that lists every task across all sub-folders — the customer wants a single number per story, not one
per task folder.

## Estimate for AI-assisted development — be realistic

These estimates assume the developer works **with the AI agent** (Copilot agent mode: scaffolding,
code generation, test generation, self-review). That makes the *typing* fast but does **not** remove
the human work that dominates a real BC deliverable. Estimate the **whole** task, not just the code:

- ✅ **Include:** understanding the requirement, AL implementation, wiring events/permissions,
  writing and running the test codeunit, self-review against the quality gate, fixing compile/test
  failures, and iterating with the AI (prompting, verifying, correcting hallucinated APIs/IDs).
- ❌ **Exclude:** work tracked elsewhere — spec/PLAN time already spent, customer UAT, deployment
  windows and environment promotion, and anything parked under *Open Questions* (estimate those
  separately once answered, or flag them as unestimated).

**AI does not make review, testing, and integration free.** A rough guide for a *typical* task:

| Task shape | Human hours (AI-assisted) |
|---|---|
| Add a field + surface it on a page (table ext + page ext) | 1–2 h |
| New setup table + card/list page | 2–4 h |
| Event subscriber with non-trivial business logic | 2–5 h |
| New codeunit orchestrating a process (posting, integration) | 4–8 h |
| External integration (API / EDI / document-management round-trip) | 6–12 h+ |
| Test codeunit covering a story's acceptance criteria | 2–5 h |

Adjust up for: unfamiliar area, third-party app dependency, upgrade risk, missing test data, or open
questions. Round to sensible increments (0.5 h under 4 h; 1 h above). When you are unsure, give a
**range** in the notes and pick the mid-point for the total.

**Target budget from the lead.** If the user (lead/PM) gives a target budget (e.g. "8–12 h"), fit the
packages to it: **Option A Basic = lower bound, Option C Complete = upper bound**. If the target is
far below your bottom-up figure, say so **once** in chat (with your bottom-up number and where the
risk sits), then follow the user's decision. In the document, replace the contingency line with a
customer-facing *"tightly calculated — additional effort will be agreed in advance"* note under
*Notes & risks*.

## Priority flags — what's needed vs nice to have

Flag every **work package** so the customer can see what is **essential to meet the acceptance
criteria** versus what is **optional** they can cut for budget or timeline (MoSCoW-style):

- 🟥 **Must** — required for the story to satisfy its acceptance criteria. Cutting it breaks scope;
  the feature does not work / does not meet the ACs without it.
- 🟨 **Should** — important and expected, but the feature can ship without it (a follow-up is
  acceptable). E.g. a convenience action, a manual retry.
- 🟩 **Could** — optional enhancement; first candidate to drop when trimming the quote. E.g. a setup
  page for values that are fixed for now, extra telemetry.
- ✅ **Done** — work already done on the branch; listed as package **0** for transparency, no hours.

Keep the **Must** set aligned with `acceptance-criteria.md`: everything an AC depends on is a Must. If
a package is Could, its behaviour should not be a hard AC (or mark that AC optional too).

## The document

Template — replace the `<…>` placeholders, delete lines that don't apply, translate to the customer's
language:

```markdown
# Estimate — <story title>

> **Story:** [Index](index.md) · [Brief](brief.md) · [Plan](plan.md) · [Acceptance](acceptance-criteria.md) · **Estimation** · [Change Log](change-log.md)

> **Ticket:** [#<ID>](<work-item-url>) "<ticket title>" · **Prepared by:** <name> · **Date:** <date>
> **Total effort:** **<A>–<C> hours**, depending on the chosen scope (see options)

## What is this about?

<Paragraph 1: today's problem from the user's point of view.>

<Paragraph 2: what changes — in user language.>

## Basis & assumptions

- Hours cover **implementation, review and internal testing** (AI-assisted development).
- **Already done, not charged:** <e.g. fix from bug #…>
- **Not included:** acceptance testing by <customer> (UAT), deployment to test and production,
  end-user documentation<, automated tests (no test project)>.
- <Fixed values / configuration done by the customer / technical prerequisites.>

## Priority

- 🟥 **Must** — required to meet the requirement in #<ID>.
- 🟨 **Should** — important and recommended, but the solution also works without it.
- 🟩 **Could** — optional enhancement, can be added later.

## Work packages

| # | Work package | Short description | Priority | Effort (h) | Plan tasks |
|---|---|---|---|---|---|
| 0 | <already done> | <one sentence> | ✅ Done | — | 1 |
| 1 | <e.g. Log: tables and pages> | <one sentence: what is created and what the customer gains> | 🟥 Must | 1 | 2–4, 12 |
| 2 | <…> | <…> | 🟥 Must | 2 | 5 |
| … | <…> | <…> | 🟨 Should | 2 | 13 |
| … | <…> | <…> | 🟩 Could | 2 | 17 |

> The numbers in the **Plan tasks** column are explained in the
> [appendix: technical tasks](#appendix-technical-tasks-plan-tasks) at the end of this document.

## Details per work package

### 1 — <work package> · 🟥 Must · 1 h

<One sentence on the customer benefit.> What we create:

- **Table `<Name>`** – <what it stores, in user language>.
- **Page `<Name>`** – <what you see / can do there>.
- **Codeunit `<Name>`**, which:
  - <step 1>,
  - <step 2>.
- **Table / Page <ID> "<existing object>"** – new fields *<field>* (<meaning>); shown on the page so
  <customer> can set them up themselves.

### 2 — <…> · 🟥 Must · <h> h

<…>

## Totals by scope

| Option | Scope | Effort |
|---|---|---|
| **A — Basic** | all 🟥 Must packages (1–<n>) | **<A> h** |
| **B — Recommended** | Basic + 🟨 <package> (<no.>) | **<B> h** |
| **C — Complete** | Recommended + 🟩 <package> (<no.>) | **<C> h** |

## The options at a glance

- **Option A — Basic (<A> h):** <what the customer gets; what is missing and how they cope without it>.
- **Option B — Recommended (<B> h):** additionally <…>.
- **Option C — Complete (<C> h):** additionally <…>.

## Notes & risks

- <When additional effort may arise.> Additional effort will be agreed with you in advance.
- <Contingency: "Recommended buffer: +X %" with totals with/without buffer — OR, with a target
  budget, the note "This estimate is tightly calculated".>
- <What is deliberately not included and can be offered separately.>

## Appendix: technical tasks (plan tasks)

This table explains every plan-task number from the *Plan tasks* column — what is implemented
technically, which objects are affected and which acceptance criteria it satisfies. It is the
reference for the development team (and the `bc-dev` agent); the numbers match the
**Task Breakdown** in [plan.md](plan.md#task-breakdown), the criteria are in
[acceptance-criteria.md](acceptance-criteria.md).

| Plan task | Work package | What is implemented technically? | Affected objects | Acceptance criteria | Status |
|---|---|---|---|---|---|
| 1 | 0 | <technical, incl. procedures / properties> | <object type ID "Name"> | AC-01 | ✅ done |
| 2 | 1 | <…> | <…> | AC-08 | open |
| … | — | *Not part of the estimate:* <…> | <…> | — | not planned |

**Approved option:** <A / B / C — filled in once the customer decides; bc-dev builds only this scope>
```

## How to build it

1. **Start from `plan.md`'s Task Breakdown.** Every plan task appears **exactly once** in the appendix.
   If something you want to estimate is missing from `plan.md`, add it there first so plan and
   estimate stay in sync.
2. **Group plan tasks into work packages** (typically 6–10) **from the customer's point of view** —
   one visible capability each ("Notification", "E-mail log incl. setup"), not one per object type.
   Put a table together with its pages; put new setup fields together with the feature that uses
   them. Already-done work goes into package **0** (✅, no hours). Once the user has seen the
   numbering, keep package numbers stable.
3. **Hours per package** — from the guide above, or fitted to the lead's target budget; 0.5-h steps.
4. **Priority per package** — 🟥 / 🟨 / 🟩, aligned with the acceptance criteria.
5. **Short description** — one sentence per package in the overview table, so the scope is readable
   without scrolling to the details.
6. **Details per work package** — a one-line benefit and a *"What we create"* list naming every object
   (type + English name; ID for existing objects) with an explanation in the customer's language. For
   codeunits, list the steps they perform; for new setup fields, say where the customer configures them.
7. **Totals & options** — roll up A Basic (Must) / B Recommended (+ Should) / C Complete (+ Could) and
   explain each option in customer terms, including what Option A leaves out.
8. **Notes & risks** — either a separate contingency (+X %, totals with and without), or — when the
   lead set a target budget — the *tightly calculated* note. Never bake contingency silently into hours.
9. **Appendix** — one row per plan task: technical content (procedures, key properties), affected
   objects, acceptance criteria, status. Link it from the note under the work-package table **and**
   from `plan.md` below its Task Breakdown (*"Mapping to work packages: estimation.md — appendix"*).
10. **Wire it in** — add `· [Estimation](estimation.md)` to every story nav bar, list it in the story
    `index.md` documents list, and add a `change-log.md` row. For a broken-down story keep **one**
    story-level `estimation.md` covering all task folders.
11. **Record the decision** — when the customer picks an option, fill in **Approved option**, set the
    appendix status of excluded tasks to *not ordered*, and add a `change-log.md` row.

## Announcing the estimate on the work item

Post a short comment (Markdown in Azure DevOps comments / GitHub) in the customer's language: the
options table (A/B/C with hours, leaving out the already-done package 0), a link to `estimation.md`
on the branch, and **what you need from the customer** (option decision, open questions). Never
paste the whole document — it stays the source of truth in the repo.

## Keep it honest

- Don't pad every line "to be safe" — put the uncertainty in the **contingency / notes** so it's visible.
- Don't under-estimate testing and review because "the AI writes it" — those hours are real. If a
  target budget forces thin testing hours, tell the user once in chat.
- If the story can't be estimated without an open question answered, say so and give a
  **conditional** estimate ("assuming X; +N h if Y") rather than a false-precision single number.
- The estimate is part of the spec contract: if scope changes during refine, update packages, hours
  and the appendix together, and add a change-log row.
