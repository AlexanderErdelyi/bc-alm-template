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
        (.github/agents, .github/skills, .github/prompts, .github/instructions and
        the agent meta-docs) at the repo root (default). Set it to a subfolder (e.g.
        'app') and those are refreshed under <path>/.github instead. GitHub platform
        files (.github/workflows, ISSUE_TEMPLATE, PULL_REQUEST_TEMPLATE) always stay
        at the repo root.
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

    After the refresh, your 'values' choices are re-applied so a sync never reverts
    the initialization:

      * prefix / ticket prefix / repo slug / ADO org / object-ID range / work-item
        linking - the template ships its own placeholders (ABC, AB#, 50100-50199,
        AlexanderErdelyi/bc-alm-template, ...), so every refreshed prose/customization
        file is re-parameterized from template.config.json 'values'. This mirrors the
        initializer's token replacement. Scripts and the template-sync workflow are left
        as-is (the workflow's slug guard must keep pointing at the template).
      * extraTools - project-specific tool IDs merged (additive, de-duplicated) into
        every agent + prompt 'tools:' list. 'all' applies everywhere; 'agents'/'prompts'
        add per-file extras keyed by file name (e.g. 'bc-dev', 'onboard-app'). This is
        how custom MCP servers stay in the toolsets after the template files are
        overwritten. Also, when workItemSystem = GitHub, the azure-devops/* group the
        template ships is trimmed back out of the agent/prompt toolsets.

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
    syncWorkflow       = $true
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
        if ($s.PSObject.Properties['syncWorkflow'])       { $sync.syncWorkflow       = [bool]$s.syncWorkflow }
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

Write-Host "Sync config: customizationsPath='$($sync.customizationsPath)', syncWorkflow=$($sync.syncWorkflow), updateModels=$($sync.updateModels), updateExtensions=$($sync.updateExtensions), updateInstructions=$($sync.updateInstructions)" -ForegroundColor DarkGray
$inc = $sync.include
Write-Host "  include: metaDocs=$($inc.metaDocs), referenceDocs=$($inc.referenceDocs), issueOps=$($inc.issueOps), specs=$($inc.specs), prTemplate=$($inc.prTemplate)" -ForegroundColor DarkGray

# --- Template-managed paths ------------------------------------------------------
# Customization trees are VS Code-discoverable and follow customizationsPath.
$customTrees = @(
    '.github/agents',
    '.github/skills',
    '.github/prompts'
)
if ($sync.updateInstructions) { $customTrees += '.github/instructions' }

# Root-only trees always land at the repo root (GitHub reads them there). Optional
# content categories are gated by sync.include so excluded content is never re-added.
$rootTrees = @()
if ($inc.referenceDocs) { $rootTrees += 'docs' }
if ($inc.specs)         { $rootTrees += 'specs/_TEMPLATE' }
if ($inc.issueOps)      { $rootTrees += '.github/ISSUE_TEMPLATE' }

# Core files always refreshed (shared scripts/config).
$rootFiles = @(
    'scripts/Initialize-Template.ps1',
    'scripts/Add-BCQuality.ps1',
    'scripts/Start-ALLanguageServer.ps1',
    'scripts/Update-FromTemplate.ps1',
    'scripts/Enable-CopilotCustomizations.ps1',
    'scripts/Install-IntoExistingRepo.ps1',
    '.vscode/tasks.json'
)
# GitHub Actions template-sync machinery (skipped for Azure DevOps-only repos).
if ($sync.syncWorkflow) { $rootFiles += '.github/workflows/template-sync.yml', '.templatesyncignore' }
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

$updated = 0; $added = 0; $unchanged = 0; $remodeled = 0; $retooled = 0; $trimmed = 0; $reparamed = 0

function Get-Hash([string] $path) {
    if (-not (Test-Path $path)) { return $null }
    return (Get-FileHash -Algorithm SHA256 -Path $path).Hash
}

# Map a source-relative path to its destination-relative path (relocating the
# discoverable customizations under $custRoot when configured).
function Resolve-Dest([string] $rel) {
    $r = $rel.Replace('\', '/')
    $relocate = @('.github/AGENT-ARCHITECTURE.md', '.github/WHEN-TO-USE.md', '.github/SKILLS.md')
    if ($custRoot -and ($r -match '^\.github/(agents|skills|prompts|instructions)(/|$)' -or $r -match '^specs(/|$)' -or $r -match '^\.vscode(/|$)' -or $relocate -contains $r)) {
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

# Add project-specific extra tool IDs (template.config.json values.extraTools) to each
# agent + prompt 'tools:' list. The refresh just overwrote those files with the template's
# generic toolsets, so we re-append your custom tools (additive, de-duplicated) to keep
# them across syncs. Mirrors Restore-Models for the 'tools:' frontmatter line.
function Add-ExtraToolsToFile([string] $filePath, [string[]] $extra) {
    if (-not $extra -or $extra.Count -eq 0 -or -not (Test-Path $filePath)) { return }
    $text = Get-Content $filePath -Raw
    $m = [regex]::Match($text, '(?m)^tools:\s*\[(.*)\]\s*$')
    if (-not $m.Success) { return }
    $existing = @(); foreach ($t in ($m.Groups[1].Value -split ',')) { $tt = $t.Trim().Trim("'`""); if ($tt) { $existing += $tt } }
    $addedTools = @()
    foreach ($e in ($extra | ForEach-Object { $_ -split '\s*,\s*' })) { $en = ([string]$e).Trim().Trim("'`""); if ($en -and ($existing -notcontains $en)) { $existing += $en; $addedTools += $en } }
    if ($addedTools.Count -eq 0) { return }
    $newLine = 'tools: [' + (($existing | ForEach-Object { "'$_'" }) -join ', ') + ']'
    $newText = $text.Replace($m.Value, $newLine)
    if ($PSCmdlet.ShouldProcess($filePath, ("Add extra tools: {0}" -f ($addedTools -join ', ')))) {
        Set-Content -Path $filePath -Value $newText -NoNewline
    }
    Write-Host ("  tools      {0,-28} += {1}" -f (Split-Path $filePath -Leaf), ($addedTools -join ', ')) -ForegroundColor Cyan
    $script:retooled++
}

function Merge-ExtraTools {
    if (-not ($config -and $config.values -and $config.values.PSObject.Properties['extraTools'])) { return }
    $et = $config.values.extraTools
    $all = @(); if ($et.PSObject.Properties['all'] -and $et.all) { $all = @($et.all) }
    $perAgent  = if ($et.PSObject.Properties['agents'])  { $et.agents }  else { $null }
    $perPrompt = if ($et.PSObject.Properties['prompts']) { $et.prompts } else { $null }
    if (-not ($all.Count -or $perAgent -or $perPrompt)) { return }
    Write-Host "`nRe-applying your extra tools (values.extraTools)" -ForegroundColor White
    $agentsDir  = if ($custRoot) { Join-Path $RepoRoot "$custRoot/.github/agents" }  else { Join-Path $RepoRoot '.github/agents' }
    $promptsDir = if ($custRoot) { Join-Path $RepoRoot "$custRoot/.github/prompts" } else { Join-Path $RepoRoot '.github/prompts' }
    if (Test-Path $agentsDir) {
        Get-ChildItem $agentsDir -Filter *.agent.md | ForEach-Object {
            $name = $_.BaseName -replace '\.agent$', ''
            $extra = @($all); if ($perAgent -and $perAgent.PSObject.Properties[$name]) { $extra += @($perAgent.$name) }
            Add-ExtraToolsToFile $_.FullName $extra
        }
    }
    if (Test-Path $promptsDir) {
        Get-ChildItem $promptsDir -Filter *.prompt.md | ForEach-Object {
            $name = $_.BaseName -replace '\.prompt$', ''
            $extra = @($all); if ($perPrompt -and $perPrompt.PSObject.Properties[$name]) { $extra += @($perPrompt.$name) }
            Add-ExtraToolsToFile $_.FullName $extra
        }
    }
}

# Keep GitHub-work-item repos lean: strip the azure-devops/* MCP group the template
# ships in agent/prompt toolsets (the refresh re-adds it). Mirrors the initializer's trim.
function Trim-WorkItemTools {
    if (-not ($config -and $config.values -and $config.values.PSObject.Properties['workItemSystem'])) { return }
    if ([string]$config.values.workItemSystem -ne 'GitHub') { return }
    $dirs = @()
    $dirs += if ($custRoot) { Join-Path $RepoRoot "$custRoot/.github/agents" }  else { Join-Path $RepoRoot '.github/agents' }
    $dirs += if ($custRoot) { Join-Path $RepoRoot "$custRoot/.github/prompts" } else { Join-Path $RepoRoot '.github/prompts' }
    foreach ($d in $dirs) {
        if (-not (Test-Path $d)) { continue }
        Get-ChildItem $d -File | Where-Object { $_.Name -match '\.(agent|prompt)\.md$' } | ForEach-Object {
            $t = Get-Content $_.FullName -Raw
            $n = $t.Replace(", 'azure-devops/*'", '').Replace("'azure-devops/*', ", '').Replace("'azure-devops/*'", '')
            if ($n -ne $t) {
                if ($PSCmdlet.ShouldProcess($_.FullName, 'Trim azure-devops/* (GitHub work items)')) { Set-Content -Path $_.FullName -Value $n -NoNewline }
                Write-Host ("  tools      trimmed azure-devops/* from {0}" -f $_.Name) -ForegroundColor DarkYellow
                $script:trimmed++
            }
        }
    }
}

# Re-apply this repo's configured values (template.config.json 'values') to the freshly
# refreshed files. The template ships its own placeholders (prefix, ticket prefix, repo slug,
# ADO org, object-ID range, AB# linking), so a plain copy would REVERT the initialization on
# every sync. This mirrors Initialize-Template.ps1's Update-Content, using the template clone's
# own config as the 'from' side and this repo's config as the 'to' side. It deliberately skips
# scripts and the template-sync workflow: that workflow's slug guard must keep pointing at the
# template, not this repo.
function Reparameterize {
    if (-not ($config -and $config.values)) { return }
    $v = $config.values
    $tpl = $null
    $tplCfg = Join-Path $temp 'template.config.json'
    if (Test-Path $tplCfg) { try { $tpl = (Get-Content $tplCfg -Raw | ConvertFrom-Json).values } catch { $tpl = $null } }
    if (-not $tpl) { return }

    $fromPrefix = [string]$tpl.appPrefix
    $fromTicket = [string]$tpl.ticketPrefix
    $fromSlug   = [string]$tpl.repoSlug
    $fromOrg    = [string]$tpl.adoOrg
    $fromFrom   = [int]$tpl.objectIdFrom
    $fromTo     = [int]$tpl.objectIdTo

    $g = { param($n, $d) if ($v.PSObject.Properties[$n] -and $null -ne $v.$n -and "$($v.$n)" -ne '') { $v.$n } else { $d } }
    $toPrefix = [string](& $g 'appPrefix'    $fromPrefix)
    $toTicket = [string](& $g 'ticketPrefix' $fromTicket)
    $toSlug   = [string](& $g 'repoSlug'     $fromSlug)
    $toOrg    = [string](& $g 'adoOrg'       $fromOrg)
    $toFrom   = [int]   (& $g 'objectIdFrom' $fromFrom)
    $toTo     = [int]   (& $g 'objectIdTo'   $fromTo)
    $wis      = [string](& $g 'workItemSystem' 'ADO')

    $oldPrefix  = [regex]::Escape($fromPrefix)
    $oldTicket  = [regex]::Escape($fromTicket)
    $ticketRepl = if ($toTicket) { "$toTicket-" } else { '' }
    $ticketEval = [System.Text.RegularExpressions.MatchEvaluator] { param($m) $ticketRepl }
    $prefixEval = [System.Text.RegularExpressions.MatchEvaluator] { param($m) $toPrefix }
    $shiftRange = ($toFrom -ne $fromFrom) -or ($toTo -ne $fromTo)

    # Target only prose/customization files. Never scripts or workflows.
    $reparamExt = @('.md', '.json', '.jsonc', '.yml', '.yaml', '.txt')
    $targets = New-Object System.Collections.Generic.List[string]
    foreach ($t in ($customTrees + $rootTrees)) {
        $destDir = Join-Path $RepoRoot (Resolve-Dest $t)
        if (Test-Path $destDir) {
            Get-ChildItem $destDir -Recurse -File |
                Where-Object { $reparamExt -contains $_.Extension.ToLower() } |
                ForEach-Object { $targets.Add($_.FullName) }
        }
    }
    $proseRootFiles = @(
        '.github/AGENT-ARCHITECTURE.md', '.github/WHEN-TO-USE.md', '.github/SKILLS.md',
        '.github/ISSUE_ORCHESTRATION.md', '.github/PULL_REQUEST_TEMPLATE.md', '.vscode/tasks.json'
    )
    foreach ($f in $proseRootFiles) {
        $dest = Join-Path $RepoRoot (Resolve-Dest $f)
        if (Test-Path $dest) { $targets.Add($dest) }
    }

    foreach ($path in ($targets | Select-Object -Unique)) {
        $text = Get-Content $path -Raw
        if ($null -eq $text) { continue }
        $new = $text
        if ($fromSlug) { $new = $new.Replace($fromSlug, $toSlug) }
        if ($fromOrg)  { $new = $new.Replace($fromOrg, $toOrg) }
        if ($fromTicket) { $new = [regex]::Replace($new, "\b$oldTicket-", $ticketEval) }
        if ($fromPrefix) { $new = [regex]::Replace($new, "\b$oldPrefix", $prefixEval) }
        if ($shiftRange) {
            foreach ($dash in @('-', [char]0x2013, [char]0x2014)) {
                $new = $new.Replace(('{0}{1}{2}' -f $fromFrom, $dash, $fromTo), ('{0}-{1}' -f $toFrom, $toTo))
            }
        }
        if ($wis -eq 'GitHub') { $new = $new.Replace('AB#', '#') }
        if ($new -ne $text) {
            $rel = $path.Substring($RepoRoot.Length).TrimStart('\', '/').Replace('\', '/')
            if ($PSCmdlet.ShouldProcess($path, 'Re-apply configured values (prefix/ticket/slug/org/range)')) {
                Set-Content -Path $path -Value $new -NoNewline
            }
            Write-Host ("  values     re-applied to {0}" -f $rel) -ForegroundColor Blue
            $script:reparamed++
        }
    }
}

try {
    Write-Host "`nRefreshing template-managed files" -ForegroundColor White
    foreach ($t in $customTrees) { Update-Tree $t }
    foreach ($t in $rootTrees) { Update-Tree $t }
    foreach ($f in $rootFiles) { Update-One $f }

    Write-Host "`nRe-applying your configured values (prefix/ticket/slug/org/range)" -ForegroundColor White
    Reparameterize

    if (-not $sync.updateModels) {
        Write-Host "`nRe-applying your agent models (sync.updateModels = false)" -ForegroundColor White
        Restore-Models
    }

    Trim-WorkItemTools
    Merge-ExtraTools
}
finally {
    if (Test-Path $temp) { Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue }
}

Write-Host "`nSummary: $added added, $updated updated, $reparamed re-parameterized, $remodeled models re-applied, $retooled tool lists extended, $trimmed trimmed, $unchanged already current." -ForegroundColor White
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
