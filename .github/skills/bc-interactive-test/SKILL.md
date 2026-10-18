---
name: bc-interactive-test
description: "Runs an interactive, evidence-based browser test of a Business Central AL feature against an environment from .vscode/launch.json (build, publish, open the BC web client, execute the acceptance-criteria scenario, assert UI and data). Use when: test interactively, test in the browser, run a UI test, test a Business Central page, verify an AL feature in BC, smoke test after publish, check page behavior, manual acceptance test."
---

# BC Interactive Test

Run a focused, evidence-based browser test against the current Business Central AL project. This
skill validates **user-facing behaviour after an AL build** — it does not replace the automated test
codeunits in the test app (see `.github/instructions/al-test-standards.instructions.md`) and must not
create permanent test data.

Typical callers: **`bc-dev`** after `al_build`/`al_publish` to verify acceptance criteria that can't
be automated, and **`bc-doc`** when it needs to walk through a feature to document it.

## Preconditions

- The workspace contains an AL project with `app.json`.
- At least one configuration exists in `.vscode/launch.json` (the template ships one per
  environment the initializer configured).
- The scenario is known: the acceptance criterion to verify (from the spec's
  `acceptance-criteria.md`), the target company and page. **Never guess** a company, page, or test
  values that weren't provided — ask.
- The user may publish to and modify data in the target environment.
- Browser tools are available (`openBrowserPage`, `readPage`, `clickElement`, `screenshotPage`, and
  `runPlaywrightCode` as fallback). Without them, stop and give the user a manual test script instead.

## Workflow

### 1. Establish the target from `launch.json`

1. Read every configuration in `.vscode/launch.json` — it is the environment registry; never invent
   a server URL or environment name.
2. Match the user's wording, the active launch selection, and the configuration names/properties.
3. If exactly one safe configuration matches, use it. If several match or none clearly does, ask the
   user to choose (name, server/environment, authentication, environment type) — one question.
4. **Never silently pick a production configuration.** Require explicit confirmation before any
   data-changing test on a production-like target (and prefer not to test there at all).
5. Record the selected configuration's environment type/name, tenant, company, startup page,
   authentication and `schemaUpdateMode`.
6. Ask whether the environment is **shared**. If so, use distinctive temporary values and report that
   the test may change shared data.
7. For an `attach` configuration, confirm a browser session exists and don't publish unless asked.

### 2. Build and publish

1. Make `app.json` or an AL file the active editor before AL operations.
2. Run `al_build`; stop on compiler errors.
3. Publish with `al_publish` using the selected configuration. Don't start debugging unless asked.
4. Report the published target before any browser interaction.

### 3. Open and navigate

1. Reuse an open browser page for the target host when possible; reload it after publishing.
2. Otherwise open the URL from the launch configuration (or the session URL created by the AL launch).
3. Navigate by page ID (`?page=<id>`) when the page is known; otherwise use **Tell Me** (Alt+Q) and
   inspect the accessibility tree.
4. Identify controls through accessibility snapshots (`readPage`); use Playwright code only when the
   browser tools can't target a control reliably.

### 4. Prepare the scenario

1. Restate the acceptance criterion as **Given / When / Then** and list the setup data it needs.
2. Record the **baseline** values of every record you will change, so you can assert and clean up.
3. For features where one record updates another (defaults, propagation, cross-company or
   integration sync), establish three values: `base` (source before the edit), `new` (source after),
   `local` (target's current value). Test the clean case first (`local = base`), then a conflict
   (`local` differs from both) when the feature supports reconciliation. Verify source and target
   records **separately**, in the right company — don't assume the open company is the target.
4. Test the **complete mapping** (source field → target field). Editing the target directly is a
   local-edit test, not a propagation test.

### 5. Execute and assert

Assert both the visible UI **and** the resulting data:

- the expected page/action opens; expected rows, values, statuses, notifications, FactBoxes and
  messages are present;
- confirmations/dialogs appear where the spec says, and the chosen answer has the intended effect;
- the persisted record changed (reopen it or check the list) — a dialog alone is not proof;
- error paths show the expected message (the spec's *Error Scenarios*);
- a second check reflects the final state.

### 6. Clean up and report

1. Restore changed shared data to the recorded baseline (or a safe value the scenario defines).
2. Never delete or overwrite records merely because you found them during discovery.
3. Take a screenshot for each failure and for user-requested proof points.
4. If the browser session, network, authentication or environment is unavailable, report the blocker —
   never claim success.
5. Mark the verified criteria in the spec's `acceptance-criteria.md` as `Pass (manual)` with the
   environment and date (see `bc-build-feature` Step 6).

## Reporting format

```text
Environment: <environment type> / <launch configuration>
Company: <company>
Page: <page ID and caption>
Scenario: <AC-0x short name>

PASS: <assertion>
FAIL: <assertion, observed value, expected value>

Data changed: <yes/no and records>
Cleanup: <completed / not performed / blocker>
Evidence: <screenshot or browser page>
```

## Guardrails

- Don't publish to production as part of an interactive test.
- Don't invent test values, company names, page IDs or launch targets.
- Don't call a test successful because a dialog opened — verify the persisted record.
- Don't rely on a stale browser page after publishing; reload or open a fresh session.
- Don't modify AL code while testing unless the user turns the task into a fix.
- Keep assertions narrow and tied to the acceptance criterion being verified.
