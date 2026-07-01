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

.EXAMPLE
    pwsh ./scripts/Initialize-Template.ps1 -Interactive

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

Write-Host "`nTemplate initialized." -ForegroundColor Green
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Review the diff (git status / git diff)."
Write-Host "  2. Generate fresh GUIDs for the 'id' in app/app.json AND test/app.json."
Write-Host ("  3. BC version set from template.config.json bcVersion (application {0}, platform {1}, runtime {2}). Edit that block and re-run to retarget." -f $(if($bcApplication){$bcApplication}else{'unchanged'}), $(if($bcPlatform){$bcPlatform}else{'unchanged'}), $(if($bcRuntime){$bcRuntime}else{'unchanged'}))
Write-Host "  4. Commit: the template is ready for your first feature."
