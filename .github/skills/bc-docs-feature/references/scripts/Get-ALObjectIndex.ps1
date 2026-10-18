<#
.SYNOPSIS
    Inventory every AL object in the repository with a content hash.

.DESCRIPTION
    Scans the AL sources and reports each object with its type, ID, name, what it extends, its
    module and a SHA256 over its source. For reports the hash also covers the referenced
    RDLC/Word/Excel layout, because a layout change alters the printed document without touching
    the .al file.

    Use it to answer "what does this app contain" and as the raw material for documentation drift
    detection (see Test-DocsObjectDrift.ps1) and coverage (see Get-DocsCoverage.ps1).

    By default every folder below the repository root that contains an app.json is scanned
    (production app and test app alike). Use -SourcePath to narrow it down.

.PARAMETER SourcePath
    One or more folders to scan, e.g. app/src. Relative paths resolve against the current
    directory, then the repository root. Default: every app.json folder in the repository.

.PARAMETER RepoRoot
    Repository root. Default: `git rev-parse --show-toplevel`, else the folder containing .github.

.PARAMETER Filter
    Optional path or name fragment, e.g. 'Setup' or 'Payment'.

.PARAMETER Type
    Optional object type, e.g. report, tableextension.

.PARAMETER ExtensionsOf
    Show only objects extending the given base object, e.g. -ExtensionsOf Customer.

.PARAMETER OutFile
    Write the full index as JSON to this path (reusable via Get-DocsCoverage.ps1 -IndexFile).

.PARAMETER Summary
    Print object counts per type instead of the object list.

.EXAMPLE
    ./Get-ALObjectIndex.ps1 -Summary

.EXAMPLE
    ./Get-ALObjectIndex.ps1 -Type codeunit -Filter Payment

.EXAMPLE
    ./Get-ALObjectIndex.ps1 -ExtensionsOf Customer
    Every extension the app layers on the base Customer table.

.EXAMPLE
    ./Get-ALObjectIndex.ps1 -SourcePath app/src -OutFile al-index.json
#>
[CmdletBinding()]
param(
    [Alias('SourceRoot')][string[]]$SourcePath,
    [string]$RepoRoot,
    [string]$Filter,
    [string]$Type,
    [string]$ExtensionsOf,
    [string]$OutFile,
    [switch]$Summary
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'ALObjects.Common.ps1')

$repo = Get-DocsRepoRoot -RepoRoot $RepoRoot
$roots = @(Get-DocsSourceRoots -SourcePath $SourcePath -RepoRoot $repo)

$all = @(Get-ALObjects -SourceRoots $roots -RepoRoot $repo)
$view = $all

if ($Type) { $view = @($view | Where-Object { $_.Type -eq $Type.ToLowerInvariant() }) }
if ($ExtensionsOf) { $view = @($view | Where-Object { $_.Extends -eq $ExtensionsOf }) }
if ($Filter) { $view = @($view | Where-Object { $_.Name -like "*$Filter*" -or $_.File -like "*$Filter*" }) }

if ($Summary) {
    Write-Host ''
    Write-Host 'AL object inventory' -ForegroundColor Cyan
    Write-Host "  Repository: $repo"
    foreach ($r in $roots) { Write-Host "  Source    : $(Get-DocsRelativePath -Path $r.SourceRoot -Root $repo)" }
    Write-Host "  Objects   : $($all.Count)"
    Write-Host ''
    $all | Group-Object Type | Sort-Object Count -Descending |
        Format-Table @{ N = 'Count'; E = { $_.Count } }, @{ N = 'Type'; E = { $_.Name } } -AutoSize | Out-Host
    $withLayout = @($all | Where-Object { $_.Files.Count -gt 1 })
    Write-Host "  Objects with an additional layout file: $($withLayout.Count)"
    Write-Host ''
}

if ($OutFile) {
    $json = [pscustomobject]@{
        schema    = 1
        generated = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ssK')
        gitCommit = Get-DocsGitCommit -RepoRoot $repo
        objects   = @($all | Sort-Object Type, Id, Name)
    } | ConvertTo-Json -Depth 6
    Write-DocsUtf8File -Path (Resolve-DocsPath -Path $OutFile -RepoRoot (Get-Location).Path) -Text $json
    Write-Host "Index written: $OutFile ($($all.Count) objects)" -ForegroundColor Green
}

if (-not $Summary -and -not $OutFile) {
    $view | Sort-Object Type, Id | Select-Object Type, Id, Name, Extends, Module, File
}
