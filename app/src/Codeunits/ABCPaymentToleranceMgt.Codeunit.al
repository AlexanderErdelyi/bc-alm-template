codeunit 50103 "ABC Payment Tolerance Mgt."
{
    Access = Public;

    var
        NegativeAmountErr: Label 'Cannot calculate a payment tolerance for a negative amount %1.', Comment = '%1 = the supplied amount';

    /// <summary>
    /// Calculates the tolerance amount for a given base amount and tolerance percentage.
    /// </summary>
    procedure CalculateTolerance(Amount: Decimal; TolerancePct: Decimal): Decimal
    begin
        if Amount < 0 then
            Error(NegativeAmountErr, Amount);

        exit(Round(Amount * TolerancePct / 100));
    end;

    /// <summary>
    /// Returns the tolerance amount for a customer, using the customer's own
    /// tolerance percentage, or the setup default when the customer has none.
    /// </summary>
    procedure CalculateCustomerTolerance(CustomerNo: Code[20]; Amount: Decimal): Decimal
    begin
        exit(CalculateTolerance(Amount, GetCustomerTolerancePct(CustomerNo)));
    end;

    /// <summary>
    /// Resolves the effective tolerance percentage for a customer.
    /// </summary>
    procedure GetCustomerTolerancePct(CustomerNo: Code[20]): Decimal
    var
        Customer: Record Customer;
        PaymentSetup: Record "ABC Payment Setup";
    begin
        Customer.SetLoadFields("ABC Payment Tolerance %");
        if Customer.Get(CustomerNo) and (Customer."ABC Payment Tolerance %" > 0) then
            exit(Customer."ABC Payment Tolerance %");

        PaymentSetup.GetSingleton();
        exit(PaymentSetup."Default Payment Tolerance %");
    end;
}
