---
applyTo: "test/**/*.al,**/*Test*.Codeunit.al"
description: "Test codeunit standards for Business Central AL tests (test app)"
---

# AL Test Codeunit Standards

These rules extend [al-coding-standards.instructions.md](al-coding-standards.instructions.md) and
apply to the AL files of the separate `test/` app (and any `*Test*.Codeunit.al`). The worked example
in the template is `test/src/ABCPaymentToleranceTest.Codeunit.al`.

---

## Where tests live

- Tests go into the **separate test app** (`test/`), never into the production app (`app/`). The
  test app depends on the production app and on the Microsoft test libraries (`Library Assert`,
  `Any`, …) — never ship it to production.
- One test codeunit per business-logic codeunit (or per story when the logic is spread out).

## Subtype and object ID

- `Subtype = Test;` — and set `TestPermissions` deliberately (`Disabled` for pure logic tests;
  `Restrictive`/`NonRestrictive` when you want to verify permission sets).
- Test codeunit IDs are **offset +50** from their subject inside the assigned range (business logic
  at `50100–50110` → tests at `50150–50160`). Reserve the ID via Object ID Ninja (`ninjaNextId`).

```al
codeunit 50150 "ABC Payment Tolerance Test"
{
    Subtype = Test;
    TestPermissions = Disabled;
    ...
}
```

## Test procedures — one per acceptance criterion

- Write **at least one `[Test]` procedure per acceptance criterion** (`AC-01`, `AC-02`, … in the
  spec's `acceptance-criteria.md`) where it can be automated; name the AC in the `[GIVEN]` or a
  `// AC-01` comment so reviewers can trace coverage.
- Procedure names describe the behaviour in PascalCase: `<Subject><Condition><ExpectedResult>`,
  e.g. `CalculateToleranceWithZeroPercentReturnsZero`.
- Every body follows **GIVEN / WHEN / THEN** with comment headers:

```al
[Test]
procedure CalculateToleranceReturnsExpectedAmount()
var
    ToleranceMgt: Codeunit "ABC Payment Tolerance Mgt.";
    Result: Decimal;
begin
    // [GIVEN] An invoice of 1000 with a 1% tolerance (AC-01)
    // [WHEN] CalculateTolerance is called
    Result := ToleranceMgt.CalculateTolerance(1000, 1);
    // [THEN] The tolerance amount is 10
    LibraryAssert.AreEqual(10, Result, 'Incorrect tolerance amount');
end;
```

## Coverage

- Cover the **happy path** and every edge case listed in `acceptance-criteria.md`.
- Cover at least one **error/validation path** — `asserterror` + `LibraryAssert.ExpectedError(...)`,
  or a `[ConfirmHandler]` / `[MessageHandler]` for dialogs.
- Test your own logic, not platform behaviour.
- Criteria that can't be automated (UI layout, external systems) are marked
  `Pass (manual)` in `acceptance-criteria.md` with a short note on how they were verified.

## Helpers and libraries

- Reuse the Microsoft test libraries (`Library Assert`, `Any`, `Library - Sales`, …) before writing
  helpers.
- Shared setup/data builders go into one **helper codeunit** in the test app (e.g.
  `"ABC Test Helper"`, a normal codeunit), not copy-pasted across test codeunits.
- **Never call `Commit()`** in a test. Tests roll back by default (`TestIsolation` on the test
  runner); use `[TransactionModel(TransactionModel::AutoRollback)]` on a test that must not commit.
- Initialize shared state in a local `Initialize()` procedure guarded by an `IsInitialized` flag.

## Assertion messages

- Give every assertion a message that says **what** was wrong. Test apps aren't translated, so a
  short literal message is fine; use a `Label` with placeholders when the message is reused or
  includes values:

```al
var
    WrongToleranceErr: Label 'Expected tolerance %1, got %2.', Comment = '%1 = expected, %2 = actual';
begin
    LibraryAssert.AreEqual(Expected, Actual, StrSubstNo(WrongToleranceErr, Expected, Actual));
end;
```

## Spec write-back

After the tests pass, mark the covered criteria in `acceptance-criteria.md` (`Open → Pass`) — see
`bc-build-feature` Step 6.
