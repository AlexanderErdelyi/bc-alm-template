---
applyTo: "**/*.al"
---

# AL Coding Standards for Business Central Extensions

These standards apply to all AL files in this repository. GitHub Copilot will follow these rules when generating or modifying AL code.

---

## Object Naming

- All object names in **PascalCase**
- Prefix object names with your assigned app prefix (e.g., `"ABC Payment Tolerance Mgt."`)
- Object IDs must be within your assigned object ID range — never use IDs outside your range
- Table Extension names: `"[Base Table Name] [App Prefix] Ext."` e.g., `"Customer ABC Ext."`
- Always use double quotes around object names in AL

```al
// ✅ Correct
codeunit 50100 "ABC Payment Tolerance Mgt."
tableextension 50100 "Customer ABC Ext." extends Customer

// ❌ Wrong
codeunit 50100 PaymentToleranceMgt
tableextension 50100 MyCustomerExt extends Customer
```

---

## Variable Naming

| Scope | Convention | Example |
|---|---|---|
| Local variable | lowerCamelCase | `var toleranceAmount: Decimal;` |
| Global variable | PascalCase | `var TotalAmount: Decimal;` |
| Parameter | PascalCase | `procedure Calculate(Amount: Decimal)` |
| Label/text constant | PascalCase + suffix | `NoAmountErr`, `PostedMsg`, `DeleteQst` |

Label suffixes:
- `Err` — error message: `NoCustomerErr`
- `Msg` — informational message: `PaymentPostedMsg`
- `Qst` — question/confirmation: `DeleteConfirmQst`
- `Lbl` — general label/caption: `TotalAmountLbl`

---

## No Hardcoded Text

All user-visible text must be declared as a `Label` variable. Never use string literals in `Error()`, `Message()`, `StrSubstNo()`, or field captions.

```al
// ✅ Correct
var
    CustomerNotFoundErr: Label 'Customer %1 was not found.', Comment = '%1 = Customer No.';
begin
    Error(CustomerNotFoundErr, CustomerNo);
end;

// ❌ Wrong
begin
    Error('Customer was not found.');
end;
```

The `Comment` placeholder in Label variables must explain what each `%1`, `%2` etc. represents.

---

## No Hardcoded IDs

Never hardcode numeric IDs for BC objects (table IDs, codeunit IDs, page IDs) or record keys (country codes, currency codes, document type integers).

```al
// ✅ Correct — use enum values
if GenJournalLine."Document Type" = GenJournalLine."Document Type"::Invoice then

// ✅ Correct — use named constant or setup table
var
    PaymentSetup: Record "ABC Payment Setup";
begin
    PaymentSetup.Get();
    TaxRateCode := PaymentSetup."Default Tax Rate Code";
end;

// ❌ Wrong — hardcoded ID
if GenJournalLine."Document Type" = 2 then

// ❌ Wrong — hardcoded country code
if Customer."Country/Region Code" = 'GB' then
```

---

## Extension Tables for New Fields

Never modify base BC table objects. All new fields on existing BC tables must be added via Table Extension objects.

```al
// ✅ Correct
tableextension 50100 "Customer ABC Ext." extends Customer
{
    fields
    {
        field(50100; "ABC Payment Tolerance %"; Decimal)
        {
            Caption = 'Payment Tolerance %';
            DataClassification = CustomerContent;
        }
    }
}

// ❌ Wrong — never modify base tables
table 18 Customer // DO NOT DO THIS
{
    // ...
}
```

Every field in a Table Extension must have `DataClassification` set. Use `CustomerContent` for business data, `SystemMetadata` for internal system fields.

---

## Event Subscribers Over Direct Modifications

Before creating a new procedure to call inline, check if a BC publisher event exists. Subscribing to existing events is safer than modifying base codeunits.

```al
// ✅ Preferred — subscribe to existing event
[EventSubscriber(ObjectType::Codeunit, Codeunit::"Sales-Post", 'OnAfterPostSalesDoc', '', false, false)]
local procedure OnAfterPostSalesDoc(var SalesHeader: Record "Sales Header")
begin
    // Custom post-posting logic
end;

// Use direct modification only when no suitable event exists
```

When creating new events in your own codeunits, always mark them with `[IntegrationEvent(false, false)]` to allow other extensions to subscribe.

---

## Error Handling

Use `Error()` with descriptive Label messages. Include context (record identifiers) in error messages so users know exactly what failed.

For user-confirmable actions, use `Confirm()` before destructive operations.

```al
// ✅ Correct
var
    CannotPostZeroAmountErr: Label 'Cannot post entry for %1 with zero amount.', Comment = '%1 = Customer No.';
    DeleteEntriesQst: Label 'This will delete all %1 entries. Are you sure?', Comment = '%1 = Number of entries';
begin
    if Amount = 0 then
        Error(CannotPostZeroAmountErr, Customer."No.");

    if not Confirm(DeleteEntriesQst, false, EntryCount) then
        exit;
end;
```

Do not use empty `catch` blocks or silently swallow errors.

---

## Read-Only Query Performance

For read-only data access, always use:
- `SetLoadFields()` to load only required fields
- `ReadIsolation(IsolationLevel::ReadUncommitted)` (equivalent to `WITH (NOLOCK)`) for non-critical reads
- `CalcSums()` with `SetRange()` instead of looping for aggregates

```al
// ✅ Correct — efficient read
procedure GetOpenInvoiceCount(CustomerNo: Code[20]): Integer
var
    CustLedgerEntry: Record "Cust. Ledger Entry";
begin
    CustLedgerEntry.SetLoadFields("Entry No.");
    CustLedgerEntry.SetRange("Customer No.", CustomerNo);
    CustLedgerEntry.SetRange(Open, true);
    CustLedgerEntry.SetRange("Document Type", CustLedgerEntry."Document Type"::Invoice);
    CustLedgerEntry.ReadIsolation(IsolationLevel::ReadUncommitted);
    exit(CustLedgerEntry.Count());
end;
```

Avoid looping over large tables without filters. Add appropriate `SetRange()` or `SetFilter()` calls before any `FindSet()` or `FindFirst()`.

---

## Codeunit Single Responsibility

Each codeunit should have one clear purpose. Split codeunits when they grow beyond one responsibility.

- `"ABC Payment Tolerance Mgt."` — tolerance calculation logic only
- `"ABC Payment Posting"` — posting logic only
- `"ABC Payment Validation"` — validation logic only

Do not create one "utility" codeunit that handles everything.

---

## app.json Versioning

Format: `major.minor.build.revision`

| Change type | Bump | Example |
|---|---|---|
| Bug fix / patch | Build (+1) | `1.2.3.0` → `1.2.4.0` |
| New feature | Minor (+1), build reset | `1.2.3.0` → `1.3.0.0` |
| Breaking change | Major (+1), minor+build reset | `1.2.3.0` → `2.0.0.0` |

Always bump `app.json` version in the same PR as the code change. Never ship a PR without a version bump.

---

## Permission Sets

Every new AL object (Table, Page, Codeunit, Report, Query) must be covered by a Permission Set or Permission Set Extension.

```al
permissionset 50100 "ABC PAYMENT"
{
    Assignable = true;
    Caption = 'ABC Payment Features';
    Permissions =
        tabledata "ABC Payment Setup" = RIMD,
        codeunit "ABC Payment Tolerance Mgt." = X,
        page "ABC Payment Setup Card" = X,
        page "ABC Payment Tolerance List" = X;
}
```

Include both `tabledata` permissions (for direct table access) and object permissions (for executing codeunits, opening pages).

---

## Test Codeunits

Every new business logic codeunit must have a corresponding test codeunit.

- Subtype must be `Test`
- Use `[Test]` attribute on test procedures
- Follow GIVEN/WHEN/THEN comment structure strictly
- Cover both happy path and the edge cases from `acceptance-criteria.md`
- Test codeunit object ID: use your range + offset (e.g., business logic at 50100-50120, tests at 50150-50170)

```al
codeunit 50150 "ABC Payment Tolerance Test"
{
    Subtype = Test;

    [Test]
    procedure TestToleranceCalculation()
    var
        ToleranceMgt: Codeunit "ABC Payment Tolerance Mgt.";
        Result: Decimal;
    begin
        // [GIVEN] An invoice of 1000 with 1% tolerance
        // [WHEN] CalculateTolerance is called
        Result := ToleranceMgt.CalculateTolerance(1000, 1);
        // [THEN] The tolerance amount is 10
        LibraryAssert.AreEqual(10, Result, 'Incorrect tolerance amount');
    end;
}
```

One test procedure per acceptance criterion (AC-01, AC-02, etc.) where feasible.
