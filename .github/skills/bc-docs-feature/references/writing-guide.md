# Reference — Writing Guide

How the documentation should **read**. This is the professional-quality bar: grounded in the
[Diátaxis](https://diataxis.fr/) framework used by many large open-source projects, and adapted to
Business Central.

---

## The core idea: separate the four purposes

Most bad documentation mixes four things that should stay apart. Diátaxis names them:

| Mode | Serves | User is… | Answers | BC page |
|---|---|---|---|---|
| **Tutorial** | Learning | new, needs a guided win | "Take me through it once" | onboarding parts of `setup-guide` |
| **How-to** | A task | doing real work | "How do I do X?" | `user-guide`, `setup-guide`, feature doc "How to Use" |
| **Reference** | Looking up | needs a precise fact | "What exactly is Y?" | `object-reference`, `architecture` tables |
| **Explanation** | Understanding | wants the why | "Why does it work this way?" | `architecture` prose, Overview |

**The one rule that fixes most docs:** never make a how-to explain theory, and never make a
reference teach a task. If a page is trying to do two modes at once, split it. When you catch
yourself writing "but first, some background…" inside a step list, that background belongs in
Explanation, not here.

---

## Write for layered audiences

A good area doc serves three readers **without forcing any of them to read the others' pages**:

1. **End user** — clicks in the BC UI. Wants `user-guide` (or the feature doc). No AL, no object IDs.
2. **Functional consultant / admin** — configures. Wants `setup-guide` + Overview. Real page/field
   names, setup sequence, effects.
3. **Developer** — extends or debugs. Wants `architecture` + `object-reference`. Objects, events,
   fields, methods, relationships.

Depth increases as the reader moves from Overview → user-guide → setup-guide → architecture →
object-reference. Never dilute the `user-guide` with implementation detail, and never water down
`object-reference` into prose.

---

## Tone and style

- **Language:** write user-facing text in the project's documentation language (ask if unknown;
  default English); keep AL object/field names, AL keywords and file/path slugs in English. If the
  app ships translations (XLIFF), the UI captions in the docs must match the language the reader
  actually sees.
- **Voice:** direct and active. "Open the **ABC Payment Setup** page", not "The page can be opened".
- **Concrete over abstract:** always use the **real** BC page names, field names, and actions from
  the AL (captions, not internal names, for end users) — never invented UI. If you did not see it in
  the source or the running app, do not write it.
- **Short sentences, real headings.** A reader scanning for one answer should find it from the
  heading alone.
- **Show, then tell.** Lead a how-to with the steps; put the reasoning after, or in the
  architecture/overview page.

---

## Structural patterns

- **Procedures = numbered lists.** One action per step. Start each step with the verb. End with the
  observable result ("… the **Status** field shows *Released*").
- **Facts = tables.** Fields, objects, options, and status values belong in tables, not prose.
- **Decisions = a small table or a short mermaid decision tree**, not a paragraph of nested "if".
- **Warnings and limits** get their own labelled line, not buried mid-paragraph.
- **Diagrams** (mermaid) for data flow and relationships in `architecture`. Keep them high-level;
  the precise detail lives in `object-reference`.
- **Screenshots** (optional) support a step, never replace it — see
  [`interactive-ui-evidence.md`](interactive-ui-evidence.md).

---

## Quality bar (self-check before opening the PR)

- [ ] Each page serves **one** Diátaxis mode; theory and tasks are not mixed.
- [ ] Written for its stated audience; no AL jargon leaks into `user-guide`/Overview/feature docs.
- [ ] Every UI name, field, and action is **real** (verified against AL or the running app).
- [ ] Procedures are numbered, one action per step, with an observable result.
- [ ] Facts (fields/objects/options) are in tables, complete — no "…and more".
- [ ] The "why" is present somewhere (Overview/architecture) but not blocking the how-to.
- [ ] Documentation language as agreed; English object/field/slug names.
- [ ] Nothing describes planned-but-unbuilt behaviour (cross-checked against source).
- [ ] Links resolve; cross-links to related areas exist instead of duplicated content.
- [ ] No secrets, personal data or unmasked customer data in text or screenshots.

---

## Anti-patterns

- A `user-guide` that explains the data model. → Move it to `architecture`.
- An `object-reference` written as narrative paragraphs. → Use field/method tables.
- Documenting the spec instead of the shipped code. → Always verify against the AL source.
- Screenshot-only steps with no text. → Text first; screenshots support, never replace.
- One giant page that is overview + setup + reference. → Split into the page types.
- Invented or guessed field names. → If unverified, mark it as open, do not assert it.
- Work-item numbers in titles, slugs or folder names. → Use `related-work-items` front-matter.
