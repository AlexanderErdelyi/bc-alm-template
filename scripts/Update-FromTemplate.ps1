<#
.SYNOPSIS
    Updates the template-managed files in THIS repo from the latest
    bc-alm-template (the "update from template" flow, run locally).

.DESCRIPTION
    Fetches the template's default branch into a temporary clone and refreshes the
    files the template owns - agents, skills, instructions, workflows, meta-docs,
    scripts, and the shared .vscode files. Your project-owned files are never
    touched: AL source (app/, test/), your specs, PROJECT.md, template.config.json,
    copilot-instructions.md, and the token-injected .vscode files (launch.json,
    mcp.json, settings.json).

    This mirrors the .templatesyncignore split used by the GitHub Action
    (.github/workflows/template-sync.yml). Use the Action for automatic PRs; use
    this script when you want to pull updates on demand from your machine.

    Nothing is committed. After it runs, review 'git diff' and commit what you want.

.EXAMPLE
    pwsh ./scripts/Update-FromTemplate.ps1 -WhatIf

.EXAMPLE
    pwsh ./scripts/Update-FromTemplate.ps1

.EXAMPLE
    pwsh ./scripts/Update-FromTemplate.ps1 -TemplateUrl https://github.com/AlexanderErdelyi/bc-alm-template.git -Branch main
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string] $TemplateUrl = 'https://github.com/AlexanderErdelyi/bc-alm-template.git',
    [string] $Branch = 'main',
    [string] $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path $RepoRoot).Path

# Template-managed paths (refreshed from the template). Everything here is safe to
# overwrite because none of it is token-injected or project-owned. Keep this list
# in sync with .templatesyncignore (which is the inverse) and Install-IntoExistingRepo.ps1.
$managedTrees = @(
    '.github/agents',
    '.github/skills',
    '.github/instructions',
    '.github/ISSUE_TEMPLATE',
    '.github/workflows',
    'docs',
    'specs/_TEMPLATE'
)
$managedFiles = @(
    '.github/AGENT-ARCHITECTURE.md',
    '.github/WHEN-TO-USE.md',
    '.github/SKILLS.md',
    '.github/ISSUE_ORCHESTRATION.md',
    '.github/PULL_REQUEST_TEMPLATE.md',
    'scripts/Initialize-Template.ps1',
    'scripts/Add-BCQuality.ps1',
    'scripts/Start-ALLanguageServer.ps1',
    'scripts/Update-FromTemplate.ps1',
    'scripts/Install-IntoExistingRepo.ps1',
    '.vscode/extensions.json',
    '.vscode/tasks.json',
    '.templatesyncignore'
)

$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) { throw "git is required but was not found on PATH." }

$temp = Join-Path ([System.IO.Path]::GetTempPath()) ("bc-template-" + [guid]::NewGuid().ToString('N'))
Write-Host "Fetching template $TemplateUrl ($Branch)..." -ForegroundColor White
& git clone --depth 1 --branch $Branch --quiet $TemplateUrl $temp
if ($LASTEXITCODE -ne 0) { throw "git clone failed for $TemplateUrl ($Branch)." }

$updated = 0; $added = 0; $unchanged = 0

function Get-Hash([string] $path) {
    if (-not (Test-Path $path)) { return $null }
    return (Get-FileHash -Algorithm SHA256 -Path $path).Hash
}

function Update-One([string] $rel) {
    $src = Join-Path $temp $rel
    if (-not (Test-Path $src)) { return }
    $dst = Join-Path $RepoRoot $rel
    $dstDir = Split-Path $dst -Parent
    $existed = Test-Path $dst

    if ($existed -and ((Get-Hash $src) -eq (Get-Hash $dst))) {
        $script:unchanged++
        return
    }

    if ($PSCmdlet.ShouldProcess($dst, "Update $rel from template")) {
        if (-not (Test-Path $dstDir)) { New-Item -ItemType Directory -Path $dstDir -Force | Out-Null }
        Copy-Item $src $dst -Force
    }
    if ($existed) { Write-Host "  updated    $rel" -ForegroundColor Yellow; $script:updated++ }
    else { Write-Host "  added      $rel" -ForegroundColor Green; $script:added++ }
}

function Update-Tree([string] $relDir) {
    $srcDir = Join-Path $temp $relDir
    if (-not (Test-Path $srcDir)) { return }
    Get-ChildItem $srcDir -Recurse -File | ForEach-Object {
        $rel = $_.FullName.Substring($temp.Length).TrimStart('\', '/').Replace('\', '/')
        Update-One $rel
    }
}

try {
    Write-Host "`nRefreshing template-managed files" -ForegroundColor White
    foreach ($t in $managedTrees) { Update-Tree $t }
    foreach ($f in $managedFiles) { Update-One $f }
}
finally {
    if (Test-Path $temp) { Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue }
}

Write-Host "`nSummary: $added added, $updated updated, $unchanged already current." -ForegroundColor White
Write-Host "Project-owned files (app/, test/, specs/, PROJECT.md, template.config.json," -ForegroundColor DarkGray
Write-Host "copilot-instructions.md, .vscode/launch.json|mcp.json|settings.json) were left untouched." -ForegroundColor DarkGray
Write-Host "`nNext: review 'git diff', then commit the updates you want to keep." -ForegroundColor White
