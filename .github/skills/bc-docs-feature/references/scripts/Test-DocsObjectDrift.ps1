<#
.SYNOPSIS
    Find documentation that has fallen behind the code it describes.

.DESCRIPTION
    Reads every metadata.json under the docs root, recomputes the hash of each referenced AL
    object - and of every extension layered on it - and compares it against what was recorded when
    the documentation was last confirmed correct.

    Answers the question "somebody changed an object - is there documentation about it that nobody
    updated?" It cannot say *what* changed inside the object; for that it prints the exact git
    command to diff against the commit recorded in the metadata.

    Exit code 0 = no drift (or no metadata.json yet), 1 = at least one documented object changed.
    Usable as a pull-request check.

.PARAMETER DocsRoot
    Documentation root to search for metadata.json. Default: the docs/ folder next to .github,
    else <repo root>/docs.

.PARAMETER SourcePath
    AL source folder(s) to scan. Default: every app.json folder in the repository.

.PARAMETER RepoRoot
    Repository root. Default: `git rev-parse --show-toplevel`, else the folder containing .github.

.PARAMETER Filter
    Optional folder fragment, e.g. 'sales'.

.PARAMETER Detailed
    Also list the documentation folders that are up to date.

.PARAMETER Quiet
    No output, exit code only.

.EXAMPLE
    ./Test-DocsObjectDrift.ps1

.EXAMPLE
    ./Test-DocsObjectDrift.ps1 -Filter sales -Detailed
#>
[CmdletBinding()]
param(
    [string]$DocsRoot,
    [Alias('SourceRoot')][string[]]$SourcePath,
    [string]$RepoRoot,
    [string]$Filter,
    [switch]$Detailed,
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'ALObjects.Common.ps1')

$repo = Get-DocsRepoRoot -RepoRoot $RepoRoot
$docs = Get-DocsDefaultDocsRoot -DocsRoot $DocsRoot -RepoRoot $repo

$metadataFiles = @()
if (Test-Path -LiteralPath $docs) {
    $metadataFiles = @(Get-ChildItem -LiteralPath $docs -Recurse -File -Filter metadata.json)
}
if ($Filter) { $metadataFiles = @($metadataFiles | Where-Object { $_.FullName -like "*$Filter*" }) }

if (-not $metadataFiles) {
    if (-not $Quiet) {
        Write-Host "No metadata.json found under $docs - no documentation is tracked yet." -ForegroundColor Yellow
        Write-Host 'Record documented objects with Update-DocsObjectMetadata.ps1.' -ForegroundColor DarkGray
    }
    exit 0
}

$roots = @(Get-DocsSourceRoots -SourcePath $SourcePath -RepoRoot $repo)
if (-not $Quiet) { Write-Host 'Scanning AL objects ...' -ForegroundColor DarkGray }
$all = @(Get-ALObjects -SourceRoots $roots -RepoRoot $repo)

$driftDocs = @()
$cleanDocs = @()

foreach ($file in $metadataFiles) {
    $meta = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
    $changes = @()

    foreach ($entry in @($meta.objects)) {
        $current = Resolve-ALObjectReference -Reference $entry.ref -Objects $all
        $label = '{0} {1} {2}' -f $entry.type, $entry.id, $entry.name

        if ($entry.resolved -and -not $current.Resolved) {
            $changes += [pscustomobject]@{ Kind = 'removed'; What = $label; Files = @() }
        }
        elseif ($entry.resolved -and $current.Hash -ne $entry.hash) {
            $changes += [pscustomobject]@{ Kind = 'changed'; What = $label; Files = @($current.Files) }
        }

        # Extensions: compare per extension so the report can name the exact one.
        $recordedExt = @{}
        foreach ($x in @($entry.extensions)) { $recordedExt[('{0} {1}' -f $x.type, $x.name)] = $x }
        $currentExt = @{}
        foreach ($x in @($current.Extensions)) { $currentExt[('{0} {1}' -f $x.type, $x.name)] = $x }

        foreach ($key in @($currentExt.Keys)) {
            if (-not $recordedExt.ContainsKey($key)) {
                $changes += [pscustomobject]@{ Kind = 'new extension'; What = "$key (on $($entry.name))"; Files = @($currentExt[$key].file) }
            }
            elseif ($recordedExt[$key].hash -ne $currentExt[$key].hash) {
                $changes += [pscustomobject]@{ Kind = 'changed'; What = "$key (on $($entry.name))"; Files = @($currentExt[$key].file) }
            }
        }
        foreach ($key in @($recordedExt.Keys)) {
            if (-not $currentExt.ContainsKey($key)) {
                $changes += [pscustomobject]@{ Kind = 'removed'; What = "$key (on $($entry.name))"; Files = @() }
            }
        }
    }

    $rel = Get-DocsRelativePath -Path $file.DirectoryName -Root $repo
    if ($changes) { $driftDocs += [pscustomobject]@{ Folder = $rel; Meta = $meta; Changes = $changes } }
    else { $cleanDocs += $rel }
}

if (-not $Quiet) {
    Write-Host ''
    Write-Host 'Documentation drift' -ForegroundColor Cyan
    Write-Host "  Checked   : $($metadataFiles.Count) documentation folder(s)"
    Write-Host "  Up to date: $($cleanDocs.Count)"
    Write-Host "  Outdated  : $($driftDocs.Count)"
    Write-Host ''

    foreach ($d in $driftDocs) {
        Write-Host "  [outdated] $($d.Folder)" -ForegroundColor Yellow
        $confirmed = $d.Meta.recordedAt
        # PowerShell 7 turns ISO date strings into DateTime when parsing JSON; 5.1 keeps the string.
        if ($confirmed -is [datetime]) { $confirmed = $confirmed.ToString('yyyy-MM-ddTHH:mm:ssK') }
        Write-Host "             last confirmed: $confirmed" -ForegroundColor DarkGray
        foreach ($c in $d.Changes) { Write-Host ('             - {0}: {1}' -f $c.Kind, $c.What) }
        $commit = Get-DocsProperty -Object $d.Meta -Name 'gitCommit'
        if ($commit) {
            $files = @($d.Changes | ForEach-Object { $_.Files } | Where-Object { $_ } | Sort-Object -Unique)
            if ($files) {
                Write-Host '             What exactly changed:' -ForegroundColor DarkGray
                Write-Host ('             git diff {0} -- {1}' -f $commit, ($files -join ' ')) -ForegroundColor White
            }
        }
        Write-Host ''
    }

    if ($Detailed -and $cleanDocs) {
        Write-Host '  Up-to-date folders:' -ForegroundColor DarkGray
        foreach ($c in $cleanDocs) { Write-Host "    $c" -ForegroundColor DarkGray }
        Write-Host ''
    }

    if ($driftDocs) {
        Write-Host 'Next step: review and correct the documentation, then run' -ForegroundColor Yellow
        Write-Host '  ./Update-DocsObjectMetadata.ps1 -DocFolder <folder>' -ForegroundColor White
        Write-Host 'to mark it as confirmed again.' -ForegroundColor Yellow
    }
    else {
        Write-Host 'No drift - the documentation matches the code.' -ForegroundColor Green
    }
}

if ($driftDocs) { exit 1 }
exit 0
