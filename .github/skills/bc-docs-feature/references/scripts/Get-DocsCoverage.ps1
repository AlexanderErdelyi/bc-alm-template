<#
.SYNOPSIS
    Show which AL objects are documented, which are not, and which of the undocumented ones changed.

.DESCRIPTION
    Combines three sources, all read at run time:
      1. every AL object in the repository   (Get-ALObjects)
      2. every metadata.json under docs/     (what documentation already covers)
      3. optionally git                      (what changed since a given commit or branch)

    Nothing is cached by default and no coverage file is written. Coverage is derived state: the
    moment someone adds an object or writes a page it would be wrong. Only two things are
    persisted, because they cannot be derived:
      - which objects a documentation folder covers -> metadata.json (per doc folder)
      - which objects deliberately need no documentation -> .github/docs-coverage-policy.json
        (project override; the skill ships a default in references/docs-coverage-policy.json)

    The module of an object is "<app folder>/<first folder below src>", e.g. "app/Codeunits".

.PARAMETER SourcePath
    AL source folder(s) to scan. Default: every app.json folder in the repository.

.PARAMETER DocsRoot
    Documentation root. Default: the docs/ folder next to .github, else <repo root>/docs.

.PARAMETER PolicyFile
    Coverage policy. Default: docs-coverage-policy.json in the .github folder holding this skill
    (project override), else the default shipped in the skill's references folder.

.PARAMETER RepoRoot
    Repository root. Default: `git rev-parse --show-toplevel`, else the folder containing .github.

.PARAMETER IndexFile
    Reuse an index previously written by Get-ALObjectIndex.ps1 -OutFile instead of rescanning.
    Faster, but only as current as that file.

.PARAMETER Module
    Limit to one module, e.g. 'app/Setup', 'Setup' or 'app'.

.PARAMETER Type
    Limit to one object type, e.g. report.

.PARAMETER ChangedSince
    Git commit, tag or branch. Only objects whose files changed between it and HEAD are considered -
    the "what did we touch recently and never documented" view.

.PARAMETER Undocumented
    List the undocumented objects instead of the per-module summary.

.PARAMETER IncludeExcluded
    List the objects excluded by policy, with the reason.

.PARAMETER OutFile
    Write a machine-readable JSON report to this path.

.EXAMPLE
    ./Get-DocsCoverage.ps1

.EXAMPLE
    ./Get-DocsCoverage.ps1 -Undocumented -Module app -Type codeunit

.EXAMPLE
    ./Get-DocsCoverage.ps1 -Undocumented -ChangedSince main
    Objects changed against main that no documentation covers.
#>
[CmdletBinding()]
param(
    [Alias('SourceRoot')][string[]]$SourcePath,
    [string]$DocsRoot,
    [string]$PolicyFile,
    [string]$RepoRoot,
    [string]$IndexFile,
    [string]$Module,
    [string]$Type,
    [string]$ChangedSince,
    [switch]$Undocumented,
    [switch]$IncludeExcluded,
    [string]$OutFile
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'ALObjects.Common.ps1')

$repo = Get-DocsRepoRoot -RepoRoot $RepoRoot
$docs = Get-DocsDefaultDocsRoot -DocsRoot $DocsRoot -RepoRoot $repo
if ($PolicyFile) { $PolicyFile = Resolve-DocsPath -Path $PolicyFile -RepoRoot $repo }
else {
    $PolicyFile = Join-Path (Get-DocsGithubDir) 'docs-coverage-policy.json'
    if (-not (Test-Path -LiteralPath $PolicyFile)) { $PolicyFile = Join-Path (Split-Path $PSScriptRoot -Parent) 'docs-coverage-policy.json' }
}

# --- 1. All objects --------------------------------------------------------------------------

if ($IndexFile) {
    $IndexFile = Resolve-DocsPath -Path $IndexFile -RepoRoot $repo
    if (-not (Test-Path -LiteralPath $IndexFile)) { throw "Index file not found: $IndexFile" }
    $index = Get-Content -LiteralPath $IndexFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $all = @($index.objects)
    Write-Host "Index from file ($($index.generated)) - may be out of date." -ForegroundColor DarkGray
}
else {
    $roots = @(Get-DocsSourceRoots -SourcePath $SourcePath -RepoRoot $repo)
    Write-Host 'Scanning AL objects ...' -ForegroundColor DarkGray
    $all = @(Get-ALObjects -SourceRoots $roots -RepoRoot $repo)
}

# --- 2. What documentation covers --------------------------------------------------------------

$documented = @{}
$docOf = @{}
$metaFiles = @()
if (Test-Path -LiteralPath $docs) { $metaFiles = @(Get-ChildItem -LiteralPath $docs -Recurse -File -Filter metadata.json -ErrorAction SilentlyContinue) }
foreach ($meta in $metaFiles) {
    $m = Get-Content -LiteralPath $meta.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
    $folder = Get-DocsRelativePath -Path $meta.DirectoryName -Root $repo

    foreach ($entry in @($m.objects)) {
        $keys = @()
        if ($entry.resolved) { $keys += '{0}|{1}' -f $entry.type, $entry.name }
        # An extension is covered when its base object is documented.
        foreach ($x in @($entry.extensions)) { $keys += '{0}|{1}' -f $x.type, $x.name }
        foreach ($key in $keys) {
            $documented[$key] = $true
            if (-not $docOf.ContainsKey($key)) { $docOf[$key] = @() }
            $docOf[$key] += $folder
        }
    }
}

# --- 3. Policy -------------------------------------------------------------------------------

$rules = @()
if (Test-Path -LiteralPath $PolicyFile) {
    $policy = Get-Content -LiteralPath $PolicyFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $rules = @(Get-DocsProperty -Object $policy -Name 'exclude' -Default @())
}

function Test-Excluded {
    param($Object)
    foreach ($rule in $rules) {
        $ruleType = Get-DocsProperty -Object $rule -Name 'type'
        $ruleName = Get-DocsProperty -Object $rule -Name 'namePattern'
        $ruleFile = Get-DocsProperty -Object $rule -Name 'filePattern'
        if (-not $ruleType -and -not $ruleName -and -not $ruleFile) { continue }
        $ok = $true
        if ($ruleType) { $ok = $ok -and ($Object.Type -eq $ruleType) }
        if ($ruleName) { $ok = $ok -and ($Object.Name -like $ruleName) }
        if ($ruleFile) { $ok = $ok -and ($Object.File -like $ruleFile) }
        if ($ok) {
            $reason = Get-DocsProperty -Object $rule -Name 'reason'
            if (-not $reason) { $reason = 'excluded by policy' }
            return $reason
        }
    }
    return $null
}

# --- 4. Changed files ---------------------------------------------------------------------------

$changedFiles = $null
if ($ChangedSince) {
    $top = (& git -C $repo rev-parse --show-toplevel 2>$null)
    $raw = & git -C $repo diff --name-only "$ChangedSince..HEAD" 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $top) { throw "git diff against '$ChangedSince' failed. Does the reference exist?" }
    $top = ($top | Select-Object -First 1).Trim()
    $changedFiles = @{}
    foreach ($f in @($raw)) {
        if (-not $f) { continue }
        # git returns paths relative to its top level; objects store paths relative to $repo.
        $changedFiles[(Get-DocsRelativePath -Path (Join-Path $top $f) -Root $repo)] = $true
    }
}

# --- 5. Classify ---------------------------------------------------------------------------------

$rows = @(foreach ($o in $all) {
        $key = '{0}|{1}' -f $o.Type, $o.Name
        $reason = Test-Excluded -Object $o
        $isDoc = $documented.ContainsKey($key)

        $changed = $null
        if ($null -ne $changedFiles) { $changed = [bool](@($o.Files | Where-Object { $changedFiles.ContainsKey($_) }).Count) }

        $status = 'open'
        if ($isDoc) { $status = 'documented' } elseif ($reason) { $status = 'excluded' }
        $docFolder = $null
        if ($isDoc) { $docFolder = ($docOf[$key] | Sort-Object -Unique) -join ', ' }

        $mod = Get-DocsProperty -Object $o -Name 'Module'
        if (-not $mod) { $mod = ($o.File -split '/')[0] }

        [pscustomobject]@{
            Module    = $mod
            Type      = $o.Type
            Id        = $o.Id
            Name      = $o.Name
            File      = $o.File
            Status    = $status
            Reason    = $reason
            DocFolder = $docFolder
            Changed   = $changed
        }
    })

if ($Module) { $rows = @($rows | Where-Object { $_.Module -eq $Module -or $_.Module -like "*/$Module" -or $_.Module -like "$Module/*" }) }
if ($Type) { $rows = @($rows | Where-Object { $_.Type -eq $Type.ToLowerInvariant() }) }
if ($null -ne $changedFiles) { $rows = @($rows | Where-Object { $_.Changed }) }

$open = @($rows | Where-Object { $_.Status -eq 'open' })
$done = @($rows | Where-Object { $_.Status -eq 'documented' })
$skip = @($rows | Where-Object { $_.Status -eq 'excluded' })

# --- 6. Report -----------------------------------------------------------------------------------

Write-Host ''
Write-Host 'Documentation coverage' -ForegroundColor Cyan
if ($ChangedSince) { Write-Host "  Only objects changed since: $ChangedSince" -ForegroundColor Yellow }
if ($Module) { Write-Host "  Module: $Module" }
if ($Type) { Write-Host "  Type  : $Type" }
if (-not (Test-Path -LiteralPath $PolicyFile)) { Write-Host "  Policy: not found ($PolicyFile)" -ForegroundColor DarkGray }
Write-Host ('  {0,-14} {1,5}' -f 'documented', $done.Count) -ForegroundColor Green
Write-Host ('  {0,-14} {1,5}' -f 'open', $open.Count) -ForegroundColor Yellow
Write-Host ('  {0,-14} {1,5}   (by policy)' -f 'excluded', $skip.Count) -ForegroundColor DarkGray
$relevant = $done.Count + $open.Count
if ($relevant -gt 0) {
    Write-Host ('  {0,-14} {1,4} %' -f 'coverage', [math]::Round(100 * $done.Count / $relevant)) -ForegroundColor Cyan
}
Write-Host ''

if ($Undocumented) {
    if (-not $open) { Write-Host 'Nothing open.' -ForegroundColor Green }
    else {
        # Out-Host: keep format objects out of the pipeline so callers can pipe this script safely.
        $open | Sort-Object Module, Type, Id | Format-Table Module, Type, Id, Name, File -AutoSize | Out-Host
    }
}
elseif ($IncludeExcluded) {
    $skip | Sort-Object Module, Type, Id | Format-Table Module, Type, Id, Name, Reason -AutoSize | Out-Host
}
else {
    $rows | Group-Object Module | Sort-Object Name | ForEach-Object {
        [pscustomobject]@{
            Module     = $_.Name
            Documented = @($_.Group | Where-Object { $_.Status -eq 'documented' }).Count
            Open       = @($_.Group | Where-Object { $_.Status -eq 'open' }).Count
            Excluded   = @($_.Group | Where-Object { $_.Status -eq 'excluded' }).Count
        }
    } | Format-Table -AutoSize | Out-Host

    Write-Host 'List open objects     : -Undocumented [-Module <name>] [-Type <type>]' -ForegroundColor DarkGray
    Write-Host 'Recently changed only : -Undocumented -ChangedSince main' -ForegroundColor DarkGray
}

if ($OutFile) {
    $json = [pscustomobject]@{
        schema       = 1
        generated    = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ssK')
        gitCommit    = Get-DocsGitCommit -RepoRoot $repo
        changedSince = $ChangedSince
        summary      = [pscustomobject]@{ documented = $done.Count; open = $open.Count; excluded = $skip.Count }
        objects      = @($rows | Sort-Object Module, Type, Id)
    } | ConvertTo-Json -Depth 6
    Write-DocsUtf8File -Path (Resolve-DocsPath -Path $OutFile -RepoRoot (Get-Location).Path) -Text $json
    Write-Host "Report written: $OutFile" -ForegroundColor Green
}
