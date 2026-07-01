<#
.SYNOPSIS
    Initializes this BC ALM template for your own project by replacing the
    template's default project-specific values across the whole repository.

.DESCRIPTION
    Reads the current values from template.config.json, then replaces the
    app/object prefix, ticket prefix, object ID range, publisher, app name,
    repo slug, and ADO organization throughout the AL source, docs, agents,
    skills, and VS Code config. It also renames AL files that carry the old
    prefix, optionally converts ADO 'AB#' commit-linking to GitHub '#', writes
    your choices back to template.config.json, and generates PROJECT.md.

    Use -Interactive to be prompted for each value, or pass parameters directly
    (ideal for CI / non-interactive use). Use -WhatIf to preview without writing.

    A repo created via GitHub "Use this template" receives the WHOLE tree. When
    -CleanupTemplateFiles is on (the "created FROM the template" path), this script
    also PRUNES the content categories a working project doesn't need, and records
    the choice in template.config.json ('values.sync.include') so later template
    syncs never re-add them. Category keep-defaults for a new project: agent
    meta-docs (AGENT-ARCHITECTURE / WHEN-TO-USE / SKILLS.md) are removed; the docs
    library, issue-ops pipeline, spec scaffold, PR template and the sample AL app
    are kept. Override with -IncludeMetaDocs / -NoReferenceDocs / -NoIssueOps /
    -NoSpecs / -NoPrTemplate / -NoSampleApp, or disable pruning with -Prune:$false.

.EXAMPLE
    pwsh ./scripts/Initialize-Template.ps1 -Interactive

.EXAMPLE
    # New project: keep everything except the agent meta-docs (the default), plus
    # drop the issue-ops pipeline and the sample app:
    pwsh ./scripts/Initialize-Template.ps1 -AppPrefix XYZ -CleanupTemplateFiles `
        -NoIssueOps -NoSampleApp

.EXAMPLE
    pwsh ./scripts/Initialize-Template.ps1 -AppPrefix XYZ -TicketPrefix PROJ `
        -ObjectIdFrom 60000 -ObjectIdTo 60099 -Publisher "Contoso Ltd." `
        -AppName "Contoso Payment Tolerance" -RepoSlug "contoso/bc-app" `
        -AdoOrg contoso -WorkItemSystem GitHub

.EXAMPLE
    pwsh ./scripts/Initialize-Template.ps1 -AppPrefix XYZ -WhatIf
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string] $AppPrefix,
    [string] $TicketPrefix,
    [string] $AppName,
    [string] $Publisher,
    [int]    $ObjectIdFrom,
    [int]    $ObjectIdTo,
    [string] $RepoSlug,
    [string] $AdoOrg,
    [string] $AdoProject,
    [ValidateSet('ADO', 'GitHub')]
    [string] $WorkItemSystem,
    [string] $DefaultBranch,
    [string] $BranchingStrategy,
    [string] $CommitConvention,
    [string[]] $Environments,

    [switch] $Interactive,
    [switch] $SkipModels,
    # Remove template-only files (CONTRIBUTING, installer, bootstrap) and replace the
    # template README with a project README. Intended for repos created FROM the template.
    [switch] $CleanupTemplateFiles,

    # Prune the content categories a working project doesn't need (see -CleanupTemplateFiles
    # in .DESCRIPTION). Defaults to the value of -CleanupTemplateFiles; pass -Prune:$false to
    # keep every file, or -Prune to force pruning without the other cleanup steps.
    [switch] $Prune,
    # Keep the agent meta-docs (AGENT-ARCHITECTURE / WHEN-TO-USE / SKILLS.md); pruned by default.
    [switch] $IncludeMetaDocs,
    # Opt OUT of categories kept by default for a new project.
    [switch] $NoReferenceDocs,
    [switch] $NoIssueOps,
    [switch] $NoSpecs,
    [switch] $NoPrTemplate,
    [switch] $NoSampleApp,
    [string] $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$ErrorActionPreference = 'Stop'
$configPath = Join-Path $RepoRoot 'template.config.json'
if (-not (Test-Path $configPath)) {
    throw "template.config.json not found at $configPath. Run this from the template repo root."
}
$config = Get-Content $configPath -Raw | ConvertFrom-Json
$cur = $config.values

function Read-Value([string] $prompt, $default) {
    if (-not $Interactive) { return $default }
    $shown = if ($default -is [array]) { $default -join ',' } else { $default }
    $answer = Read-Host "$prompt [$shown]"
    if ([string]::IsNullOrWhiteSpace($answer)) { return $default }
    return $answer
}

function Read-YesNo([string] $prompt, [bool] $default) {
    if (-not $Interactive) { return $default }
    $hint = if ($default) { 'Y/n' } else { 'y/N' }
    while ($true) {
        $a = (Read-Host "$prompt [$hint]").Trim()
        if ([string]::IsNullOrWhiteSpace($a)) { return $default }
        switch -Regex ($a) { '^(y|yes)$' { return $true }; '^(n|no)$' { return $false } }
        Write-Host "  please answer y or n" -ForegroundColor DarkYellow
    }
}

# --- Resolve effective values (param > interactive prompt > current default) ---
if (-not $AppPrefix)        { $AppPrefix        = Read-Value 'App / object prefix'                 $cur.appPrefix }
if (-not $TicketPrefix)     { $TicketPrefix     = Read-Value 'Ticket / spec prefix'               $cur.ticketPrefix }
if (-not $AppName)          { $AppName          = Read-Value 'App display name'                    $cur.appName }
if (-not $Publisher)        { $Publisher        = Read-Value 'Publisher (company name)'            $cur.publisher }
if (-not $ObjectIdFrom)     { $ObjectIdFrom     = [int](Read-Value 'Object ID range - from'        $cur.objectIdFrom) }
if (-not $ObjectIdTo)       { $ObjectIdTo       = [int](Read-Value 'Object ID range - to'          $cur.objectIdTo) }
if (-not $RepoSlug)         { $RepoSlug         = Read-Value 'GitHub repo slug (owner/repo)'       $cur.repoSlug }
if (-not $AdoOrg)           { $AdoOrg           = Read-Value 'Azure DevOps organization'           $cur.adoOrg }
if (-not $AdoProject)       { $AdoProject       = Read-Value 'Azure DevOps project (optional)'     $cur.adoProject }
if (-not $WorkItemSystem)   { $WorkItemSystem   = Read-Value 'Work-item system (ADO/GitHub)'       $cur.workItemSystem }
if (-not $DefaultBranch)    { $DefaultBranch    = Read-Value 'Default (production) branch'         $cur.defaultBranch }
if (-not $BranchingStrategy){ $BranchingStrategy= Read-Value 'Branching strategy id'              $cur.branchingStrategy }
if (-not $CommitConvention) { $CommitConvention = Read-Value 'Commit convention'                   $cur.commitConvention }
if (-not $Environments)     { $Environments     = (Read-Value 'Environments (comma separated)'     ($cur.environments -join ',')) -split '\s*,\s*' }

# Normalize Environments so a single comma-joined value (e.g. "TEST,PROD" passed by a VS Code
# task input or CI) is split into individual names just like the interactive prompt does.
if ($Environments) { $Environments = @($Environments | ForEach-Object { $_ -split '\s*,\s*' } | Where-Object { $_ }) }

# Offer template cleanup when interactive and not explicitly specified on the command line.
if ($Interactive -and -not $PSBoundParameters.ContainsKey('CleanupTemplateFiles')) {
    $ans = Read-Host 'Remove template-only files (CONTRIBUTING, installer, bootstrap) and write a project README? [Y/n]'
    $CleanupTemplateFiles = [string]::IsNullOrWhiteSpace($ans) -or ($ans -match '^(y|yes)$')
}

# --- Resolve the content-prune profile (which categories a new project keeps) ---
# Keep-defaults for a NEW project: drop the authoring meta-docs; keep everything else
# (the docs library and generated README/PROJECT.md link to it, and the sample app IS
# the project's starting point, so it is never auto-deleted unless -NoSampleApp).
$doPrune = if ($PSBoundParameters.ContainsKey('Prune')) { [bool]$Prune } else { [bool]$CleanupTemplateFiles }
$keep = [ordered]@{ metaDocs = $false; referenceDocs = $true; issueOps = $true; specs = $true; prTemplate = $true; sampleApp = $true }
if ($IncludeMetaDocs)  { $keep.metaDocs      = $true }
if ($NoReferenceDocs)  { $keep.referenceDocs = $false }
if ($NoIssueOps)       { $keep.issueOps      = $false }
if ($NoSpecs)          { $keep.specs         = $false }
if ($NoPrTemplate)     { $keep.prTemplate    = $false }
if ($NoSampleApp)      { $keep.sampleApp     = $false }
if ($doPrune -and $Interactive) {
    Write-Host "`nContent categories to keep in this project (Enter accepts the default):" -ForegroundColor White
    if (-not $PSBoundParameters.ContainsKey('IncludeMetaDocs')) { $keep.metaDocs      = Read-YesNo '  Keep agent meta-docs (AGENT-ARCHITECTURE / WHEN-TO-USE / SKILLS.md)?' $keep.metaDocs }
    if (-not $PSBoundParameters.ContainsKey('NoReferenceDocs')) { $keep.referenceDocs = Read-YesNo '  Keep the docs/ reference library?' $keep.referenceDocs }
    if (-not $PSBoundParameters.ContainsKey('NoIssueOps'))      { $keep.issueOps      = Read-YesNo '  Keep the GitHub issue-ops pipeline (issue-*.yml + ISSUE_TEMPLATE)?' $keep.issueOps }
    if (-not $PSBoundParameters.ContainsKey('NoSpecs'))         { $keep.specs         = Read-YesNo '  Keep the spec scaffold (specs/_TEMPLATE)?' $keep.specs }
    if (-not $PSBoundParameters.ContainsKey('NoPrTemplate'))    { $keep.prTemplate    = Read-YesNo '  Keep the PR template (PULL_REQUEST_TEMPLATE.md)?' $keep.prTemplate }
    if (-not $PSBoundParameters.ContainsKey('NoSampleApp'))     { $keep.sampleApp     = Read-YesNo '  Keep the sample AL app (app/ + test/ + workspace)?' $keep.sampleApp }
}

if ($ObjectIdTo -lt $ObjectIdFrom) { throw "ObjectIdTo ($ObjectIdTo) must be >= ObjectIdFrom ($ObjectIdFrom)." }

$oldFrom = [int]$cur.objectIdFrom
$oldTo   = [int]$cur.objectIdTo
$offset  = $ObjectIdFrom - $oldFrom

Write-Host "`nApplying template configuration:" -ForegroundColor Cyan
Write-Host ("  prefix           {0} -> {1}" -f $cur.appPrefix, $AppPrefix)
Write-Host ("  ticket prefix    {0} -> {1}" -f $cur.ticketPrefix, $TicketPrefix)
Write-Host ("  object ID range  {0}-{1} -> {2}-{3}  (offset {4})" -f $oldFrom, $oldTo, $ObjectIdFrom, $ObjectIdTo, $offset)
Write-Host ("  publisher        {0} -> {1}" -f $cur.publisher, $Publisher)
Write-Host ("  app name         {0} -> {1}" -f $cur.appName, $AppName)
Write-Host ("  repo slug        {0} -> {1}" -f $cur.repoSlug, $RepoSlug)
Write-Host ("  ADO org          {0} -> {1}" -f $cur.adoOrg, $AdoOrg)
Write-Host ("  work items       {0} -> {1}" -f $cur.workItemSystem, $WorkItemSystem)
Write-Host ""

# --- Build the file set: text files only, excluding VCS/build/binary artifacts ---
$sep = [IO.Path]::DirectorySeparatorChar
$excludeDirs = @('.git', '.alpackages', '.snapshots', 'node_modules', '.vscode-test')
$textExt = @('.al', '.json', '.jsonc', '.md', '.yml', '.yaml', '.ps1', '.xlf', '.txt', '.code-workspace')
$thisScript = (Resolve-Path $PSCommandPath).Path
$mainAppJsonPath = Join-Path $RepoRoot 'app/app.json'
$testAppJsonPath = Join-Path $RepoRoot 'test/app.json'

$files = Get-ChildItem -Path $RepoRoot -Recurse -File | Where-Object {
    $p = $_.FullName
    ($textExt -contains $_.Extension.ToLower()) -and
    (-not ($excludeDirs | Where-Object { $p -like "*$sep$_$sep*" })) -and
    ($p -ne $thisScript) -and
    ($p -ne $configPath) -and
    ($p -ne $testAppJsonPath)
}

function Update-Content([string] $text) {
    $oldPrefix = [regex]::Escape($cur.appPrefix)
    $oldTicket = [regex]::Escape($cur.ticketPrefix)

    # 1. Repo slug + ADO org (literal)
    $text = $text.Replace($cur.repoSlug, $RepoSlug)
    $text = $text.Replace($cur.adoOrg, $AdoOrg)
    # 2. Ticket prefix first ('PREFIX-123', 'PREFIX-{ID}') so it doesn't collide with bare prefix
    $text = [regex]::Replace($text, "\b$oldTicket-", "$TicketPrefix-")
    # 3. Bare app/object prefix (object names, identifiers, doc examples)
    $text = [regex]::Replace($text, "\b$oldPrefix", $AppPrefix)
    # 4. Shift object IDs that fall inside the OLD range
    if ($offset -ne 0) {
        $text = [regex]::Replace($text, '\b\d{5}\b', {
            param($m)
            $n = [int]$m.Value
            if ($n -ge $oldFrom -and $n -le $oldTo) { ($n + $offset).ToString() } else { $m.Value }
        })
    }
    # 5. ADO -> GitHub work-item linking
    if ($WorkItemSystem -eq 'GitHub') { $text = $text.Replace('AB#', '#') }
    return $text
}

# --- Rewrite file contents ---
$changed = 0
foreach ($f in $files) {
    $original = Get-Content $f.FullName -Raw
    if ($null -eq $original) { continue }
    $updated = Update-Content $original
    if ($updated -ne $original) {
        if ($PSCmdlet.ShouldProcess($f.FullName, 'Update content')) {
            Set-Content -Path $f.FullName -Value $updated -NoNewline
        }
        $changed++
    }
}
Write-Host ("Updated content in {0} file(s)." -f $changed) -ForegroundColor Green

# --- Resolve target BC version (app.json platform/application/runtime) from config ---
$bcVer = $cur.bcVersion
$bcApplication = if ($bcVer -and $bcVer.application) { [string]$bcVer.application } else { $null }
$bcPlatform    = if ($bcVer -and $bcVer.platform)    { [string]$bcVer.platform }    else { $null }
$bcRuntime     = if ($bcVer -and $bcVer.runtime)     { [string]$bcVer.runtime }     else { $null }

function Set-BcVersion([string]$text) {
    if ($bcApplication) { $text = [regex]::Replace($text, '("application"\s*:\s*")[^"]*(")', "`${1}$bcApplication`${2}") }
    if ($bcPlatform)    { $text = [regex]::Replace($text, '("platform"\s*:\s*")[^"]*(")',    "`${1}$bcPlatform`${2}") }
    if ($bcRuntime)     { $text = [regex]::Replace($text, '("runtime"\s*:\s*")[^"]*(")',     "`${1}$bcRuntime`${2}") }
    return $text
}

# --- app/app.json: set name + publisher explicitly (override the generic prefix pass) ---
$appJsonPath = $mainAppJsonPath
if (Test-Path $appJsonPath) {
    $appText = Get-Content $appJsonPath -Raw
    $appText = [regex]::Replace($appText, '("name"\s*:\s*")[^"]*(")', "`${1}$AppName`${2}")
    $appText = [regex]::Replace($appText, '("publisher"\s*:\s*")[^"]*(")', "`${1}$Publisher`${2}")
    $appText = Set-BcVersion $appText
    if ($PSCmdlet.ShouldProcess($appJsonPath, 'Set app name + publisher + BC version')) {
        Set-Content -Path $appJsonPath -Value $appText -NoNewline
    }
}

# --- test/app.json: handled explicitly so the Microsoft test-library dependencies
#     (Library Assert / Any) are never renamed. Excluded from the generic pass above
#     so the original app name + publisher survive for these precise edits. ---
if (Test-Path $testAppJsonPath) {
    $testText = Get-Content $testAppJsonPath -Raw
    $testText = $testText.Replace($cur.repoSlug, $RepoSlug)
    $testText = $testText.Replace($cur.adoOrg, $AdoOrg)
    if ($WorkItemSystem -eq 'GitHub') { $testText = $testText.Replace('AB#', '#') }
    if ($offset -ne 0) {
        $testText = [regex]::Replace($testText, '\b\d{5}\b', {
            param($m)
            $n = [int]$m.Value
            if ($n -ge $oldFrom -and $n -le $oldTo) { ($n + $offset).ToString() } else { $m.Value }
        })
    }
    # Rename the production-app reference: top-level name ("<AppName> Tests") and the
    # dependency on the production app both contain the old app name.
    $testText = $testText.Replace($cur.appName, $AppName)
    # Replace only the partner publisher entries; leave "Microsoft" dependencies intact.
    $testText = [regex]::Replace($testText, '("publisher"\s*:\s*")' + [regex]::Escape($cur.publisher) + '(")', "`${1}$Publisher`${2}")
    $testText = Set-BcVersion $testText
    if ($PSCmdlet.ShouldProcess($testAppJsonPath, 'Update test app manifest')) {
        Set-Content -Path $testAppJsonPath -Value $testText -NoNewline
    }
}

# --- Rename AL files carrying the old prefix in their name ---
if ($cur.appPrefix -ne $AppPrefix) {
    $renameTargets = Get-ChildItem -Path $RepoRoot -Recurse -File |
        Where-Object { $_.Name -like "*$($cur.appPrefix)*" -and ($_.FullName -notlike "*$sep.git$sep*") }
    foreach ($t in $renameTargets) {
        $newName = $t.Name.Replace($cur.appPrefix, $AppPrefix)
        if ($newName -ne $t.Name) {
            $newPath = Join-Path $t.DirectoryName $newName
            if ($PSCmdlet.ShouldProcess($t.FullName, "Rename to $newName")) {
                Move-Item -LiteralPath $t.FullName -Destination $newPath
            }
            Write-Host ("  renamed {0} -> {1}" -f $t.Name, $newName)
        }
    }
}

# --- Sync each agent's model: line from config.models ---
if (-not $SkipModels -and $config.models) {
    $agentsDir = Join-Path $RepoRoot '.github/agents'
    foreach ($prop in $config.models.PSObject.Properties) {
        if ($prop.Name -eq '_readme') { continue }
        $agentPath = Join-Path $agentsDir ("{0}.agent.md" -f $prop.Name)
        if (-not (Test-Path $agentPath)) { continue }
        $model = [string]$prop.Value
        $aText = Get-Content $agentPath -Raw
        $newText = [regex]::Replace($aText, '(?m)^model:\s*.*$', ('model: "{0}"' -f $model))
        if ($newText -ne $aText) {
            if ($PSCmdlet.ShouldProcess($agentPath, "Set model to $model")) {
                Set-Content -Path $agentPath -Value $newText -NoNewline
            }
            Write-Host ("  model {0,-16} -> {1}" -f $prop.Name, $model)
        }
    }
}

# --- Trim the unused work-item MCP group from agent tools ---
# When the project tracks work in GitHub Issues (not Azure DevOps Boards), the
# azure-devops/* MCP tools are dead weight in every agent's tool profile. Strip
# them so derived repos ship a lean, relevant toolset. (github/* is always kept:
# code + PRs live on GitHub regardless of the work-item system.)
if ($WorkItemSystem -eq 'GitHub') {
    $agentsDir = Join-Path $RepoRoot '.github/agents'
    if (Test-Path $agentsDir) {
        Get-ChildItem $agentsDir -Filter *.agent.md | ForEach-Object {
            $aText = Get-Content $_.FullName -Raw
            $newText = $aText.
                Replace(", 'azure-devops/*'", '').
                Replace("'azure-devops/*', ", '').
                Replace("'azure-devops/*'", '')
            if ($newText -ne $aText) {
                if ($PSCmdlet.ShouldProcess($_.FullName, 'Remove azure-devops/* from tools (GitHub work items)')) {
                    Set-Content -Path $_.FullName -Value $newText -NoNewline
                }
                Write-Host ("  tools    trimmed azure-devops/* from {0}" -f $_.Name)
            }
        }
    }
}

# --- Persist chosen values back to template.config.json ---
$config.initialized = $true
$config.values.appPrefix        = $AppPrefix
$config.values.ticketPrefix     = $TicketPrefix
$config.values.appName          = $AppName
$config.values.publisher        = $Publisher
$config.values.objectIdFrom     = $ObjectIdFrom
$config.values.objectIdTo       = $ObjectIdTo
$config.values.repoSlug         = $RepoSlug
$config.values.adoOrg           = $AdoOrg
$config.values.adoProject       = $AdoProject
$config.values.workItemSystem   = $WorkItemSystem
$config.values.defaultBranch    = $DefaultBranch
$config.values.branchingStrategy= $BranchingStrategy
$config.values.commitConvention = $CommitConvention
$config.values.environments     = $Environments
# Record the kept content categories so later template syncs never re-add what we pruned.
if ($doPrune) {
    if (-not $config.values.PSObject.Properties['sync']) {
        $config.values | Add-Member -NotePropertyName sync -NotePropertyValue ([pscustomobject]@{ customizationsPath = '.'; updateModels = $false; updateExtensions = $false; updateInstructions = $true })
    }
    $incObj = [pscustomobject]@{
        metaDocs = $keep.metaDocs; referenceDocs = $keep.referenceDocs; issueOps = $keep.issueOps
        specs    = $keep.specs;    prTemplate    = $keep.prTemplate;    sampleApp = $keep.sampleApp
    }
    if ($config.values.sync.PSObject.Properties['include']) { $config.values.sync.include = $incObj }
    else { $config.values.sync | Add-Member -NotePropertyName include -NotePropertyValue $incObj }
}
if ($PSCmdlet.ShouldProcess($configPath, 'Write updated config')) {
    $config | ConvertTo-Json -Depth 6 | Set-Content -Path $configPath
}

# --- Generate PROJECT.md (team-facing summary of the chosen conventions) ---
$linkLine = if ($WorkItemSystem -eq 'GitHub') {
    'Link commits and PRs to GitHub issues with `#<number>` (e.g. `#123`).'
} else {
    'Link commits and PRs to Azure DevOps work items with `AB#<id>` (e.g. `AB#123`).'
}
$envChain = $Environments -join ' -> '
$projectMd = @"
# Project Configuration

> Generated by ``scripts/Initialize-Template.ps1``. This file records the
> project-specific decisions made when this repository was initialized from the
> bc-alm-template.

| Setting | Value |
|---|---|
| App / object prefix | ``$AppPrefix`` |
| Ticket / spec prefix | ``$TicketPrefix`` |
| App name | $AppName |
| Publisher | $Publisher |
| Object ID range | ``$ObjectIdFrom``-``$ObjectIdTo`` |
| Repository | ``$RepoSlug`` |
| Work-item system | $WorkItemSystem |
| Azure DevOps org / project | $AdoOrg / $AdoProject |
| Default (production) branch | ``$DefaultBranch`` |
| Branching strategy | $BranchingStrategy (see [docs/branching-strategy.md](docs/branching-strategy.md)) |
| Commit convention | $CommitConvention |
| Environments | $envChain |

## Work-item linking

$linkLine

## Notes

- Object IDs must stay within ``$ObjectIdFrom``-``$ObjectIdTo``.
- All AL object names use the ``$AppPrefix`` prefix (see [AL coding standards](.github/instructions/al-coding-standards.instructions.md)).
"@
if ($PSCmdlet.ShouldProcess((Join-Path $RepoRoot 'PROJECT.md'), 'Write PROJECT.md')) {
    Set-Content -Path (Join-Path $RepoRoot 'PROJECT.md') -Value $projectMd
}

# --- Detect whether this is the template repo itself (never prune/clean it) ---
$templateRepo = 'AlexanderErdelyi/bc-alm-template'
$originUrl = ''
try { $originUrl = (& git -C $RepoRoot remote get-url origin 2>$null) } catch { }
$isTemplateRepo = [bool]($originUrl -and ($originUrl -match [regex]::Escape($templateRepo)))

# --- Optional: clean up template-only files in a repo created FROM the template ---
if ($CleanupTemplateFiles) {
    if ($isTemplateRepo) {
        Write-Host "`nSkipping template cleanup: this looks like the template repo itself ($originUrl)." -ForegroundColor Yellow
    }
    else {
        Write-Host "`nCleaning up template-only files" -ForegroundColor Cyan
        $removeList = @('CONTRIBUTING.md', 'scripts/Install-IntoExistingRepo.ps1', 'bootstrap.ps1')
        foreach ($rel in $removeList) {
            $p = Join-Path $RepoRoot $rel
            if (Test-Path $p) {
                if ($PSCmdlet.ShouldProcess($p, 'Remove template-only file')) { Remove-Item $p -Force }
                Write-Host "  removed    $rel" -ForegroundColor DarkGray
            }
        }

        $wsFile = Get-ChildItem -Path $RepoRoot -Filter '*.code-workspace' -File | Select-Object -First 1
        $wsName = if ($wsFile) { $wsFile.Name } else { 'the .code-workspace' }
        $readmePath = Join-Path $RepoRoot 'README.md'

        # Adapt the intro + getting-started to the content that survives pruning.
        $builtLine = if ($keep.referenceDocs) {
            'Built with the [BC ALM workflow](docs/workflow.md): spec-driven development, GitHub Copilot' + "`n" +
            'agents for every lifecycle stage, a documented [branching strategy](docs/branching-strategy.md),' + "`n" +
            'and enforced [AL coding standards](.github/instructions/al-coding-standards.instructions.md).'
        } else {
            'Built with a spec-driven BC ALM workflow: GitHub Copilot agents for every lifecycle stage' + "`n" +
            'and enforced [AL coding standards](.github/instructions/al-coding-standards.instructions.md).'
        }
        $gettingSteps = New-Object System.Collections.Generic.List[string]
        if ($keep.sampleApp) {
            $gettingSteps.Add("1. Open ``$wsName`` in VS Code and install the recommended AL extensions when prompted.")
        } else {
            $gettingSteps.Add("1. Add your AL project(s) and open the repo (or a ``*.code-workspace``) in VS Code; install the recommended AL extensions when prompted.")
        }
        if ($keep.specs) {
            $gettingSteps.Add("2. Pick up a ticket: copy ``specs/_TEMPLATE`` to ``specs/$TicketPrefix-123-short-name/``, fill in")
            $gettingSteps.Add("   ``brief.md``, open a spec PR, then implement.")
        }
        $gettingSteps.Add("$($gettingSteps.Count + 1). Open GitHub Copilot Chat and choose a ``bc-*`` agent — start with **BC Orchestrator** and give")
        $gettingSteps.Add("   it a ticket ID.")
        $gettingStarted = $gettingSteps -join "`n"
        $projectReadme = @"
# $AppName

$Publisher — a Microsoft Dynamics 365 Business Central extension.

$builtLine

## Project facts

See [PROJECT.md](PROJECT.md) for this project's prefix (``$AppPrefix``), object ID range
(``$ObjectIdFrom``-``$ObjectIdTo``), branching strategy, and commit convention.

## Getting started

$gettingStarted

## Staying up to date

This repository was created from
[bc-alm-template](https://github.com/$templateRepo). Pull later template improvements with:

``````powershell
pwsh ./scripts/Update-FromTemplate.ps1 -WhatIf   # preview, then drop -WhatIf
``````

…or let the **Template sync** GitHub Action (``.github/workflows/template-sync.yml``) open a PR
for you. Your AL code and configured values are never overwritten (see ``.templatesyncignore``).
"@
        if ($PSCmdlet.ShouldProcess($readmePath, 'Replace template README with a project README')) {
            Set-Content -Path $readmePath -Value $projectReadme
        }
        Write-Host "  wrote      README.md  (project README; template docs remain at github.com/$templateRepo)" -ForegroundColor Green
    }
}

# --- Prune content categories a working project doesn't need (config-driven) ---
if ($doPrune) {
    if ($isTemplateRepo) {
        Write-Host "`nSkipping content prune: this looks like the template repo itself." -ForegroundColor Yellow
    }
    else {
        # Category -> paths (mirrors sync.include in Install-IntoExistingRepo / Update-FromTemplate).
        $categoryPaths = [ordered]@{
            metaDocs      = @('.github/AGENT-ARCHITECTURE.md', '.github/WHEN-TO-USE.md', '.github/SKILLS.md')
            referenceDocs = @('docs')
            issueOps      = @('.github/ISSUE_TEMPLATE', '.github/ISSUE_ORCHESTRATION.md',
                '.github/workflows/issue-implementation.yml', '.github/workflows/issue-orchestrator.yml',
                '.github/workflows/issue-planning.yml')
            specs         = @('specs/_TEMPLATE')
            prTemplate    = @('.github/PULL_REQUEST_TEMPLATE.md')
            sampleApp     = @('app', 'test', 'bc-alm-template.code-workspace')
        }
        $pruned = 0
        Write-Host "`nPruning unused content categories" -ForegroundColor Cyan
        foreach ($cat in $categoryPaths.Keys) {
            if ($keep[$cat]) { continue }
            foreach ($rel in $categoryPaths[$cat]) {
                $p = Join-Path $RepoRoot $rel
                if (Test-Path $p) {
                    if ($PSCmdlet.ShouldProcess($p, "Remove ($cat)")) { Remove-Item $p -Recurse -Force }
                    Write-Host ("  removed    {0,-45} ({1})" -f $rel, $cat) -ForegroundColor DarkGray
                    $pruned++
                }
            }
        }
        $kept = @($keep.GetEnumerator() | Where-Object { $_.Value } | ForEach-Object { $_.Key })
        $dropped = @($keep.GetEnumerator() | Where-Object { -not $_.Value } | ForEach-Object { $_.Key })
        if ($pruned -eq 0) { Write-Host "  nothing to prune (all selected categories kept)." -ForegroundColor DarkGray }
        Write-Host ("  kept: {0}" -f ($(if ($kept) { $kept -join ', ' } else { '(none)' }))) -ForegroundColor Green
        if ($dropped) { Write-Host ("  dropped: {0}  (recorded in template.config.json sync.include; sync won't re-add them)" -f ($dropped -join ', ')) -ForegroundColor DarkGray }
    }
}

Write-Host "`nTemplate initialized." -ForegroundColor Green
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Review the diff (git status / git diff)."
Write-Host "  2. Generate fresh GUIDs for the 'id' in app/app.json AND test/app.json."
Write-Host ("  3. BC version set from template.config.json bcVersion (application {0}, platform {1}, runtime {2}). Edit that block and re-run to retarget." -f $(if($bcApplication){$bcApplication}else{'unchanged'}), $(if($bcPlatform){$bcPlatform}else{'unchanged'}), $(if($bcRuntime){$bcRuntime}else{'unchanged'}))
Write-Host "  4. Commit: the template is ready for your first feature."
