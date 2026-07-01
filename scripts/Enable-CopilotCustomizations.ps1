<#
.SYNOPSIS
    Makes the BC ALM Copilot customizations (agents, skills, instructions) discoverable
    no matter how you open the repo, by enabling parent-repository discovery.

.DESCRIPTION
    VS Code only finds .github/ customizations at a workspace-folder root. When you open
    the app/ or test/ project folder directly - or a multi-root *.code-workspace whose roots
    are app/ and test/ - the repo-root .github/ is above the workspace, so the agents don't
    appear. The 'chat.useCustomizationsInParentRepositories' setting fixes that by walking up
    to the .git root.

    -Scope Workspace : the shipped *.code-workspace already sets this; nothing to do (reported).
    -Scope User      : writes the setting to your VS Code USER settings.json so it applies
                       however you open folders, across every project. (Default.)

    The agents themselves stay in each repo - this only flips the discovery switch. Note that
    GitHub Actions (issue orchestration, template-sync) always read the repo-level .github/
    files, so they are unaffected by this local setting either way.

.EXAMPLE
    pwsh ./scripts/Enable-CopilotCustomizations.ps1            # User scope (recommended)

.EXAMPLE
    pwsh ./scripts/Enable-CopilotCustomizations.ps1 -Scope User -Insiders -WhatIf
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [ValidateSet('User', 'Workspace')]
    [string] $Scope = 'User',

    # Target VS Code - Insiders instead of stable.
    [switch] $Insiders,

    # Explicit path to a settings.json to edit (overrides auto-detection).
    [string] $SettingsPath
)

$ErrorActionPreference = 'Stop'
$key = 'chat.useCustomizationsInParentRepositories'

if ($Scope -eq 'Workspace') {
    Write-Host "The shipped *.code-workspace already sets `"$key`": true in its settings block." -ForegroundColor Green
    Write-Host "Open the repo via that workspace file and the bc-* agents will be discovered." -ForegroundColor Green
    Write-Host "For coverage however you open folders (e.g. opening app/ directly), run with -Scope User." -ForegroundColor DarkGray
    return
}

function Get-UserSettingsPath {
    if ($SettingsPath) { return $SettingsPath }
    $appDir = if ($Insiders) { 'Code - Insiders' } else { 'Code' }
    if ($IsWindows -or $env:OS -eq 'Windows_NT') {
        return Join-Path $env:APPDATA (Join-Path $appDir 'User/settings.json')
    }
    elseif ($IsMacOS) {
        return Join-Path $HOME (Join-Path 'Library/Application Support' (Join-Path $appDir 'User/settings.json'))
    }
    else {
        return Join-Path $HOME (Join-Path '.config' (Join-Path $appDir 'User/settings.json'))
    }
}

$path = Get-UserSettingsPath
Write-Host "VS Code user settings: $path" -ForegroundColor White

$dir = Split-Path $path -Parent
if (-not (Test-Path $dir)) {
    Write-Warning "Settings folder not found - is this VS Code edition installed? ($dir)"
}

if (-not (Test-Path $path)) {
    $content = "{`n    `"$key`": true`n}`n"
    if ($PSCmdlet.ShouldProcess($path, "Create settings.json with $key = true")) {
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        Set-Content -Path $path -Value $content -Encoding utf8
    }
    Write-Host "  created settings.json and set $key = true" -ForegroundColor Green
    return
}

$raw = Get-Content $path -Raw
if ([string]::IsNullOrWhiteSpace($raw) -or $raw.Trim() -eq '{}') {
    $new = "{`n    `"$key`": true`n}`n"
    $action = 'set'
}
elseif ($raw -match [regex]::Escape("`"$key`"")) {
    $new = [regex]::Replace($raw, ('("' + [regex]::Escape($key) + '"\s*:\s*)(true|false)'), '${1}true')
    $action = 'updated'
}
else {
    # Insert the key right after the opening brace, preserving comments and formatting.
    $idx = $raw.IndexOf('{')
    if ($idx -lt 0) { throw "Could not parse $path - no opening brace found." }
    $insert = "`n    `"$key`": true,"
    $new = $raw.Substring(0, $idx + 1) + $insert + $raw.Substring($idx + 1)
    $action = 'added'
}

if ($new -eq $raw) {
    Write-Host "  $key is already true - nothing to do." -ForegroundColor Green
    return
}

if ($PSCmdlet.ShouldProcess($path, "$action $key = true")) {
    $backup = "$path.bak"
    Copy-Item $path $backup -Force
    Set-Content -Path $path -Value $new -Encoding utf8 -NoNewline
    Write-Host "  $action $key = true  (backup: $backup)" -ForegroundColor Green
}
Write-Host "Reload VS Code (Developer: Reload Window) for the change to take effect." -ForegroundColor Cyan
