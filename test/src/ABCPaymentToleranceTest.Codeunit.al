codeunit 50150 "ABC Payment Tolerance Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        LibraryAssert: Codeunit "Library Assert";

    [Test]
    procedure CalculateToleranceReturnsExpectedAmount()
    var
        ToleranceMgt: Codeunit "ABC Payment Tolerance Mgt.";
        Result: Decimal;
    begin
        // [GIVEN] An invoice of 1000 with a 1% tolerance
        // [WHEN] CalculateTolerance is called
        Result := ToleranceMgt.CalculateTolerance(1000, 1);
        // [THEN] The tolerance amount is 10
        LibraryAssert.AreEqual(10, Result, 'Incorrect tolerance amount');
    end;

    [Test]
    procedure CalculateToleranceWithZeroPercentReturnsZero()
    var
        ToleranceMgt: Codeunit "ABC Payment Tolerance Mgt.";
        Result: Decimal;
    begin
        // [GIVEN] An amount of 1000 with a 0% tolerance
        // [WHEN] CalculateTolerance is called
        Result := ToleranceMgt.CalculateTolerance(1000, 0);
        // [THEN] The tolerance amount is 0
        LibraryAssert.AreEqual(0, Result, 'Zero percent tolerance should return zero');
    end;

    [Test]
    procedure CalculateToleranceWithNegativeAmountErrors()
    var
        ToleranceMgt: Codeunit "ABC Payment Tolerance Mgt.";
    begin
        // [GIVEN] A negative amount
        // [WHEN] CalculateTolerance is called
        asserterror ToleranceMgt.CalculateTolerance(-100, 1);
        // [THEN] An error is raised
        LibraryAssert.ExpectedError('Cannot calculate a payment tolerance for a negative amount');
    end;

    [Test]
    procedure CustomerToleranceFallsBackToSetupDefault()
    var
        PaymentSetup: Record "ABC Payment Setup";
        ToleranceMgt: Codeunit "ABC Payment Tolerance Mgt.";
        Result: Decimal;
    begin
        // [GIVEN] A payment setup with a 2% default and a customer that has no specific tolerance
        PaymentSetup.GetSingleton();
        PaymentSetup.Validate("Default Payment Tolerance %", 2);
        PaymentSetup.Modify();
        // [WHEN] The customer tolerance is calculated for a customer without an own percentage
        Result := ToleranceMgt.CalculateCustomerTolerance('', 1000);
        // [THEN] The setup default is applied: 1000 * 2% = 20
        LibraryAssert.AreEqual(20, Result, 'Customer tolerance should fall back to the setup default');
    end;
}
