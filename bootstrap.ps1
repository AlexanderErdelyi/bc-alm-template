<#
.SYNOPSIS
    Add the BC ALM template to an EXISTING repo without cloning it first.

.DESCRIPTION
    Downloads this template as a zip from GitHub, then runs its overlay installer
    (Install-IntoExistingRepo.ps1) against your current repo. Nothing is committed
    and your existing files are never clobbered - see the installer for the exact
    add/merge policy. Run this from the ROOT of the repo you want to overlay.

    One-liner (PowerShell 7+), run from inside your existing repo:

        $b = irm https://raw.githubusercontent.com/AlexanderErdelyi/bc-alm-template/main/bootstrap.ps1
        & ([scriptblock]::Create($b)) -WhatIf     # preview; drop -WhatIf to apply

.EXAMPLE
    pwsh ./bootstrap.ps1 -WhatIf

.EXAMPLE
    pwsh ./bootstrap.ps1 -Force -IncludeSampleApp
#>
[CmdletBinding()]
param(
    # Repo to overlay the template onto. Defaults to the current directory.
    [string] $TargetRepo = (Get-Location).Path,

    # Template branch/tag to pull. Defaults to main.
    [string] $Ref = 'main',

    # Overwrite existing files instead of skipping / writing .template.
    [switch] $Force,

    # Also copy the sample AL app (app/ and test/ projects).
    [switch] $IncludeSampleApp,

    # Preview only - pass through to the installer's -WhatIf.
    [switch] $WhatIf
)

$ErrorActionPreference = 'Stop'
$repo = 'AlexanderErdelyi/bc-alm-template'

$TargetRepo = (Resolve-Path $TargetRepo).Path
Write-Host "Bootstrapping BC ALM template ($Ref) into: $TargetRepo" -ForegroundColor White

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("bc-bootstrap-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
$zip = Join-Path $tmp 'template.zip'
$url = "https://github.com/$repo/archive/refs/heads/$Ref.zip"

try {
    Write-Host "Downloading $url ..." -ForegroundColor White
    try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
    Expand-Archive -Path $zip -DestinationPath $tmp -Force

    $srcRoot = Get-ChildItem -Path $tmp -Directory | Where-Object { $_.Name -like 'bc-alm-template-*' } | Select-Object -First 1
    if (-not $srcRoot) { throw "Could not find the extracted template folder under $tmp." }

    $installer = Join-Path $srcRoot.FullName 'scripts/Install-IntoExistingRepo.ps1'
    if (-not (Test-Path $installer)) { throw "Installer not found in the downloaded template: $installer" }

    Write-Host "Running overlay installer...`n" -ForegroundColor White
    & $installer -TargetRepo $TargetRepo -SourceRoot $srcRoot.FullName -Force:$Force -IncludeSampleApp:$IncludeSampleApp -WhatIf:$WhatIf
}
finally {
    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
}
