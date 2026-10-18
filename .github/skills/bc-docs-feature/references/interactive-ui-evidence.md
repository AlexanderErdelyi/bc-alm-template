# Reference — Interactive UI Evidence (optional screenshots)

Use this reference when documentation would benefit from screenshots of a real Business Central
page. The source of truth remains the implementation and the written workflow; screenshots are
supporting evidence, not a substitute for describing the behaviour. Everything here is **optional**.

## Decide whether to capture screenshots

Before writing the documentation, ask the user one concise question when the request does not state
a preference:

> Should I include screenshots from a Business Central environment? I will read the available launch
> configurations and ask you to choose one if the target is not unambiguous.

Use screenshots automatically when the user explicitly requests screenshots, annotated screenshots,
visual documentation, page walkthroughs, or UI evidence. Skip them when the user declines, when no
environment or browser tooling is available, or when the page contains sensitive data that cannot be
masked safely.

## Capture workflow

1. Load the [`bc-interactive-test`](../../bc-interactive-test/SKILL.md) skill and use its
   `launch.json`-driven target selection, build/publish, and browser-navigation workflow.
2. Confirm the selected launch configuration, company, tenant, page, and whether the environment is
   shared before changing data. Never use a production environment without explicit approval.
3. Capture only meaningful states: setup/source page, action menu, dialog or Error Messages page,
   and final target state.
4. Preserve the raw screenshots. Create annotated copies only when callouts materially improve the
   user walkthrough.
5. Identify annotations by visible UI captions, not unstable DOM selectors. Numbered callouts should
   match the numbered steps in the documentation.
6. Mask or replace customer names, account numbers, phone numbers, e-mail addresses, bank details,
   and other sensitive values before committing or publishing screenshots.
7. Store documentation screenshots in an `assets/` folder next to the pages (e.g.
   `docs/functional/assets/` or `docs/modules/<area>/assets/`) and use relative links from the
   markdown page.

## Screenshot naming

Use lowercase kebab-case names that describe the state:

```text
<topic>-01-source-page.png
<topic>-02-error-messages.png
<topic>-03-resolution-dialog.png
<topic>-04-result-page.png
```

Use `-annotated` before the extension for callout copies:

```text
payment-tolerance-02-error-messages-annotated.png
```

## Documentation format

Place each screenshot immediately after the step it illustrates. Include concise alt text and a
caption:

```markdown
![Error Messages page showing the tolerance violation and the recommended action](assets/payment-tolerance-02-error-messages-annotated.png)

*The Error Messages page identifies the affected customer, the source field, and the available resolution.*
```

## Evidence report

Record the environment, company, page ID, scenario, values changed, and cleanup status in the work
notes or final response. Do not claim that a workflow works because a dialog opened; verify the
persisted target record after the action.

## Guardrails

- Never capture or publish production data without explicit approval.
- Do not invent values or modify shared data without reporting the change.
- Do not commit screenshots containing unmasked customer, personal or banking data.
- If screenshots cannot be captured, continue with text documentation and report the limitation.
