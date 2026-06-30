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
2. **Write the user story** in the canonical form:
   > As a *\<role\>*, I want *\<capability\>*, so that *\<business outcome\>*.
3. **Split if needed.** If the request covers more than one outcome, propose separate stories
   (one per deliverable) rather than one oversized story. Name each `ABC-{ID}` candidate.
4. **Draft acceptance criteria** in Given/When/Then, numbered `AC-01`, `AC-02`, … Each must be:
   - testable by a non-developer,
   - tied to something in the story,
   - free of vague words like "should work correctly".
5. **List open questions** explicitly — anything that blocks a confident spec.
6. **State what is out of scope.**

## Output

```markdown
## User Story — ABC-{ID}

**As a** <role> **I want** <capability> **so that** <outcome>.

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

## Quality gate (mirror of the repo issue form)

- [ ] Story is a single deliverable (split if not).
- [ ] At least 3 acceptance criteria, all testable.
- [ ] Open questions listed, not hidden.
- [ ] Out-of-scope stated.

## Next step

When the story and criteria are agreed, move to **`bc-spec-author`** (agent: `bc-spec`) to
create the full `specs/ABC-{ID}-*/` folder.
