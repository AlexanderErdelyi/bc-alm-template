page 50101 "ABC Payment Setup Card"
{
    Caption = 'Payment Setup';
    PageType = Card;
    ApplicationArea = All;
    UsageCategory = Administration;
    SourceTable = "ABC Payment Setup";
    InsertAllowed = false;
    DeleteAllowed = false;

    layout
    {
        area(Content)
        {
            group(General)
            {
                Caption = 'General';

                field("Default Payment Tolerance %"; Rec."Default Payment Tolerance %")
                {
                    ApplicationArea = All;
                    ToolTip = 'Specifies the default payment tolerance percentage applied when a customer has no specific tolerance set.';
                }
            }
        }
    }

    trigger OnOpenPage()
    begin
        Rec.GetSingleton();
    end;
}
