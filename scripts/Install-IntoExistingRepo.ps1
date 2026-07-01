<#
.SYNOPSIS
    Overlays this BC ALM template onto an EXISTING repository - copying only the
    content categories you enable, and never clobbering files you already have.

.DESCRIPTION
    Two steps, so the config lands before any files are copied:

      1. CONFIGURE (-Configure): decide WHERE the Copilot customizations live
         (-CustomizationsPath) and WHICH optional content categories to include,
         then write those choices into the target repo's template.config.json
         ('values.sync'). Use -Interactive to be prompted for each choice. No
         content is copied in this step.

      2. EXECUTE (run again without -Configure): read that config and copy the
         core files plus only the enabled categories to their configured places.

    Running once WITHOUT -Configure still works: it resolves the profile from the
    lean defaults (+ any -Include*/-No* switches), records it in template.config.json,
    and copies in one shot.

    Content categories (see 'sync.include' in template.config.json):
      * Core (always)  - agents, skills, instructions, copilot-instructions.md,
                         template.config.json, the sync workflow + scripts.
      * metaDocs       - .github/AGENT-ARCHITECTURE.md, WHEN-TO-USE.md, SKILLS.md
      * referenceDocs  - the docs/ library (bcquality, branching, workflow, ...)
      * issueOps       - .github/workflows/issue-*.yml + ISSUE_TEMPLATE + ISSUE_ORCHESTRATION.md
      * specs          - specs/_TEMPLATE scaffold
      * prTemplate     - .github/PULL_REQUEST_TEMPLATE.md
      * sampleApp      - the demo app/ + test/ projects (install-time only)

    Default profile for an existing repo (lean): specs + prTemplate on; metaDocs,
    referenceDocs, issueOps and sampleApp off. Whatever you choose is honored by
    later runs of scripts/Update-FromTemplate.ps1 and the template-sync Action too,
    so excluded content is never re-added.

    File policy:
      * Add   - new paths are copied; existing files are SKIPPED (-Force overwrites).
      * Merge - files that commonly already exist (copilot-instructions, PR template,
                .vscode/*, .gitignore) are written next to yours with a '.template'
                suffix so you can merge by hand (never overwritten unless -Force).

.EXAMPLE
    # Step 1 - configure interactively, then step 2 - execute:
    pwsh ./scripts/Install-IntoExistingRepo.ps1 -TargetRepo C:\src\my-bc-app -Configure -Interactive
    pwsh ./scripts/Install-IntoExistingRepo.ps1 -TargetRepo C:\src\my-bc-app -WhatIf
    pwsh ./scripts/Install-IntoExistingRepo.ps1 -TargetRepo C:\src\my-bc-app

.EXAMPLE
    # One-shot with explicit categories, customizations under app/:
    pwsh ./scripts/Install-IntoExistingRepo.ps1 -TargetRepo C:\src\my-bc-app -CustomizationsPath app -IncludeReferenceDocs
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)]
    [string] $TargetRepo,

    # Step 1 only: write the sync/include config into the target, copy nothing.
    [switch] $Configure,

    # Prompt for each choice during -Configure instead of using flags/defaults.
    [switch] $Interactive,

    # Overwrite existing files instead of skipping (Add) or writing .template (Merge).
    [switch] $Force,

    # Where the VS Code-discoverable customizations (.github/agents, skills,
    # instructions, copilot-instructions.md) go. '.' (default) = repo root .github.
    # A subfolder (e.g. 'app') places them under <path>/.github. Platform files
    # (workflows, ISSUE_TEMPLATE, PR template) always stay at the repo root.
    [string] $CustomizationsPath = '.',

    # Opt IN to categories that are off by default for an existing repo.
    [switch] $IncludeMetaDocs,
    [switch] $IncludeReferenceDocs,
    [switch] $IncludeIssueOps,
    [switch] $IncludeSampleApp,

    # Opt OUT of categories that are on by default.
    [switch] $NoSpecs,
    [switch] $NoPrTemplate,

    [string] $SourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$ErrorActionPreference = 'Stop'

$SourceRoot = (Resolve-Path $SourceRoot).Path
if (-not (Test-Path $TargetRepo)) { throw "Target repo path not found: $TargetRepo" }
$TargetRepo = (Resolve-Path $TargetRepo).Path
if ($SourceRoot -eq $TargetRepo) { throw "Target repo must be different from the template source." }

$targetConfig = Join-Path $TargetRepo 'template.config.json'

# --- Include profile helpers -----------------------------------------------------
function Get-LeanInclude {
    [ordered]@{ metaDocs = $false; referenceDocs = $false; issueOps = $false; specs = $true; prTemplate = $true; sampleApp = $false }
}

# Read an existing profile from the target's template.config.json (authoritative on
# a second/execute run) so we don't re-prompt or reset the user's choices.
function Read-TargetSync {
    if (-not (Test-Path $targetConfig)) { return $null }
    try { $c = Get-Content $targetConfig -Raw | ConvertFrom-Json } catch { return $null }
    if (-not ($c.values -and $c.values.sync)) { return $null }
    $inc = Get-LeanInclude
    if ($c.values.sync.include) {
        foreach ($k in @($inc.Keys)) {
            if ($c.values.sync.include.PSObject.Properties[$k]) { $inc[$k] = [bool]$c.values.sync.include.$k }
        }
    }
    $cp = if ($c.values.sync.PSObject.Properties['customizationsPath'] -and $c.values.sync.customizationsPath) { [string]$c.values.sync.customizationsPath } else { '.' }
    return [pscustomobject]@{ include = $inc; customizationsPath = $cp }
}

function Apply-IncludeFlags([System.Collections.Specialized.OrderedDictionary] $inc) {
    if ($IncludeMetaDocs) { $inc.metaDocs = $true }
    if ($IncludeReferenceDocs) { $inc.referenceDocs = $true }
    if ($IncludeIssueOps) { $inc.issueOps = $true }
    if ($IncludeSampleApp) { $inc.sampleApp = $true }
    if ($NoSpecs) { $inc.specs = $false }
    if ($NoPrTemplate) { $inc.prTemplate = $false }
    return $inc
}

function Read-YesNo([string] $label, [bool] $default) {
    $hint = if ($default) { 'Y/n' } else { 'y/N' }
    while ($true) {
        $a = (Read-Host "  $label [$hint]").Trim()
        if ([string]::IsNullOrWhiteSpace($a)) { return $default }
        switch -Regex ($a) { '^(y|yes)$' { return $true }; '^(n|no)$' { return $false } }
        Write-Host "    please answer y or n" -ForegroundColor DarkYellow
    }
}

function Prompt-Profile([System.Collections.Specialized.OrderedDictionary] $inc, [string] $custPath) {
    Write-Host "`nConfigure the overlay (press Enter to accept the [default]):" -ForegroundColor White
    $cp = (Read-Host "  Customizations folder ('.' = repo root, or e.g. 'app') [$custPath]").Trim()
    if ([string]::IsNullOrWhiteSpace($cp)) { $cp = $custPath }
    $inc.metaDocs = Read-YesNo "Include agent meta-docs (AGENT-ARCHITECTURE / WHEN-TO-USE / SKILLS.md)?" $inc.metaDocs
    $inc.referenceDocs = Read-YesNo "Include reference docs (docs/: bcquality, branching, workflow, ...)?" $inc.referenceDocs
    $inc.issueOps = Read-YesNo "Include GitHub issue-ops pipeline (issue-*.yml + ISSUE_TEMPLATE)?" $inc.issueOps
    $inc.specs = Read-YesNo "Include spec scaffold (specs/_TEMPLATE)?" $inc.specs
    $inc.prTemplate = Read-YesNo "Include PR template (PULL_REQUEST_TEMPLATE.md)?" $inc.prTemplate
    $inc.sampleApp = Read-YesNo "Copy the sample AL app (app/ + test/ + workspace)?" $inc.sampleApp
    return @{ include = $inc; customizationsPath = $cp }
}

# Ensure the target has a template.config.json (seed from the template's when missing)
# and write the resolved 'sync' block into it.
function Save-SyncConfig([System.Collections.Specialized.OrderedDictionary] $inc, [string] $custPath) {
    if (-not (Test-Path $targetConfig)) {
        if ($PSCmdlet.ShouldProcess($targetConfig, "Seed template.config.json from template")) {
            Copy-Item (Join-Path $SourceRoot 'template.config.json') $targetConfig -Force
        }
        elseif (-not (Test-Path $targetConfig)) { return }  # -WhatIf with no file yet: nothing to load
    }
    $c = Get-Content $targetConfig -Raw | ConvertFrom-Json
    if (-not $c.values) { throw "template.config.json in the target has no 'values' object." }
    if (-not $c.values.PSObject.Properties['sync']) {
        $c.values | Add-Member -NotePropertyName sync -NotePropertyValue ([pscustomobject]@{
                customizationsPath = '.'; updateModels = $false; updateExtensions = $false; updateInstructions = $true
            })
    }
    $sync = $c.values.sync
    $sync.customizationsPath = $custPath
    $incObj = [pscustomobject]@{
        metaDocs = $inc.metaDocs; referenceDocs = $inc.referenceDocs; issueOps = $inc.issueOps
        specs    = $inc.specs; prTemplate = $inc.prTemplate; sampleApp = $inc.sampleApp
    }
    if ($sync.PSObject.Properties['include']) { $sync.include = $incObj }
    else { $sync | Add-Member -NotePropertyName include -NotePropertyValue $incObj }

    if ($PSCmdlet.ShouldProcess($targetConfig, "Write sync/include config")) {
        ($c | ConvertTo-Json -Depth 12) | Set-Content -Path $targetConfig -Encoding UTF8
    }
    Write-Host "  config     template.config.json sync -> customizationsPath='$custPath', include=[$(( $inc.GetEnumerator() | Where-Object { $_.Value } | ForEach-Object { $_.Key }) -join ', ')]" -ForegroundColor Green
}

# --- Resolve the profile for this run --------------------------------------------
$existing = Read-TargetSync
if ($existing -and -not $Configure) {
    # Execute run with a config already present: honor it (flags still layer on top).
    $include = Apply-IncludeFlags $existing.include
    $custPath = if ($PSBoundParameters.ContainsKey('CustomizationsPath')) { $CustomizationsPath } else { $existing.customizationsPath }
}
else {
    $include = Apply-IncludeFlags (Get-LeanInclude)
    $custPath = $CustomizationsPath
    if ($Configure -and $Interactive) {
        $picked = Prompt-Profile $include $custPath
        $include = $picked.include; $custPath = $picked.customizationsPath
    }
}

# Folder that holds the discoverable customizations. '' = repo root.
$custRoot = ''
if ($custPath -and $custPath -ne '.') { $custRoot = $custPath.Trim().TrimEnd('/', '\') }

Write-Host "Overlaying BC ALM template" -ForegroundColor White
Write-Host "  from: $SourceRoot"
Write-Host "  to  : $TargetRepo"
if ($custRoot) { Write-Host "  customizations -> $custRoot/.github (platform files stay at repo root)" -ForegroundColor Cyan }
Write-Host ("  include: " + (($include.GetEnumerator() | ForEach-Object { "$($_.Key)=$([bool]$_.Value)" }) -join ', ')) -ForegroundColor DarkGray
Write-Host ""

# --- CONFIGURE step: write config and stop ---------------------------------------
if ($Configure) {
    Save-SyncConfig $include $custPath
    Write-Host "`nConfigured. Review '$targetConfig', then run WITHOUT -Configure to copy the enabled content:" -ForegroundColor White
    Write-Host "  pwsh ./scripts/Install-IntoExistingRepo.ps1 -TargetRepo '$TargetRepo' -WhatIf   # preview" -ForegroundColor DarkGray
    return
}

# --- EXECUTE step ----------------------------------------------------------------
$script:added = 0; $script:skipped = 0; $script:merged = 0

function Resolve-Dest([string] $rel) {
    $r = $rel.Replace('\', '/')
    if ($custRoot -and ($r -match '^\.github/(agents|skills|prompts|instructions)(/|$)' -or $r -eq '.github/copilot-instructions.md')) {
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

# Core: always copied (the point of the template + the sync machinery).
$addTrees = @('.github/agents', '.github/skills', '.github/prompts', '.github/instructions')
$addFiles = @(
    '.github/workflows/template-sync.yml',
    'scripts/Initialize-Template.ps1',
    'scripts/Add-BCQuality.ps1',
    'scripts/Start-ALLanguageServer.ps1',
    'scripts/Update-FromTemplate.ps1',
    'scripts/Enable-CopilotCustomizations.ps1',
    '.templatesyncignore'
)

# Optional categories.
if ($include.metaDocs) { $addFiles += '.github/AGENT-ARCHITECTURE.md', '.github/WHEN-TO-USE.md', '.github/SKILLS.md' }
if ($include.referenceDocs) { $addTrees += 'docs' }
if ($include.issueOps) {
    $addTrees += '.github/ISSUE_TEMPLATE'
    $addFiles += '.github/ISSUE_ORCHESTRATION.md',
    '.github/workflows/issue-implementation.yml',
    '.github/workflows/issue-orchestrator.yml',
    '.github/workflows/issue-planning.yml'
}
if ($include.specs) { $addTrees += 'specs/_TEMPLATE' }

# Merge: likely already present; write '.template' instead of clobbering.
$mergeFiles = @(
    '.github/copilot-instructions.md',
    '.vscode/extensions.json',
    '.vscode/settings.json',
    '.vscode/mcp.json',
    '.vscode/launch.json',
    '.vscode/tasks.json',
    '.gitignore'
)
if ($include.prTemplate) { $mergeFiles += '.github/PULL_REQUEST_TEMPLATE.md' }

Write-Host "Core + selected template files" -ForegroundColor White
foreach ($t in $addTrees) { Copy-Tree $t 'Add' }
foreach ($f in $addFiles) { Copy-One $f 'Add' }

Write-Host "`nMerge-sensitive files" -ForegroundColor White
foreach ($f in $mergeFiles) { Copy-One $f 'Merge' }

if ($include.sampleApp) {
    Write-Host "`nSample AL app" -ForegroundColor White
    Copy-Tree 'app' 'Add'
    Copy-Tree 'test' 'Add'
    Copy-One 'bc-alm-template.code-workspace' 'Merge'
}

# Establish/refresh the target's template.config.json sync block (never clobbers the
# rest of an existing config; seeds the file from the template when missing).
Save-SyncConfig $include $custPath

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
Write-Host "     'sync' block in template.config.json - customizations location, model/toolset toggles, and the"
Write-Host "     content categories you selected here (excluded categories are never re-added)."
$off = @($include.GetEnumerator() | Where-Object { -not $_.Value } | ForEach-Object { $_.Key })
if ($off.Count) { Write-Host "  (Excluded: $($off -join ', '). Re-run with -Configure to change this.)" -ForegroundColor DarkGray }
