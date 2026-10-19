---
description: "Refactor a modification of standard code into an event subscriber (or another extension pattern) for BC29."
argument-hint: "Standard object and trigger/procedure with the modification"
---

Refactor the modification in `${input:location:Standard object and trigger or procedure}` into extension code for BC29.

1. Show the original modification: the customer code compared with `source/base/`, with line references.
2. Identify the business intent in one sentence.
3. Find a suitable event in the BC29 symbols or on Microsoft Learn (publisher object, event name, signature). Prefer integration events with `IsHandled` only when the behavior must be replaced.
4. If there is no suitable event, propose alternatives in this order: other event earlier/later in the flow, table/page extension trigger, interface or enum extension, redesign of the process – and record the missing event in `docs/runbooks/conversion-log.md`.
5. Write the subscriber in the app in `al/` following `.github/instructions/al-target.instructions.md`, and compile.

Never copy standard code into the extension to replace a whole procedure without a decision record.
