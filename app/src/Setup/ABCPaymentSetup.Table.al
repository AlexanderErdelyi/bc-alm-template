table 50100 "ABC Payment Setup"
{
    Caption = 'Payment Setup';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Primary Key"; Code[10])
        {
            Caption = 'Primary Key';
            DataClassification = SystemMetadata;
        }
        field(10; "Default Payment Tolerance %"; Decimal)
        {
            Caption = 'Default Payment Tolerance %';
            DataClassification = CustomerContent;
            DecimalPlaces = 0 : 5;
            MinValue = 0;
            MaxValue = 100;
        }
    }

    keys
    {
        key(PK; "Primary Key")
        {
            Clustered = true;
        }
    }

    procedure GetSingleton()
    begin
        if Rec.Get() then
            exit;
        Rec.Init();
        Rec.Insert();
    end;
}
