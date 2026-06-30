# Test App

This folder is a **separate AL test app** (`test/app.json`) that depends on the
production app and the Microsoft test libraries. Keeping tests in their own app means
test code and test-library dependencies are **never shipped** in the production
extension.

```
test/
├── app.json   ← Test app manifest: depends on the main app + Library Assert + Any
└── src/       ← Test codeunits (Subtype = Test, GIVEN / WHEN / THEN structure)
```

## Dependencies

`test/app.json` declares dependencies on:

- The production app (`ABC Payment Tolerance`) — so the tests can reference its objects.
- `Microsoft` → **Library Assert** (`LibraryAssert.AreEqual`, `ExpectedError`, …).
- `Microsoft` → **Any** (random test-data helpers).

These symbols come from the **Test Toolkit**, which must be installed on the sandbox
you point the test app at. Run **AL: Download Symbols** in VS Code after configuring the
launch target so the test-library symbols resolve (headless/CI: fetch them from the public
MSSymbolsV2 feed — see [`docs/al-agent-tools.md`](../docs/al-agent-tools.md)).

## Running the tests

- **VS Code:** use the [AL Test Runner](https://marketplace.visualstudio.com/items?itemName=jamespearson.al-test-runner)
  extension, or publish the test app and run the *Test Tool* page (130401).
- **CI / headless:** AL-Go for GitHub runs test apps automatically. See
  [`docs/al-go-upgrade.md`](../docs/al-go-upgrade.md) and
  [`docs/al-agent-tools.md`](../docs/al-agent-tools.md) for the `al`/ALTool workflow.

Follow the GIVEN / WHEN / THEN structure and object-ID rules in the
[AL coding standards](../.github/instructions/al-coding-standards.instructions.md).
