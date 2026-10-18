---
name: bc-plan-user-story
description: "Turns a raw Business Central request, ADO ticket, or meeting note into a crisp user story with testable acceptance criteria, ready to be specced. Use when: plan a BC feature, write a user story, break down a ticket, clarify requirements, draft acceptance criteria, what should this feature do, turn a request into a story."
---

# BC · Plan a User Story

Produce a single, unambiguous user story and a first set of acceptance criteria from a raw
request. This is the **PLAN** phase — it runs *before* the full spec (`bc-spec-author`) and
keeps everyone honest about scope.

## When to use

- A stakeholder or ADO ticket describes a need in loose terms.
- You need to confirm scope and "done" before any AL design happens.
- The request bundles several features and needs splitting.

## Inputs to gather

- ADO ticket ID (if any) and its title/description. Read it via the Azure DevOps MCP server
  if configured; otherwise ask the user to paste it.
- Who requested it (customer / internal) and the business value.
- Priority and target release/wave, if known.

## Procedure

1. **Restate the need** in one sentence, in business language.
2. **Write the user story** in the canonical form, in the **stakeholder's language** (write it in
   German if the ticket/discussion is in German), with each clause on its own line and the labels
   in bold:
   > **As a** *\<role\>*
   > **I want** *\<capability\>*,
   > **so that** *\<business outcome\>*.
3. **Split if needed.** If the request covers more than one outcome, propose separate stories
   (one per deliverable) rather than one oversized story. Name each `ABC-{ID}` candidate.
4. **Draft acceptance criteria** in Given/When/Then, numbered `AC-01`, `AC-02`, … Each must be:
   - testable by a non-developer,
   - tied to something in the story,
   - free of vague words like "should work correctly".
5. **List open questions** explicitly — anything that blocks a confident spec. Resolve ambiguities
   by asking **one focused question at a time** (the ask-questions tool where available — VS Code's
   `askQuestions` — otherwise inline), each with a few suggested answers; never invent answers.
6. **State what is out of scope.**
7. **Align & refine.** Play the story, criteria, and scope back to the user before finalizing. On
   their response: **changes** → revise and re-present, keeping the work item in sync; **questions**
   → clarify one-at-a-time; **alternative framing** → loop back to restating the need; **approval**
   → move to hand-off. If the answers materially change the need or scope, loop back to step 1.
   Don't write the story to the work item as final until the user agrees (or asks to save the draft).

## Output

The chat-facing draft (Markdown):

```markdown
**As a** <role>
**I want** <capability>,
**so that** <outcome>.

**Business value:** <why it matters>
**Priority:** P1 / P2 / P3   **Target:** <wave/date or TBD>

### Acceptance Criteria
- **AC-01** — Given <context>, when <action>, then <result>.
- **AC-02** — ...

### Open Questions
1. ...

### Out of Scope
- ...
```

## Writing it into the work item (Azure DevOps)

When you update the ADO work item, mind the field formats (see the repo Copilot instructions):

- The **Description** field is **HTML** — send HTML (`<p>`, `<strong>`, `<br>`, `<h3>`, `<ul>`),
  not Markdown, or the tags render as raw text.
- **Do not repeat a "User Story" heading** in the Description. The work item is already typed
  *User Story* (its title bar says so), so a second "User Story" H1/H2 is redundant noise — lead
  straight with the three-line story statement.
- Put the **role / goal / reason on three separate lines** with the labels bold, then follow with
  the business value line, background, open questions, out-of-scope, and options sections.
  **Do not put the acceptance criteria in the Description.**
- **Acceptance criteria go into their own field.** On Azure DevOps *User Story* items (Agile/Scrum
  processes) the **Acceptance Criteria** field (`Microsoft.VSTS.Common.AcceptanceCriteria`) is a
  separate **HTML** field — write the Given/When/Then list there so testers and boards see it where
  they expect it. Each AC is a bulleted item with a short bold **title** and the three clauses as
  indented sub-bullets. If the process template has no such field (e.g. Basic *Issue*), fall back
  to an `<h3>Acceptance Criteria</h3>` section at the end of the Description.
- **Escape non-ASCII characters as HTML entities** in HTML fields (`&ouml;`, `&auml;`, `&uuml;`,
  `&szlig;`, `&eacute;`, `&mdash;`, `&nbsp;`…) and always escape `<`, `>` and `&`. Raw umlauts and
  typographic characters are mangled by some MCP/REST paths and then show up as `Ã¶` in the item.
- **Discussion/comments** use **Markdown**, not HTML — only the Description (and similar large
  fields) are HTML.
- **Screenshots/attachments can't be uploaded via the MCP tools** — they only *download* existing
  attachments. If the user pastes a screenshot and asks to attach it, **say so** and ask them to
  drag-drop it into the work item's Description/comment in the browser (or, if a PAT is configured,
  upload it via the REST `POST _apis/wit/attachments` endpoint with `curl` and reference the URL in
  the Description HTML). Don't silently ignore the request.

Example **Description** HTML (story and context only — no ACs):

```html
<p><strong>As a</strong> &lt;role&gt;<br>
<strong>I want</strong> &lt;capability&gt;,<br>
<strong>so that</strong> &lt;business outcome&gt;.</p>
<p><strong>Business value:</strong> &hellip;<br>
<strong>Priority:</strong> P2 &nbsp;&nbsp;<strong>Target:</strong> TBD</p>
<h3>Background &amp; current state</h3>
<p>&hellip;</p>
<h3>Open questions</h3><p>None.</p>
<h3>Out of scope</h3><ul><li>&hellip;</li></ul>
```

Example **Acceptance Criteria** field HTML (`Microsoft.VSTS.Common.AcceptanceCriteria`):

```html
<ul>
  <li><strong>AC-01 &mdash; &lt;short title&gt;</strong>
    <ul>
      <li><strong>Given</strong> &hellip;</li>
      <li><strong>When</strong> &hellip;</li>
      <li><strong>Then</strong> &hellip;</li>
    </ul>
  </li>
  <li><strong>AC-02 &mdash; &lt;short title&gt;</strong>
    <ul>
      <li><strong>Given</strong> &hellip;</li>
      <li><strong>When</strong> &hellip;</li>
      <li><strong>Then</strong> &hellip;</li>
    </ul>
  </li>
</ul>
```

Write the labels in the customer's language when the story is localized (e.g. German
*Als / m&ouml;chte ich / damit* and *Gegeben / Wenn / Dann*), keeping the HTML entity escaping.

**GitHub Issues:** the issue body is Markdown — keep the story, then an `## Acceptance criteria`
section with the same `AC-0x — title` bullets and Given/When/Then sub-bullets.

## Spec summary back-write (after bc-spec)

When `bc-spec` hands a finished spec back to you, add a concise **Spec Summary** to the work item so
a junior developer or PM can grasp the plan without opening the whole spec. Read the spec's
`brief.md` and `plan.md`, then write a short block into the work-item **Description** (below the
story), containing:

- **Approach** — one or two sentences on the chosen technical approach.
- **Key decisions** — the notable architecture choices (from the spec's decision table).
- **Open questions** — any still flagged *awaiting customer*.
- **Spec link** — the path to the spec folder (`specs/<Area>/<type>-<ID>-<slug>/`).

Keep it to a few lines and refresh it if the spec changes. This is a *summary*, not a copy — the
spec folder remains the source of truth.

**Language:** the spec folder is English, but the work item is **customer-facing** — write the Spec
Summary in the **customer's preferred language** (the same language as the user story; translate from
the English spec if needed). Only the DevOps-facing summary is localized; the spec docs stay English.

Write it as **HTML** (Description field); if you'd rather keep it out of the story body, post it as a
**Markdown** discussion comment instead.

## Quality gate (mirror of the repo issue form)

- [ ] Story is a single deliverable (split if not).
- [ ] At least 3 acceptance criteria, all testable.
- [ ] Open questions listed, not hidden.
- [ ] Out-of-scope stated.

## Next step

When the story and criteria are agreed, move to **`bc-spec-author`** (agent: `bc-spec`) to
create the full `specs/<Area>/<type>-<ID>-<slug>/` story folder.
