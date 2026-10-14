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

    EXISTING-REPO MODE: when the target was set up with scripts/Install-IntoExistingRepo.ps1
    (it records values.sync.existingRepo / a relocated customizationsPath), the script runs in
    a non-destructive mode. It localizes ONLY the template-owned files it installed (agents,
    skills, prompts, instructions, spec scaffold, the .vscode/docs it wrote) - setting the prefix,
    ticket key, repo slug and ADO org and documenting your object-ID range - and sets agent models
    and trims tools. It NEVER renumbers object IDs, rewrites your app.json (name/publisher/BC
    version), renames your files, overwrites your README, or prunes your app/test/docs folders.
    Defaults for prefix/name/publisher/ID range are auto-read from your app.json (+ AppSourceCop.json
    mandatory affix). Force with -ExistingRepo, or force the whole-tree behavior with -NewFromTemplate.

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
    # Project-specific tool IDs kept in every agent/prompt 'tools:' list across template
    # syncs (persisted to values.extraTools.all). Additive; e.g. -ExtraTools 'bc-code-intel/*','prism/*'.
    [string[]] $ExtraTools,

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
    # Force existing-repo (non-destructive) mode on/off. Auto-detected from template.config.json
    # (values.sync.existingRepo / a relocated customizationsPath) when not specified. In this mode
    # the initializer localizes ONLY the template-owned files it manages and never renumbers object
    # IDs, rewrites the real app.json, renames your files, overwrites your README, or prunes folders.
    [switch] $ExistingRepo,
    # Force the whole-tree "created FROM the template" behavior even if existing-repo markers exist.
    [switch] $NewFromTemplate,
    # Keep config, lock, PROJECT.md and scripts at the repo root instead of in .bc-alm/.
    [switch] $ClassicLayout,
    [string] $RepoRoot = ''
)

$ErrorActionPreference = 'Stop'
if (-not $RepoRoot) {
    $RepoRoot = if ((Split-Path (Split-Path $PSScriptRoot -Parent) -Leaf) -eq '.bc-alm') { Join-Path $PSScriptRoot '../..' } else { Join-Path $PSScriptRoot '..' }
}
# Long-path form (Resolve-Path / $env:TEMP can return 8.3 names like AERDEL~1).
$RepoRoot = (Get-Item -LiteralPath (Resolve-Path $RepoRoot).Path).FullName

# --- .bc-alm/ layout (mirrors core/layout.ts in the BC ALM VS Code extension) ----------
# Projects keep the BC ALM bookkeeping in one folder instead of the repo root:
#   .bc-alm/template.config.json, .bc-alm/template.lock.json, .bc-alm/scripts/*.ps1,
#   .bc-alm/.templatesyncignore, .bc-alm/PROJECT.md
# The template repository itself keeps the classic root layout.
$bcAlmScripts = @('Initialize-Template', 'Add-BCQuality', 'Start-ALLanguageServer', 'Update-FromTemplate', 'Enable-CopilotCustomizations', 'Install-IntoExistingRepo')

# Rewrite mentions of scripts/X.ps1, template.config.json, template.lock.json and
# .templatesyncignore to their .bc-alm/ location. $depth = folders the file was relocated by
# (customizationsPath), so relative links still resolve. Idempotent.
function ConvertTo-BcAlmLayout([string] $text, [int] $depth = 0) {
    if (-not $text) { return $text }
    $pattern = '(?<![A-Za-z0-9_.\\/-])((?:\.\.?[/\\])*|\$\{workspaceFolder\}[/\\])(?:scripts([/\\])(' + ($bcAlmScripts -join '|') + ')\.ps1|template\.(config|lock)\.json|\.templatesyncignore)'
    $ms = [regex]::Matches($text, $pattern)
    if ($ms.Count -eq 0) { return $text }
    $sb = New-Object System.Text.StringBuilder
    $pos = 0
    foreach ($m in $ms) {
        [void]$sb.Append($text, $pos, $m.Index - $pos)
        $prefix = $m.Groups[1].Value
        $sep = if ($prefix.EndsWith('\')) { '\' } else { '/' }
        $up = if ($depth -gt 0 -and ($prefix.StartsWith('${workspaceFolder}') -or $prefix.StartsWith('..'))) { "..$sep" * $depth } else { '' }
        $rest = if ($m.Groups[3].Success) { 'scripts' + $m.Groups[2].Value + $m.Groups[3].Value + '.ps1' }
                elseif ($m.Groups[4].Success) { 'template.' + $m.Groups[4].Value + '.json' }
                else { '.templatesyncignore' }
        [void]$sb.Append($prefix + $up + '.bc-alm' + $sep + $rest)
        $pos = $m.Index + $m.Length
    }
    [void]$sb.Append($text, $pos, $text.Length - $pos)
    return $sb.ToString()
}

function Get-BcAlmHash([string] $path) {
    $enc = New-Object System.Text.UTF8Encoding($false)
    $t = [System.IO.File]::ReadAllText($path, $enc)
    if ($t.Length -gt 0 -and $t[0] -eq [char]0xFEFF) { $t = $t.Substring(1) }
    $t = $t.Replace("`r`n", "`n").Replace("`r", "`n")
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return -join ($sha.ComputeHash($enc.GetBytes($t)) | ForEach-Object { $_.ToString('x2') }) }
    finally { $sha.Dispose() }
}

# Move config, lock, scripts, .templatesyncignore and PROJECT.md of a classic-layout project
# into .bc-alm/, rename the lock keys and fix the links that pointed at the old locations.
# Same steps as migrateToBcAlm() + the sync-workflow fix in the VS Code extension.
function Move-ToBcAlmLayout([string] $root) {
    $enc = New-Object System.Text.UTF8Encoding($false)
    $sd = Join-Path $root '.bc-alm'
    $cr = ''
    try {
        $c = [System.IO.File]::ReadAllText((Join-Path $root 'template.config.json'), $enc) | ConvertFrom-Json
        $cp = [string]$c.values.sync.customizationsPath
        if ($cp -and $cp -ne '.') { $cr = $cp.Trim().TrimEnd('/', '\').Replace('\', '/') }
    } catch { }
    $moved = New-Object System.Collections.Generic.List[string]
    $mv = {
        param([string] $from, [string] $to)
        $f = Join-Path $root $from
        if (-not (Test-Path -LiteralPath $f -PathType Leaf)) { return $false }
        $t = Join-Path $root $to
        $d = Split-Path $t -Parent
        if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
        Move-Item -LiteralPath $f -Destination $t -Force
        $moved.Add("$from -> $to")
        return $true
    }
    [void](& $mv 'template.config.json' '.bc-alm/template.config.json')
    [void](& $mv 'template.lock.json' '.bc-alm/template.lock.json')
    [void](& $mv '.templatesyncignore' '.bc-alm/.templatesyncignore')
    if (-not (& $mv 'PROJECT.md' '.bc-alm/PROJECT.md') -and $cr) { [void](& $mv "$cr/PROJECT.md" '.bc-alm/PROJECT.md') }
    foreach ($n in $bcAlmScripts) { [void](& $mv "scripts/$n.ps1" ".bc-alm/scripts/$n.ps1") }
    $sdir = Join-Path $root 'scripts'
    if ((Test-Path -LiteralPath $sdir) -and -not (Get-ChildItem -LiteralPath $sdir -Force)) { Remove-Item -LiteralPath $sdir -Force }

    # Lock keys: scripts/X.ps1 and .templatesyncignore now live under .bc-alm/ (kept sorted ordinally).
    $lockFile = Join-Path $sd 'template.lock.json'
    if (Test-Path -LiteralPath $lockFile) {
        $lt = [System.IO.File]::ReadAllText($lockFile, $enc)
        $keyRe = '^(scripts/(?:' + ($bcAlmScripts -join '|') + ')\.ps1|\.templatesyncignore)$'
        $fm = [regex]::Match($lt, '(?s)(\r?\n  "files": \{\r?\n)(.*?)(\r?\n  \}\r?\n?\}\s*)$')
        if ($fm.Success) {
            $entries = [regex]::Matches($fm.Groups[2].Value, '(?s)    "((?:[^"\\]|\\.)*)": \{.*?\r?\n    \}')
            $sorted = New-Object 'System.Collections.Generic.SortedDictionary[string,string]' ([System.StringComparer]::Ordinal)
            foreach ($en in $entries) {
                $k = $en.Groups[1].Value
                $nk = if ($k -match $keyRe) { ".bc-alm/$k" } else { $k }
                $sorted[$nk] = '    "' + $nk + '"' + $en.Value.Substring($k.Length + 6)
            }
            $nl = if ($lt.Contains("`r`n")) { "`r`n" } else { "`n" }
            $body = @($sorted.Values) -join (',' + $nl)
            $lt = $lt.Substring(0, $fm.Index) + $fm.Groups[1].Value + $body + $fm.Groups[3].Value
            [System.IO.File]::WriteAllText($lockFile, $lt, $enc)
        }
    }

    # README links to PROJECT.md and the update script.
    $readmes = @('README.md'); if ($cr) { $readmes += "$cr/README.md" }
    foreach ($r in $readmes) {
        $f = Join-Path $root $r
        if (-not (Test-Path -LiteralPath $f -PathType Leaf)) { continue }
        $t = [System.IO.File]::ReadAllText($f, $enc)
        $up = '../' * ($r.Split('/').Count - 1)
        $n = [regex]::Replace($t, '\]\((?:\./)?PROJECT\.md\)', "](${up}.bc-alm/PROJECT.md)")
        $n = [regex]::Replace($n, '(?<![A-Za-z0-9_.\\/-])((?:\./)?)scripts/Update-FromTemplate\.ps1', '$1.bc-alm/scripts/Update-FromTemplate.ps1')
        if ($n -ne $t) { [System.IO.File]::WriteAllText($f, $n, $enc); $moved.Add("$r (links)") }
    }

    # The sync workflow must call the moved script (fixed even when edited; the old path is gone).
    $wf = Join-Path $root '.github/workflows/template-sync.yml'
    if (Test-Path -LiteralPath $wf -PathType Leaf) {
        $t = [System.IO.File]::ReadAllText($wf, $enc)
        if (-not $t.Contains('.bc-alm/scripts/Update-FromTemplate.ps1')) {
            $before = Get-BcAlmHash $wf
            $n = [regex]::Replace($t, '(?<![A-Za-z0-9_.\\/-])\./scripts/Update-FromTemplate\.ps1', './.bc-alm/scripts/Update-FromTemplate.ps1')
            if ($n -ne $t) {
                [System.IO.File]::WriteAllText($wf, $n, $enc)
                $moved.Add('.github/workflows/template-sync.yml (script path)')
                if (Test-Path -LiteralPath $lockFile) {
                    $after = Get-BcAlmHash $wf
                    $lt = [System.IO.File]::ReadAllText($lockFile, $enc)
                    $em = [regex]::Match($lt, '(?s)"\.github/workflows/template-sync\.yml": \{.*?"installedHash": "([0-9a-f]+)"')
                    if ($em.Success -and $em.Groups[1].Value -eq $before) {
                        $g = $em.Groups[1]
                        $lt = $lt.Substring(0, $g.Index) + $after + $lt.Substring($g.Index + $g.Length)
                        [System.IO.File]::WriteAllText($lockFile, $lt, $enc)
                    }
                }
            }
        }
    }
    return $moved
}

$stateDir = if (Test-Path -LiteralPath (Join-Path $RepoRoot '.bc-alm/template.config.json')) { '.bc-alm' } else { '' }
$stateRoot = if ($stateDir) { Join-Path $RepoRoot $stateDir } else { $RepoRoot }
$configPath = Join-Path $stateRoot 'template.config.json'
if (-not (Test-Path $configPath)) {
    throw "template.config.json not found at $configPath. Run this from the template repo root."
}
$config = Get-Content $configPath -Raw | ConvertFrom-Json
$cur = $config.values

# Honor a relocated customizations layout (e.g. app/.github) recorded by the installer,
# so agent model-writing / tool-trimming / pruning target the right folder. Platform
# files (workflows, ISSUE_TEMPLATE, PR template, docs) always stay at the repo root.
$custRoot = ''
if ($cur.PSObject.Properties['sync'] -and $cur.sync.PSObject.Properties['customizationsPath'] -and $cur.sync.customizationsPath -and $cur.sync.customizationsPath -ne '.') {
    $custRoot = ([string]$cur.sync.customizationsPath).Trim().TrimEnd('/', '\')
}
$ghPrefix = if ($custRoot) { "$custRoot/.github" } else { '.github' }
$specsPrefix = if ($custRoot) { "$custRoot/specs" } else { 'specs' }

# --- Existing-repo (non-destructive) mode ---------------------------------------------------
# A repo created FROM the template (via "Use this template") owns the whole tree, so the
# initializer renumbers the sample app, renames prefixed files, and rewrites the README.
# A repo the template was INSTALLED INTO already contains the user's real AL source, so all
# of that would be destructive. Install-IntoExistingRepo.ps1 records values.sync.existingRepo;
# fall back to "a relocated customizationsPath implies an existing repo". -ExistingRepo /
# -NewFromTemplate force it either way.
$existingRepo =
    if ($NewFromTemplate) { $false }
    elseif ($ExistingRepo) { $true }
    elseif ($cur.PSObject.Properties['sync'] -and $cur.sync.PSObject.Properties['existingRepo']) { [bool]$cur.sync.existingRepo }
    else { [bool]$custRoot }

# --- Auto-detect sensible defaults from the target app's app.json (so Enter just works) -----
$appDefaults = @{}
$ajCandidates = @()
if ($custRoot) { $ajCandidates += (Join-Path $RepoRoot (Join-Path $custRoot 'app.json')) }
$ajCandidates += (Join-Path $RepoRoot 'app/app.json'), (Join-Path $RepoRoot 'app.json')
$ajPath = $ajCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($ajPath) {
    try {
        $aj = Get-Content $ajPath -Raw | ConvertFrom-Json
        if ($aj.PSObject.Properties['name'] -and $aj.name)           { $appDefaults.appName   = [string]$aj.name }
        if ($aj.PSObject.Properties['publisher'] -and $aj.publisher) { $appDefaults.publisher = [string]$aj.publisher }
        if ($aj.PSObject.Properties['idRanges'] -and $aj.idRanges.Count -gt 0) {
            $appDefaults.objectIdFrom = [int](($aj.idRanges | ForEach-Object { [int]$_.from } | Measure-Object -Minimum).Minimum)
            $appDefaults.objectIdTo   = [int](($aj.idRanges | ForEach-Object { [int]$_.to }   | Measure-Object -Maximum).Maximum)
        }
        elseif ($aj.PSObject.Properties['idRange'] -and $aj.idRange) {
            $appDefaults.objectIdFrom = [int]$aj.idRange.from
            $appDefaults.objectIdTo   = [int]$aj.idRange.to
        }
        # Object-name prefix comes from the AppSourceCop mandatory affix when configured.
        $ascPath = Join-Path (Split-Path $ajPath) 'AppSourceCop.json'
        if (Test-Path $ascPath) {
            $asc = Get-Content $ascPath -Raw | ConvertFrom-Json
            if ($asc.PSObject.Properties['mandatoryAffixes']) {
                $aff = @($asc.mandatoryAffixes) | Where-Object { $_ } | Select-Object -First 1
                if ($aff) { $appDefaults.appPrefix = ([string]$aff).Trim() }
            }
        }
        Write-Host ("Detected from {0}:" -f (Resolve-Path $ajPath).Path) -ForegroundColor DarkCyan
        foreach ($k in 'appPrefix', 'appName', 'publisher', 'objectIdFrom', 'objectIdTo') {
            if ($appDefaults.ContainsKey($k)) { Write-Host ("  {0,-13} {1}" -f $k, $appDefaults[$k]) -ForegroundColor DarkCyan }
        }
    }
    catch { Write-Host "  (could not parse $ajPath - $_)" -ForegroundColor DarkYellow }
}
# Prefer an app.json-detected value over the template default when prompting.
function Def($key, $fallback) { if ($appDefaults.ContainsKey($key) -and $appDefaults[$key]) { return $appDefaults[$key] } return $fallback }

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

# Tolerant integer read: accepts pasted noise like "50000 - 99699," and takes the first number.
function Read-Int([string] $prompt, $default) {
    $v = Read-Value $prompt $default
    if ($v -is [int]) { return $v }
    $m = [regex]::Match([string]$v, '\d+')
    if ($m.Success) { return [int]$m.Value }
    return [int]$default
}

# --- Resolve effective values (param > interactive prompt > detected/app.json > current default) ---
if (-not $AppPrefix)        { $AppPrefix        = Read-Value 'App / object prefix (e.g. NOB)'       (Def 'appPrefix' $cur.appPrefix) }
if (-not $TicketPrefix)     { $TicketPrefix     = Read-Value 'Ticket / branch prefix for PREFIX-123 refs and feature/PREFIX-{ID}-* branches (often same as app prefix; type "none" for bare feature/123)' $cur.ticketPrefix }
# Allow an explicit "no prefix" scheme: 'none'/'-'/'(none)' => bare feature/123, [123]
if ($TicketPrefix -match '^(none|-|\(none\))$') { $TicketPrefix = '' }
if (-not $AppName)          { $AppName          = Read-Value 'App display name'                    (Def 'appName' $cur.appName) }
if (-not $Publisher)        { $Publisher        = Read-Value 'Publisher (company name)'            (Def 'publisher' $cur.publisher) }
if (-not $ObjectIdFrom)     { $ObjectIdFrom     = Read-Int   'Object ID range - from'              (Def 'objectIdFrom' $cur.objectIdFrom) }
if (-not $ObjectIdTo)       { $ObjectIdTo       = Read-Int   'Object ID range - to'                (Def 'objectIdTo' $cur.objectIdTo) }
if (-not $WorkItemSystem)   { $WorkItemSystem   = Read-Value 'Work-item system (ADO/GitHub)'       $cur.workItemSystem }
if (-not $RepoSlug -and $WorkItemSystem -ne 'ADO') { $RepoSlug = Read-Value 'GitHub repo slug (owner/repo)' $cur.repoSlug }
if (-not $RepoSlug)         { $RepoSlug         = $cur.repoSlug }
if (-not $AdoOrg)           { $AdoOrg           = Read-Value 'Azure DevOps organization (the {org} in dev.azure.com/{org})' $cur.adoOrg }
if (-not $AdoProject)       { $AdoProject       = Read-Value 'Azure DevOps project (optional)'     $cur.adoProject }
if (-not $DefaultBranch)    { $DefaultBranch    = Read-Value 'Default (production) branch'         $cur.defaultBranch }
if (-not $BranchingStrategy){ $BranchingStrategy= Read-Value 'Branching strategy id (feature-release-selective | gitflow | github-flow | trunk)' $cur.branchingStrategy }
if (-not $CommitConvention) { $CommitConvention = Read-Value 'Commit convention (conventional | none)' $cur.commitConvention }
if (-not $Environments)     { $Environments     = (Read-Value 'Environments, comma separated (BC environment/deploy targets; use e.g. DEV,TEST,PROD or a single onprem name)' ($cur.environments -join ',')) -split '\s*,\s*' }

# Normalize Environments so a single comma-joined value (e.g. "TEST,PROD" passed by a VS Code
# task input or CI) is split into individual names just like the interactive prompt does.
if ($Environments) { $Environments = @($Environments | ForEach-Object { $_ -split '\s*,\s*' } | Where-Object { $_ }) }

# Extra tool IDs to keep in every agent/prompt across template syncs (persisted to
# values.extraTools.all and re-applied by Update-FromTemplate.ps1). Defaults to whatever
# is already configured. Prefer generic namespaces (e.g. 'al/*'); machine-only servers
# can instead be toggled per-session in VS Code's tool picker.
if (-not $PSBoundParameters.ContainsKey('ExtraTools')) {
    $curExtra = @()
    if ($cur.PSObject.Properties['extraTools'] -and $cur.extraTools.PSObject.Properties['all'] -and $cur.extraTools.all) {
        $curExtra = @($cur.extraTools.all)
    }
    $ans = Read-Value 'Extra tool IDs kept in every agent/prompt across syncs (comma-separated, e.g. bc-code-intel/*,prism/*; blank for none)' ($curExtra -join ',')
    $ExtraTools = if ([string]::IsNullOrWhiteSpace($ans)) { @() } else { @($ans -split '\s*,\s*' | Where-Object { $_ }) }
}
$ExtraTools = @($ExtraTools | ForEach-Object { $_ -split '\s*,\s*' } | ForEach-Object { ([string]$_).Trim().Trim("'`"") } | Where-Object { $_ })
# Offer template cleanup when interactive and not explicitly specified on the command line.
# Never in existing-repo mode: those files (README, installer) belong to the user's project.
if ($Interactive -and -not $existingRepo -and -not $PSBoundParameters.ContainsKey('CleanupTemplateFiles')) {
    $ans = Read-Host 'Remove template-only files (CONTRIBUTING, installer, bootstrap) and write a project README? [Y/n]'
    $CleanupTemplateFiles = [string]::IsNullOrWhiteSpace($ans) -or ($ans -match '^(y|yes)$')
}

# --- Resolve the content-prune profile (which categories a new project keeps) ---
# Keep-defaults for a NEW project: drop the authoring meta-docs; keep everything else
# (the docs library and generated README/PROJECT.md link to it, and the sample app IS
# the project's starting point, so it is never auto-deleted unless -NoSampleApp).
$doPrune = if ($PSBoundParameters.ContainsKey('Prune')) { [bool]$Prune } else { [bool]$CleanupTemplateFiles }
# In an existing repo the template installed only a lean set; the prune category paths (app/,
# test/, docs/, .github/workflows) would target the USER's own folders, so pruning and README
# rewriting are hard-disabled. The installer's sync.include already scoped what was copied.
if ($existingRepo) { $CleanupTemplateFiles = $false; $doPrune = $false }
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
# Never renumber object IDs in an existing repo — those 5-digit numbers are the user's real
# objects, not the sample app's. Documented ranges are localized as a literal string instead.
if ($existingRepo) { $offset = 0 }

Write-Host "`nApplying template configuration:" -ForegroundColor Cyan
if ($existingRepo) { Write-Host "  mode             existing repo (non-destructive: localizes template files only, no renumber/rename/prune)" -ForegroundColor Yellow }
Write-Host ("  prefix           {0} -> {1}" -f $cur.appPrefix, $AppPrefix)
Write-Host ("  ticket prefix    {0} -> {1}" -f $cur.ticketPrefix, $(if ($TicketPrefix) { $TicketPrefix } else { '(none / bare IDs)' }))
Write-Host ("  object ID range  {0}-{1} -> {2}-{3}{4}" -f $oldFrom, $oldTo, $ObjectIdFrom, $ObjectIdTo, $(if ($existingRepo) { '  (docs only; objects not renumbered)' } else { "  (offset $offset)" }))
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
# Template engine files must keep the template's values: the scripts carry the template URL
# and literal 'AB#' handling, the sync workflow's guard must keep naming the template repo.
# Update-FromTemplate.ps1 skips the same files when it re-applies values.
function Test-EngineFile([string] $full) {
    $rel = $full.Substring($RepoRoot.Length).TrimStart('\', '/').Replace('\', '/')
    return ($rel -match '^(\.bc-alm/)?scripts/[^/]+\.ps1$') -or ($rel -eq 'bootstrap.ps1') -or
           ($rel -eq '.github/workflows/template-sync.yml')
}
$mainAppJsonPath = Join-Path $RepoRoot 'app/app.json'
$testAppJsonPath = Join-Path $RepoRoot 'test/app.json'

if ($existingRepo) {
    # Localize ONLY the template-owned files we installed — never the user's AL source, their
    # app.json, or unrelated docs. These roots hold the agents/skills/prompts/instructions,
    # the spec scaffold, the .vscode config the template wrote, and any root platform files.
    $ownedRoots = @($ghPrefix, "$specsPrefix/_TEMPLATE", "$custRoot/.vscode", '.github', 'docs') |
        Where-Object { $_ } | Select-Object -Unique |
        ForEach-Object { Join-Path $RepoRoot $_ } | Where-Object { Test-Path $_ }
    $files = @()
    foreach ($root in $ownedRoots) {
        $files += Get-ChildItem -Path $root -Recurse -File | Where-Object {
            $p = $_.FullName
            ($textExt -contains $_.Extension.ToLower()) -and
            (-not ($excludeDirs | Where-Object { $p -like "*$sep$_$sep*" })) -and
            ($p -ne $thisScript) -and ($p -ne $configPath) -and -not (Test-EngineFile $p)
        }
    }
    $files = @($files | Sort-Object FullName -Unique)
}
else {
    $files = Get-ChildItem -Path $RepoRoot -Recurse -File | Where-Object {
        $p = $_.FullName
        ($textExt -contains $_.Extension.ToLower()) -and
        (-not ($excludeDirs | Where-Object { $p -like "*$sep$_$sep*" })) -and
        ($p -ne $thisScript) -and
        ($p -ne $configPath) -and
        ($p -ne $testAppJsonPath) -and
        -not (Test-EngineFile $p)
    }
}

function Update-Content([string] $text) {
    $oldPrefix = [regex]::Escape($cur.appPrefix)
    $oldTicket = [regex]::Escape($cur.ticketPrefix)

    # 1. Repo slug + ADO org (literal)
    $text = $text.Replace($cur.repoSlug, $RepoSlug)
    $text = $text.Replace($cur.adoOrg, $AdoOrg)
    # 2. Ticket prefix first ('PREFIX-123', 'PREFIX-{ID}') so it doesn't collide with bare prefix.
    #    Empty $TicketPrefix => strip the prefix and its dash entirely (bare 'feature/123', 'specs/123-*').
    $ticketRepl = if ($TicketPrefix) { "$TicketPrefix-" } else { '' }
    $text = [regex]::Replace($text, "\b$oldTicket-", $ticketRepl)
    # 3. Bare app/object prefix (object names, identifiers, doc examples)
    $text = [regex]::Replace($text, "\b$oldPrefix", $AppPrefix)
    # 4. Object IDs. In a fresh template repo, shift the sample app's IDs into the new range.
    #    In an existing repo we don't renumber (offset is 0); we only localize the range where it
    #    appears as a documented literal (e.g. "50100-50199" in instructions) so guidance is right.
    if ($offset -ne 0) {
        $text = [regex]::Replace($text, '\b\d{5}\b', {
            param($m)
            $n = [int]$m.Value
            if ($n -ge $oldFrom -and $n -le $oldTo) { ($n + $offset).ToString() } else { $m.Value }
        })
    }
    elseif ($existingRepo -and ($ObjectIdFrom -ne $oldFrom -or $ObjectIdTo -ne $oldTo)) {
        foreach ($dash in @('-', [char]0x2013, [char]0x2014)) {
            $text = $text.Replace(('{0}{1}{2}' -f $oldFrom, $dash, $oldTo), ('{0}-{1}' -f $ObjectIdFrom, $ObjectIdTo))
        }
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

# --- Sample app manifests (app/ + test/). Only for a fresh template repo: in an existing repo
#     these paths point at the user's real, production manifests, so we never touch name,
#     publisher, BC version, or object IDs there. ---
if (-not $existingRepo) {
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
}

# --- Rename AL files carrying the old prefix in their name (fresh template repo only; in an
#     existing repo this would rename the user's own files) ---
if (-not $existingRepo -and $cur.appPrefix -ne $AppPrefix) {
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
    $agentsDir = Join-Path $RepoRoot "$ghPrefix/agents"
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

# --- Trim the unused work-item MCP group from agent + prompt tools ---
# When the project tracks work in GitHub Issues (not Azure DevOps Boards), the
# azure-devops/* MCP tools are dead weight in every tool profile. Strip them so
# derived repos ship a lean, relevant toolset. (github/* is always kept: code + PRs
# live on GitHub regardless of the work-item system.)
if ($WorkItemSystem -eq 'GitHub') {
    foreach ($sub in 'agents', 'prompts') {
        $toolDir = Join-Path $RepoRoot "$ghPrefix/$sub"
        if (-not (Test-Path $toolDir)) { continue }
        Get-ChildItem $toolDir -File | Where-Object { $_.Name -match '\.(agent|prompt)\.md$' } | ForEach-Object {
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

# --- Merge project-specific extra tools into agent + prompt 'tools:' lists ---
# Additive, de-duplicated; the same set is re-applied by Update-FromTemplate.ps1 after
# every sync so custom MCP servers survive the refresh that overwrites these files.
if ($ExtraTools -and $ExtraTools.Count) {
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
        Write-Host ("  tools    {0} += {1}" -f $filePath.Substring($RepoRoot.Length).TrimStart('\', '/'), ($addedTools -join ', '))
    }
    foreach ($sub in 'agents', 'prompts') {
        $toolDir = Join-Path $RepoRoot "$ghPrefix/$sub"
        if (-not (Test-Path $toolDir)) { continue }
        Get-ChildItem $toolDir -File | Where-Object { $_.Name -match '\.(agent|prompt)\.md$' } | ForEach-Object {
            Add-ExtraToolsToFile $_.FullName $ExtraTools
        }
    }
}

# --- Detect whether this is the template repo itself (never prune/clean/relayout it) ---
$templateRepo = 'AlexanderErdelyi/bc-alm-template'
$originUrl = ''
try { $originUrl = (& git -C $RepoRoot remote get-url origin 2>$null) } catch { }
$isTemplateRepo = [bool]($originUrl -and ($originUrl -match [regex]::Escape($templateRepo)))

# --- Projects keep config, lock, PROJECT.md and scripts in .bc-alm/ (the template repo itself doesn't) ---
$useLayout = [bool]$stateDir -or (-not $isTemplateRepo -and -not $ClassicLayout)
if ($useLayout -and -not $stateDir -and $PSCmdlet.ShouldProcess($RepoRoot, 'Move config, lock and scripts into .bc-alm/')) {
    Write-Host "`nMoving BC ALM files into .bc-alm/" -ForegroundColor Cyan
    foreach ($m in (Move-ToBcAlmLayout $RepoRoot)) { Write-Host "  moved      $m" -ForegroundColor DarkGray }
    $stateDir = '.bc-alm'
    $stateRoot = Join-Path $RepoRoot $stateDir
    $configPath = Join-Path $stateRoot 'template.config.json'
}
if (-not $stateDir) { $useLayout = $false }  # -WhatIf / declined: keep the classic paths

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
# Persist extra tools (preserving any per-agent/per-prompt maps) so syncs re-apply them.
$etAgents  = if ($cur.PSObject.Properties['extraTools'] -and $cur.extraTools.PSObject.Properties['agents'])  { $cur.extraTools.agents }  else { [pscustomobject]@{} }
$etPrompts = if ($cur.PSObject.Properties['extraTools'] -and $cur.extraTools.PSObject.Properties['prompts']) { $cur.extraTools.prompts } else { [pscustomobject]@{} }
$etObj = [pscustomobject]@{ all = @($ExtraTools); agents = $etAgents; prompts = $etPrompts }
if ($config.values.PSObject.Properties['extraTools']) { $config.values.extraTools = $etObj }
else { $config.values | Add-Member -NotePropertyName extraTools -NotePropertyValue $etObj }
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
# ADO projects keep the template's GitHub slug (so template links stay valid); don't present it as this repo.
$repoDisplay = if ($WorkItemSystem -eq 'ADO' -and $RepoSlug -match '/bc-alm-template$') { '(none - Azure DevOps repository)' } else { "``$RepoSlug``" }
# Links in PROJECT.md are relative to wherever it is written.
$projectMdRel = if ($useLayout) { "$stateDir/PROJECT.md" } elseif ($existingRepo -and $custRoot) { "$custRoot/PROJECT.md" } else { 'PROJECT.md' }
$pmUp = '../' * ($projectMdRel.Split('/').Count - 1)
$pmInCust = [bool]$custRoot -and $projectMdRel -eq "$custRoot/PROJECT.md"
$pmInstr = if ($pmInCust) { '.github/instructions/al-coding-standards.instructions.md' } else { "$pmUp$ghPrefix/instructions/al-coding-standards.instructions.md" }
$pmDocs = "${pmUp}docs/branching-strategy.md"
$initScriptRel = if ($useLayout) { "$stateDir/scripts/Initialize-Template.ps1" } else { 'scripts/Initialize-Template.ps1' }
$projectMd = @"
# Project Configuration

> Generated by ``$initScriptRel``. This file records the
> project-specific decisions made when this repository was initialized from the
> bc-alm-template.

| Setting | Value |
|---|---|
| App / object prefix | ``$AppPrefix`` |
| Ticket / branch prefix | ``$(if ($TicketPrefix) { $TicketPrefix } else { '(none — bare IDs)' })`` |
| App name | $AppName |
| Publisher | $Publisher |
| Object ID range | ``$ObjectIdFrom``-``$ObjectIdTo`` |
| Repository | $repoDisplay |
| Work-item system | $WorkItemSystem |
| Azure DevOps org / project | $AdoOrg / $AdoProject |
| Default (production) branch | ``$DefaultBranch`` |
| Branching strategy | $BranchingStrategy (see [docs/branching-strategy.md]($pmDocs)) |
| Commit convention | $CommitConvention |
| Environments | $envChain |

## Work-item linking

$linkLine

## Notes

- Object IDs must stay within ``$ObjectIdFrom``-``$ObjectIdTo``.
- All AL object names use the ``$AppPrefix`` prefix (see [AL coding standards]($pmInstr)).
"@
$projectMdPath = Join-Path $RepoRoot $projectMdRel
if ($PSCmdlet.ShouldProcess($projectMdPath, 'Write PROJECT.md')) {
    # Existing repo, classic layout: keep PROJECT.md alongside the customizations (e.g. app/PROJECT.md).
    $pmDir = Split-Path $projectMdPath -Parent
    if (-not (Test-Path -LiteralPath $pmDir)) { New-Item -ItemType Directory -Path $pmDir -Force | Out-Null }
    Set-Content -Path $projectMdPath -Value $projectMd
}

# --- Optional: clean up template-only files in a repo created FROM the template ---
if ($CleanupTemplateFiles) {
    if ($isTemplateRepo) {
        Write-Host "`nSkipping template cleanup: this looks like the template repo itself ($originUrl)." -ForegroundColor Yellow
    }
    else {
        Write-Host "`nCleaning up template-only files" -ForegroundColor Cyan
        $removeList = @('CONTRIBUTING.md', 'scripts/Install-IntoExistingRepo.ps1', '.bc-alm/scripts/Install-IntoExistingRepo.ps1',
            'bootstrap.ps1', 'vscode-extension', '.github/workflows/vscode-extension.yml',
            '.templates', '.github/workflows/template-validate.yml', '.github/CODEOWNERS', '.github/PULL_REQUEST_TEMPLATE')
        foreach ($rel in $removeList) {
            $p = Join-Path $RepoRoot $rel
            if (Test-Path $p) {
                if ($PSCmdlet.ShouldProcess($p, 'Remove template-only file')) { Remove-Item $p -Recurse -Force }
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
            $gettingSteps.Add("2. Pick up a ticket: copy ``specs/_TEMPLATE/_story`` to ``specs/<Area>/us-123-short-name/`` (and")
            $gettingSteps.Add("   ``_area`` to ``specs/<Area>/`` if new), fill in ``brief.md``, open a spec PR, then implement.")
        }
        $gettingSteps.Add("$($gettingSteps.Count + 1). Open GitHub Copilot Chat and choose a ``bc-*`` agent — start with **BC Orchestrator** and give")
        $gettingSteps.Add("   it a ticket ID.")
        $gettingStarted = $gettingSteps -join "`n"
        $projectReadme = @"
# $AppName

$Publisher — a Microsoft Dynamics 365 Business Central extension.

$builtLine

## Project facts

See [PROJECT.md]($projectMdRel) for this project's prefix (``$AppPrefix``), object ID range
(``$ObjectIdFrom``-``$ObjectIdTo``), branching strategy, and commit convention.

## Getting started

$gettingStarted

## Staying up to date

This repository was created from
[bc-alm-template](https://github.com/$templateRepo). Pull later template improvements with:

``````powershell
pwsh ./$(if ($useLayout) { "$stateDir/" })scripts/Update-FromTemplate.ps1 -WhatIf   # preview, then drop -WhatIf
``````

…or let the **Template sync** GitHub Action (``.github/workflows/template-sync.yml``) open a PR
for you. Your AL code and configured values are never overwritten (see ``$(if ($useLayout) { "$stateDir/" }).templatesyncignore``).
"@
        if ($useLayout) {
            $projectReadme += "`nThe BC ALM bookkeeping (``template.config.json``, ``template.lock.json``, scripts) lives in ``$stateDir/``.`n"
        }
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
        # Relocated categories (metaDocs, specs) follow customizationsPath; platform files
        # (issueOps workflows/templates, PR template, docs, sample app) stay at the repo root.
        $categoryPaths = [ordered]@{
            metaDocs      = @("$ghPrefix/AGENT-ARCHITECTURE.md", "$ghPrefix/WHEN-TO-USE.md", "$ghPrefix/SKILLS.md")
            referenceDocs = @('docs')
            issueOps      = @('.github/ISSUE_TEMPLATE', '.github/ISSUE_ORCHESTRATION.md',
                '.github/workflows/issue-implementation.yml', '.github/workflows/issue-orchestrator.yml',
                '.github/workflows/issue-planning.yml')
            specs         = @("$specsPrefix/_TEMPLATE")
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

# --- Point template prose at the .bc-alm/ locations -----------------------------------------
# Same files and rewrite as Update-FromTemplate.ps1 / the VS Code extension apply on sync, so the
# result matches what a later sync would produce (and isn't reported as a local edit).
if ($useLayout -and $stateDir) {
    $layoutExt = @('.md', '.json', '.jsonc', '.yml', '.yaml', '.txt')
    $relocTrees = @('.github/agents', '.github/skills', '.github/prompts', '.github/instructions', 'specs/_TEMPLATE')
    $rootOnlyTrees = @('docs', '.github/ISSUE_TEMPLATE')
    $relocFiles = @('.github/AGENT-ARCHITECTURE.md', '.github/WHEN-TO-USE.md', '.github/SKILLS.md', '.vscode/tasks.json')
    $rootOnlyFiles = @('.github/ISSUE_ORCHESTRATION.md', '.github/PULL_REQUEST_TEMPLATE.md')
    $custDepth = if ($custRoot) { @($custRoot.Replace('\', '/').Split('/') | Where-Object { $_ }).Count } else { 0 }
    $targets = New-Object System.Collections.Generic.List[object]
    $addTree = {
        param([string] $rel, [int] $depth)
        $dir = Join-Path $RepoRoot $rel
        if (-not (Test-Path -LiteralPath $dir)) { return }
        Get-ChildItem -LiteralPath $dir -Recurse -File | Where-Object { $layoutExt -contains $_.Extension.ToLowerInvariant() } |
            ForEach-Object { $targets.Add([pscustomobject]@{ Path = $_.FullName; Depth = $depth }) }
    }
    $pfx = if ($custRoot) { "$custRoot/" } else { '' }
    foreach ($t in $relocTrees) { & $addTree "$pfx$t" $custDepth }
    foreach ($t in $rootOnlyTrees) { & $addTree $t 0 }
    foreach ($f in $relocFiles) { $p = Join-Path $RepoRoot "$pfx$f"; if (Test-Path -LiteralPath $p -PathType Leaf) { $targets.Add([pscustomobject]@{ Path = $p; Depth = $custDepth }) } }
    foreach ($f in $rootOnlyFiles) { $p = Join-Path $RepoRoot $f; if (Test-Path -LiteralPath $p -PathType Leaf) { $targets.Add([pscustomobject]@{ Path = $p; Depth = 0 }) } }
    $enc = New-Object System.Text.UTF8Encoding($false)
    $relaid = 0
    foreach ($t in $targets) {
        $text = [System.IO.File]::ReadAllText($t.Path, $enc)
        $new = ConvertTo-BcAlmLayout $text $t.Depth
        if ($new -ne $text -and $PSCmdlet.ShouldProcess($t.Path, 'Point paths at .bc-alm/')) {
            [System.IO.File]::WriteAllText($t.Path, $new, $enc)
            $relaid++
        }
    }
    if ($relaid) { Write-Host "`nUpdated $relaid file(s) to reference .bc-alm/ (scripts, config, lock)." -ForegroundColor DarkGray }
}

Write-Host "`nTemplate initialized." -ForegroundColor Green
Write-Host "Next steps:" -ForegroundColor Cyan
if ($existingRepo) {
    Write-Host "  1. Review the diff (git status / git diff) - only template-owned files under '$custRoot' should change."
    Write-Host "  2. Resolve any '*.template' files the installer left next to your existing configs (merge, then delete)."
    Write-Host "  3. Your AL source, app.json, object IDs and README were intentionally left untouched."
    Write-Host "  4. Commit the localized customizations."
}
else {
    Write-Host "  1. Review the diff (git status / git diff)."
    Write-Host "  2. Generate fresh GUIDs for the 'id' in app/app.json AND test/app.json."
    Write-Host ("  3. BC version set from $(if ($stateDir) { "$stateDir/" })template.config.json bcVersion (application {0}, platform {1}, runtime {2}). Edit that block and re-run to retarget." -f $(if($bcApplication){$bcApplication}else{'unchanged'}), $(if($bcPlatform){$bcPlatform}else{'unchanged'}), $(if($bcRuntime){$bcRuntime}else{'unchanged'}))
    Write-Host "  4. Commit: the template is ready for your first feature."
}
