permissionset 50104 "ABC Payment"
{
    Assignable = true;
    Caption = 'ABC Payment Features';

    Permissions =
        tabledata "ABC Payment Setup" = RIMD,
        page "ABC Payment Setup Card" = X,
        codeunit "ABC Payment Tolerance Mgt." = X;
}
