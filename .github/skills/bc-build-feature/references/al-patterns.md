# AL Patterns — copy-ready snippets

Reference for `bc-build-feature`. Replace the sample `ABC` prefix and `50100–50199` range
with your own assigned values. All snippets follow
[`../../../instructions/al-coding-standards.instructions.md`](../../../instructions/al-coding-standards.instructions.md).

## Table Extension (add fields to a base table)

```al
tableextension 50102 "Customer ABC Ext." extends Customer
{
    fields
    {
        field(50100; "ABC Payment Tolerance %"; Decimal)
        {
            Caption = 'Payment Tolerance %';
            DataClassification = CustomerContent;
            MinValue = 0;
            MaxValue = 100;
        }
    }
}
```

Rules: extension object ID and field IDs in your range · `DataClassification` on every field ·
use Decimal/Integer/Boolean/Text — never Option (use an Enum).

## Enum (prefer over Option)

```al
enum 50100 "ABC Payment Method Type"
{
    Extensible = true;
    Caption = 'Payment Method Type';

    value(0; Standard) { Caption = 'Standard'; }
    value(1; Tolerance) { Caption = 'Tolerance'; }
    value(2; Discount) { Caption = 'Discount'; }
}
```

## Codeunit (single responsibility)

```al
codeunit 50103 "ABC Payment Tolerance Mgt."
{
    procedure CalculateTolerance(Amount: Decimal; TolerancePct: Decimal): Decimal
    begin
        if (Amount = 0) or (TolerancePct = 0) then
            exit(0);
        exit(Amount * (TolerancePct / 100));
    end;
}
```

## Event subscriber (prefer over base modifications)

```al
codeunit 50105 "ABC Payment Event Subscriber"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"Gen. Jnl.-Post Line", 'OnAfterInitGLRegister', '', false, false)]
    local procedure OnAfterInitGLRegister(var GenJnlLine: Record "Gen. Journal Line")
    begin
        // custom logic
    end;
}
```

## Error handling with Labels

```al
var
    NoTolerancePctErr: Label 'Payment tolerance percentage must be greater than zero for customer %1.', Comment = '%1 = Customer No.';
begin
    if Customer."ABC Payment Tolerance %" = 0 then
        Error(NoTolerancePctErr, Customer."No.");
end;
```

## Read-only query (performance)

```al
procedure GetCustomerBalance(CustomerNo: Code[20]): Decimal
var
    CustLedgerEntry: Record "Cust. Ledger Entry";
begin
    CustLedgerEntry.SetLoadFields("Remaining Amount");
    CustLedgerEntry.SetRange("Customer No.", CustomerNo);
    CustLedgerEntry.SetRange(Open, true);
    CustLedgerEntry.ReadIsolation(IsolationLevel::ReadUncommitted);
    CustLedgerEntry.CalcSums("Remaining Amount");
    exit(CustLedgerEntry."Remaining Amount");
end;
```

## Test codeunit

```al
codeunit 50150 "ABC Payment Tolerance Test"
{
    Subtype = Test;

    [Test]
    procedure TestCalculateToleranceBasic()
    var
        Mgt: Codeunit "ABC Payment Tolerance Mgt.";
    begin
        // [GIVEN] amount 1000, tolerance 1%
        // [WHEN] CalculateTolerance is called
        // [THEN] result is 10
        Assert.AreEqual(10, Mgt.CalculateTolerance(1000, 1), 'Tolerance should be 1% of 1000');
    end;
}
```

## Permission set

```al
permissionset 50104 "ABC Payment Tolerance"
{
    Assignable = true;
    Caption = 'Payment Tolerance';

    Permissions =
        tabledata Customer = RIMD,
        codeunit "ABC Payment Tolerance Mgt." = X;
}
```
