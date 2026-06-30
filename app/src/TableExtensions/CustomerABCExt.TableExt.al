tableextension 50102 "Customer ABC Ext." extends Customer
{
    fields
    {
        field(50100; "ABC Payment Tolerance %"; Decimal)
        {
            Caption = 'Payment Tolerance %';
            DataClassification = CustomerContent;
            DecimalPlaces = 0 : 5;
            MinValue = 0;
            MaxValue = 100;
        }
    }
}
