<#
.SYNOPSIS
    Overlays this BC ALM template onto an EXISTING repository without clobbering
    files you already have.

.DESCRIPTION
    Copies the template's agents, skills, instructions, meta-docs, docs, the
    initializer script, and template.config.json into an existing repo.

    Files are handled by policy:
      * Add   - new paths (agents, skills, instructions, docs ...). Copied if the
                target does not already have them; existing files are SKIPPED
                (use -Force to overwrite).
      * Merge - files that commonly already exist (copilot-instructions, PR
                template, .vscode/*, .gitignore). If the target already has the
                file, the template version is written next to it with a
                '.template' suffix so you can merge by hand. The script never
                overwrites these unless you pass -Force.

    The sample AL app (app/ and test/ projects + the .code-workspace) is NOT copied
    unless you pass -IncludeSampleApp - an existing repo usually already has its own
    AL code.

    After overlaying, run scripts/Initialize-Template.ps1 inside the target repo
    to replace the ABC / object-range / org tokens with your real values.

.EXAMPLE
    pwsh ./scripts/Install-IntoExistingRepo.ps1 -TargetRepo C:\src\my-bc-app -WhatIf

.EXAMPLE
    pwsh ./scripts/Install-IntoExistingRepo.ps1 -TargetRepo C:\src\my-bc-app

.EXAMPLE
    pwsh ./scripts/Install-IntoExistingRepo.ps1 -TargetRepo C:\src\my-bc-app -Force -IncludeSampleApp
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)]
    [string] $TargetRepo,

    # Overwrite existing files instead of skipping (Add) or writing .template (Merge).
    [switch] $Force,

    # Also copy the sample AL app (app/ and test/ projects). Off by default.
    [switch] $IncludeSampleApp,

    [string] $SourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$ErrorActionPreference = 'Stop'

$SourceRoot = (Resolve-Path $SourceRoot).Path
if (-not (Test-Path $TargetRepo)) { throw "Target repo path not found: $TargetRepo" }
$TargetRepo = (Resolve-Path $TargetRepo).Path
if ($SourceRoot -eq $TargetRepo) { throw "Target repo must be different from the template source." }

Write-Host "Overlaying BC ALM template" -ForegroundColor White
Write-Host "  from: $SourceRoot"
Write-Host "  to  : $TargetRepo`n"

$script:added = 0; $script:skipped = 0; $script:merged = 0

function Copy-One([string] $rel, [string] $policy) {
    $src = Join-Path $SourceRoot $rel
    if (-not (Test-Path $src)) { return }
    $dst = Join-Path $TargetRepo $rel
    $dstDir = Split-Path $dst -Parent
    $exists = Test-Path $dst

    if (-not $exists -or $Force) {
        if ($PSCmdlet.ShouldProcess($dst, "Copy $rel")) {
            if (-not (Test-Path $dstDir)) { New-Item -ItemType Directory -Path $dstDir -Force | Out-Null }
            Copy-Item $src $dst -Force
        }
        if ($exists) { Write-Host "  overwrote  $rel" -ForegroundColor Yellow }
        else { Write-Host "  added      $rel" -ForegroundColor Green }
        $script:added++
        return
    }

    switch ($policy) {
        'Add' {
            Write-Host "  exists     $rel  (skipped)" -ForegroundColor DarkGray
            $script:skipped++
        }
        'Merge' {
            $tmpl = "$dst.template"
            if ($PSCmdlet.ShouldProcess($tmpl, "Write $rel.template for manual merge")) {
                Copy-Item $src $tmpl -Force
            }
            Write-Host "  MERGE      $rel  -> review $rel.template" -ForegroundColor Cyan
            $script:merged++
        }
    }
}

function Copy-Tree([string] $relDir, [string] $policy) {
    $srcDir = Join-Path $SourceRoot $relDir
    if (-not (Test-Path $srcDir)) { return }
    Get-ChildItem $srcDir -Recurse -File | ForEach-Object {
        $rel = $_.FullName.Substring($SourceRoot.Length).TrimStart('\', '/')
        Copy-One $rel $policy
    }
}

# --- Add: new paths, safe to drop in (skip if the target already has them) ---
$addTrees = @(
    '.github/agents',
    '.github/skills',
    '.github/instructions',
    '.github/ISSUE_TEMPLATE',
    '.github/workflows',
    'docs',
    'specs/_TEMPLATE'
)
$addFiles = @(
    '.github/AGENT-ARCHITECTURE.md',
    '.github/WHEN-TO-USE.md',
    '.github/SKILLS.md',
    '.github/ISSUE_ORCHESTRATION.md',
    'scripts/Initialize-Template.ps1',
    'scripts/Add-BCQuality.ps1',
    'scripts/Start-ALLanguageServer.ps1',
    'scripts/Update-FromTemplate.ps1',
    '.templatesyncignore',
    'template.config.json'
)

# --- Merge: likely already present; write '.template' instead of clobbering ---
$mergeFiles = @(
    '.github/copilot-instructions.md',
    '.github/PULL_REQUEST_TEMPLATE.md',
    '.vscode/extensions.json',
    '.vscode/settings.json',
    '.vscode/mcp.json',
    '.vscode/launch.json',
    '.vscode/tasks.json',
    '.gitignore'
)

Write-Host "Core template files" -ForegroundColor White
foreach ($t in $addTrees) { Copy-Tree $t 'Add' }
foreach ($f in $addFiles) { Copy-One $f 'Add' }

Write-Host "`nMerge-sensitive files" -ForegroundColor White
foreach ($f in $mergeFiles) { Copy-One $f 'Merge' }

if ($IncludeSampleApp) {
    Write-Host "`nSample AL app" -ForegroundColor White
    Copy-Tree 'app' 'Add'
    Copy-Tree 'test' 'Add'
    Copy-One 'bc-alm-template.code-workspace' 'Merge'
}

Write-Host "`nSummary: $($script:added) added/overwritten, $($script:skipped) skipped, $($script:merged) need manual merge (.template)" -ForegroundColor White

Write-Host "`nNext steps:" -ForegroundColor White
Write-Host "  1. Resolve any '*.template' files (diff against your existing file, then delete the .template)."
Write-Host "  2. cd '$TargetRepo'"
Write-Host "  3. pwsh ./scripts/Initialize-Template.ps1 -Interactive   # replace ABC / range / org tokens"
Write-Host "     (or, in VS Code: Terminal -> Run Task... -> 'BC: Initialize project (guided)' for a form-style wizard)"
Write-Host "  4. Review 'git status' / 'git diff', then commit."
Write-Host "  5. If you open your AL projects via a multi-root *.code-workspace, add this to its"
Write-Host "     'settings' block so Copilot finds the agents/skills at the repo root:"
Write-Host '        "chat.useCustomizationsInParentRepositories": true' -ForegroundColor Cyan
Write-Host "  6. Later, pull template updates any time with: pwsh ./scripts/Update-FromTemplate.ps1 -WhatIf"
Write-Host "     (or let the '.github/workflows/template-sync.yml' Action open a PR for you)."
if (-not $IncludeSampleApp) {
    Write-Host "  (Sample AL app skipped - your existing app/ and test/ code was left untouched.)" -ForegroundColor DarkGray
}
