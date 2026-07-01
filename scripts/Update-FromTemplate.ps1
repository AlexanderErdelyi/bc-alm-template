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

    The 'sync' block in template.config.json steers the refresh so it respects your
    project's choices:

      * customizationsPath - '.' keeps the VS Code-discoverable customizations
        (.github/agents, .github/skills, .github/instructions) at the repo root
        (default). Set it to a subfolder (e.g. 'app') and those are refreshed under
        <path>/.github instead. GitHub platform files (.github/workflows,
        ISSUE_TEMPLATE, PULL_REQUEST_TEMPLATE) always stay at the repo root.
      * updateModels     - false (default) re-applies your agent 'model:' choices
        from template.config.json after the refresh, so you get template prompt/
        handoff improvements but keep your own models. true accepts the template's.
      * updateExtensions - false (default) leaves .vscode/extensions.json (your
        toolset) untouched. true pulls the template's recommended list.
      * updateInstructions - true (default) refreshes .github/instructions. false
        keeps your edited AL coding standards.
      * include           - per-category on/off switches (metaDocs, referenceDocs,
        issueOps, specs, prTemplate). A category set to false is never refreshed or
        re-added, so an existing repo that opted out of, say, the docs/ library or
        the GitHub issue-ops pipeline stays that way across every sync.

    This mirrors the split used by the GitHub Action
    (.github/workflows/template-sync.yml), which runs this same script. Use the
    Action for automatic PRs; use this script to pull updates on demand.

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

# --- Read the sync configuration (template.config.json 'values.sync') ------------
$sync = [pscustomobject]@{
    customizationsPath = '.'
    updateModels       = $false
    updateExtensions   = $false
    updateInstructions = $true
    include            = [pscustomobject]@{
        metaDocs      = $true
        referenceDocs = $true
        issueOps      = $true
        specs         = $true
        prTemplate    = $true
    }
}
$config = $null
$configPath = Join-Path $RepoRoot 'template.config.json'
if (Test-Path $configPath) {
    try { $config = Get-Content $configPath -Raw | ConvertFrom-Json } catch { $config = $null }
    if ($config -and $config.values -and $config.values.sync) {
        $s = $config.values.sync
        if ($s.PSObject.Properties['customizationsPath'] -and $s.customizationsPath) { $sync.customizationsPath = [string]$s.customizationsPath }
        if ($s.PSObject.Properties['updateModels'])       { $sync.updateModels       = [bool]$s.updateModels }
        if ($s.PSObject.Properties['updateExtensions'])   { $sync.updateExtensions   = [bool]$s.updateExtensions }
        if ($s.PSObject.Properties['updateInstructions']) { $sync.updateInstructions = [bool]$s.updateInstructions }
        if ($s.PSObject.Properties['include'] -and $s.include) {
            foreach ($k in 'metaDocs', 'referenceDocs', 'issueOps', 'specs', 'prTemplate') {
                if ($s.include.PSObject.Properties[$k]) { $sync.include.$k = [bool]$s.include.$k }
            }
        }
    }
}

# Folder that holds the VS Code-discoverable customizations. '' = repo root.
$custRoot = ''
if ($sync.customizationsPath -and $sync.customizationsPath -ne '.') {
    $custRoot = $sync.customizationsPath.Trim().TrimEnd('/', '\')
}

Write-Host "Sync config: customizationsPath='$($sync.customizationsPath)', updateModels=$($sync.updateModels), updateExtensions=$($sync.updateExtensions), updateInstructions=$($sync.updateInstructions)" -ForegroundColor DarkGray
$inc = $sync.include
Write-Host "  include: metaDocs=$($inc.metaDocs), referenceDocs=$($inc.referenceDocs), issueOps=$($inc.issueOps), specs=$($inc.specs), prTemplate=$($inc.prTemplate)" -ForegroundColor DarkGray

# --- Template-managed paths ------------------------------------------------------
# Customization trees are VS Code-discoverable and follow customizationsPath.
$customTrees = @(
    '.github/agents',
    '.github/skills'
)
if ($sync.updateInstructions) { $customTrees += '.github/instructions' }

# Root-only trees always land at the repo root (GitHub reads them there). Optional
# content categories are gated by sync.include so excluded content is never re-added.
$rootTrees = @()
if ($inc.referenceDocs) { $rootTrees += 'docs' }
if ($inc.specs)         { $rootTrees += 'specs/_TEMPLATE' }
if ($inc.issueOps)      { $rootTrees += '.github/ISSUE_TEMPLATE' }

# Core files always refreshed (the sync machinery + shared scripts/config).
$rootFiles = @(
    '.github/workflows/template-sync.yml',
    'scripts/Initialize-Template.ps1',
    'scripts/Add-BCQuality.ps1',
    'scripts/Start-ALLanguageServer.ps1',
    'scripts/Update-FromTemplate.ps1',
    'scripts/Enable-CopilotCustomizations.ps1',
    'scripts/Install-IntoExistingRepo.ps1',
    '.vscode/tasks.json',
    '.templatesyncignore'
)
if ($inc.metaDocs) {
    $rootFiles += '.github/AGENT-ARCHITECTURE.md', '.github/WHEN-TO-USE.md', '.github/SKILLS.md'
}
if ($inc.issueOps) {
    $rootFiles += '.github/ISSUE_ORCHESTRATION.md',
    '.github/workflows/issue-implementation.yml',
    '.github/workflows/issue-orchestrator.yml',
    '.github/workflows/issue-planning.yml'
}
if ($inc.prTemplate)       { $rootFiles += '.github/PULL_REQUEST_TEMPLATE.md' }
if ($sync.updateExtensions) { $rootFiles += '.vscode/extensions.json' }

$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) { throw "git is required but was not found on PATH." }

$temp = Join-Path ([System.IO.Path]::GetTempPath()) ("bc-template-" + [guid]::NewGuid().ToString('N'))
Write-Host "Fetching template $TemplateUrl ($Branch)..." -ForegroundColor White
& git clone --depth 1 --branch $Branch --quiet $TemplateUrl $temp
if ($LASTEXITCODE -ne 0) { throw "git clone failed for $TemplateUrl ($Branch)." }

$updated = 0; $added = 0; $unchanged = 0; $remodeled = 0

function Get-Hash([string] $path) {
    if (-not (Test-Path $path)) { return $null }
    return (Get-FileHash -Algorithm SHA256 -Path $path).Hash
}

# Map a source-relative path to its destination-relative path (relocating the
# discoverable customizations under $custRoot when configured).
function Resolve-Dest([string] $rel) {
    $r = $rel.Replace('\', '/')
    if ($custRoot -and ($r -match '^\.github/(agents|skills|instructions)(/|$)')) {
        return "$custRoot/$r"
    }
    return $r
}

function Update-One([string] $rel) {
    $src = Join-Path $temp $rel
    if (-not (Test-Path $src)) { return }
    $destRel = Resolve-Dest $rel
    $dst = Join-Path $RepoRoot $destRel
    $dstDir = Split-Path $dst -Parent
    $existed = Test-Path $dst

    if ($existed -and ((Get-Hash $src) -eq (Get-Hash $dst))) {
        $script:unchanged++
        return
    }

    if ($PSCmdlet.ShouldProcess($dst, "Update $destRel from template")) {
        if (-not (Test-Path $dstDir)) { New-Item -ItemType Directory -Path $dstDir -Force | Out-Null }
        Copy-Item $src $dst -Force
    }
    if ($existed) { Write-Host "  updated    $destRel" -ForegroundColor Yellow; $script:updated++ }
    else { Write-Host "  added      $destRel" -ForegroundColor Green; $script:added++ }
}

function Update-Tree([string] $relDir) {
    $srcDir = Join-Path $temp $relDir
    if (-not (Test-Path $srcDir)) { return }
    Get-ChildItem $srcDir -Recurse -File | ForEach-Object {
        $rel = $_.FullName.Substring($temp.Length).TrimStart('\', '/').Replace('\', '/')
        Update-One $rel
    }
}

# Re-apply each agent's 'model:' line from template.config.json (values win over
# the template's defaults) unless the project opted into template model updates.
function Restore-Models {
    if ($sync.updateModels) { return }
    if (-not ($config -and $config.models)) { return }
    $agentsRel = if ($custRoot) { "$custRoot/.github/agents" } else { '.github/agents' }
    $agentsDir = Join-Path $RepoRoot $agentsRel
    if (-not (Test-Path $agentsDir)) { return }
    foreach ($prop in $config.models.PSObject.Properties) {
        if ($prop.Name -eq '_readme') { continue }
        $agentPath = Join-Path $agentsDir ("{0}.agent.md" -f $prop.Name)
        if (-not (Test-Path $agentPath)) { continue }
        $model = [string]$prop.Value
        $aText = Get-Content $agentPath -Raw
        $newText = [regex]::Replace($aText, '(?m)^model:\s*.*$', ('model: "{0}"' -f $model))
        if ($newText -ne $aText) {
            if ($PSCmdlet.ShouldProcess($agentPath, "Re-apply model $model")) {
                Set-Content -Path $agentPath -Value $newText -NoNewline
            }
            Write-Host ("  model      {0,-16} -> {1}" -f $prop.Name, $model) -ForegroundColor Magenta
            $script:remodeled++
        }
    }
}

try {
    Write-Host "`nRefreshing template-managed files" -ForegroundColor White
    foreach ($t in $customTrees) { Update-Tree $t }
    foreach ($t in $rootTrees) { Update-Tree $t }
    foreach ($f in $rootFiles) { Update-One $f }

    if (-not $sync.updateModels) {
        Write-Host "`nRe-applying your agent models (sync.updateModels = false)" -ForegroundColor White
        Restore-Models
    }
}
finally {
    if (Test-Path $temp) { Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue }
}

Write-Host "`nSummary: $added added, $updated updated, $remodeled models re-applied, $unchanged already current." -ForegroundColor White
if (-not $sync.updateExtensions) { Write-Host "Kept your .vscode/extensions.json (sync.updateExtensions = false)." -ForegroundColor DarkGray }
if (-not $sync.updateInstructions) { Write-Host "Kept your .github/instructions (sync.updateInstructions = false)." -ForegroundColor DarkGray }
$excluded = @()
if (-not $inc.metaDocs)      { $excluded += 'metaDocs' }
if (-not $inc.referenceDocs) { $excluded += 'referenceDocs' }
if (-not $inc.issueOps)      { $excluded += 'issueOps' }
if (-not $inc.specs)         { $excluded += 'specs' }
if (-not $inc.prTemplate)    { $excluded += 'prTemplate' }
if ($excluded.Count) { Write-Host ("Skipped disabled content categories (sync.include): {0}." -f ($excluded -join ', ')) -ForegroundColor DarkGray }
Write-Host "Project-owned files (app/, test/, specs/, PROJECT.md, template.config.json," -ForegroundColor DarkGray
Write-Host "copilot-instructions.md, .vscode/launch.json|mcp.json|settings.json) were left untouched." -ForegroundColor DarkGray
Write-Host "`nNext: review 'git diff', then commit the updates you want to keep." -ForegroundColor White
