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

    # Where the VS Code-discoverable Copilot customizations (.github/agents,
    # .github/skills, .github/instructions and .github/copilot-instructions.md) go.
    # '.' (default) = the repo root .github. Set a subfolder (e.g. 'app') to place
    # them under <path>/.github so they are discovered when you open that folder
    # directly. GitHub platform files (workflows, ISSUE_TEMPLATE, PR template)
    # always stay at the repo root so Actions and Copilot on github.com keep working.
    [string] $CustomizationsPath = '.',

    [string] $SourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$ErrorActionPreference = 'Stop'

$SourceRoot = (Resolve-Path $SourceRoot).Path
if (-not (Test-Path $TargetRepo)) { throw "Target repo path not found: $TargetRepo" }
$TargetRepo = (Resolve-Path $TargetRepo).Path
if ($SourceRoot -eq $TargetRepo) { throw "Target repo must be different from the template source." }

# Folder that holds the discoverable customizations. '' = repo root.
$custRoot = ''
if ($CustomizationsPath -and $CustomizationsPath -ne '.') {
    $custRoot = $CustomizationsPath.Trim().TrimEnd('/', '\')
}

Write-Host "Overlaying BC ALM template" -ForegroundColor White
Write-Host "  from: $SourceRoot"
Write-Host "  to  : $TargetRepo"
if ($custRoot) { Write-Host "  customizations -> $custRoot/.github (platform files stay at repo root)" -ForegroundColor Cyan }
Write-Host ""

$script:added = 0; $script:skipped = 0; $script:merged = 0

# Map a source-relative path to its destination-relative path, relocating the
# VS Code-discoverable customizations under $custRoot when configured.
function Resolve-Dest([string] $rel) {
    $r = $rel.Replace('\', '/')
    if ($custRoot -and ($r -match '^\.github/(agents|skills|instructions)(/|$)' -or $r -eq '.github/copilot-instructions.md')) {
        return "$custRoot/$r"
    }
    return $r
}

function Copy-One([string] $rel, [string] $policy) {
    $src = Join-Path $SourceRoot $rel
    if (-not (Test-Path $src)) { return }
    $destRel = Resolve-Dest $rel
    $dst = Join-Path $TargetRepo $destRel
    $dstDir = Split-Path $dst -Parent
    $exists = Test-Path $dst

    if (-not $exists -or $Force) {
        if ($PSCmdlet.ShouldProcess($dst, "Copy $destRel")) {
            if (-not (Test-Path $dstDir)) { New-Item -ItemType Directory -Path $dstDir -Force | Out-Null }
            Copy-Item $src $dst -Force
        }
        if ($exists) { Write-Host "  overwrote  $destRel" -ForegroundColor Yellow }
        else { Write-Host "  added      $destRel" -ForegroundColor Green }
        $script:added++
        return
    }

    switch ($policy) {
        'Add' {
            Write-Host "  exists     $destRel  (skipped)" -ForegroundColor DarkGray
            $script:skipped++
        }
        'Merge' {
            $tmpl = "$dst.template"
            if ($PSCmdlet.ShouldProcess($tmpl, "Write $destRel.template for manual merge")) {
                Copy-Item $src $tmpl -Force
            }
            Write-Host "  MERGE      $destRel  -> review $destRel.template" -ForegroundColor Cyan
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
    'scripts/Enable-CopilotCustomizations.ps1',
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

# Record the chosen customizations location in the target's template.config.json so
# Update-FromTemplate.ps1 and the sync Action refresh the relocated files in place.
if ($custRoot) {
    $cfg = Join-Path $TargetRepo 'template.config.json'
    if (Test-Path $cfg) {
        $raw = Get-Content $cfg -Raw
        if ($raw -match '"customizationsPath"\s*:\s*"[^"]*"') {
            $new = [regex]::Replace($raw, '("customizationsPath"\s*:\s*)"[^"]*"', ('$1"{0}"' -f $custRoot))
            if ($new -ne $raw) {
                if ($PSCmdlet.ShouldProcess($cfg, "Set sync.customizationsPath = $custRoot")) {
                    Set-Content -Path $cfg -Value $new -NoNewline
                }
                Write-Host "  config     sync.customizationsPath -> $custRoot" -ForegroundColor Green
            }
        }
        else {
            Write-Host "  NOTE: add \"sync\": { \"customizationsPath\": \"$custRoot\" } to template.config.json 'values'." -ForegroundColor Yellow
        }
    }
}

Write-Host "`nSummary: $($script:added) added/overwritten, $($script:skipped) skipped, $($script:merged) need manual merge (.template)" -ForegroundColor White

Write-Host "`nNext steps:" -ForegroundColor White
Write-Host "  1. Resolve any '*.template' files (diff against your existing file, then delete the .template)."
Write-Host "  2. cd '$TargetRepo'"
Write-Host "  3. pwsh ./scripts/Initialize-Template.ps1 -Interactive   # replace ABC / range / org tokens"
Write-Host "     (or, in VS Code: Terminal -> Run Task... -> 'BC: Initialize project (guided)' for a form-style wizard)"
Write-Host "  4. Review 'git status' / 'git diff', then commit."
if ($custRoot) {
    Write-Host "  5. Customizations were placed under '$custRoot/.github'. Opening '$custRoot' as a folder in"
    Write-Host "     VS Code discovers the agents/skills/instructions natively - no extra setting needed."
    Write-Host "     (Copilot on github.com reads the repo-root .github, so it won't see the relocated agents.)" -ForegroundColor DarkGray
}
else {
    Write-Host "  5. If you open your AL projects via a multi-root *.code-workspace, add this to its"
    Write-Host "     'settings' block so Copilot finds the agents/skills at the repo root:"
    Write-Host '        "chat.useCustomizationsInParentRepositories": true' -ForegroundColor Cyan
    Write-Host "     Or make it apply however you open folders (User settings):"
    Write-Host "        pwsh ./scripts/Enable-CopilotCustomizations.ps1"
}
Write-Host "  6. Later, pull template updates any time with: pwsh ./scripts/Update-FromTemplate.ps1 -WhatIf"
Write-Host "     (or let the '.github/workflows/template-sync.yml' Action open a PR for you). Both honor the"
Write-Host "     'sync' block in template.config.json (customizations location + model/toolset toggles)."
if (-not $IncludeSampleApp) {
    Write-Host "  (Sample AL app skipped - your existing app/ and test/ code was left untouched.)" -ForegroundColor DarkGray
}
