<#
.SYNOPSIS
    Publish changed documentation pages from docs/ to Wiki.js (optional, explicit request only).

.DESCRIPTION
    Scans markdown files under a docs root, treats the YAML front-matter as publishing metadata
    (wiki-path -> path, wiki-title -> title, wiki-tags -> tags) and uploads the body WITHOUT the
    front-matter block.

    Change tracking: a SHA256 hash over the publishable content (path, title, tags, description,
    body) is stored per page in a manifest file (docs/.wiki-sync.json). Only pages whose hash
    differs from the manifest - or that are missing from it - are published. The manifest is
    committed, so Git shows what was published and when.

    Pages without a `wiki-path` front-matter key are skipped: front-matter is the opt-in.

    Connection: the Wiki.js URL comes from -WikiUrl, else $env:WIKIJS_URL, else WIKIJS_URL in a
    git-ignored .env. The API key comes ONLY from $env:WIKIJS_API_KEY or .env - never from the
    command line. -WhatIf needs neither.

.PARAMETER DocsRoot
    Root folder to scan. Default: the docs/ folder next to .github, else <repo root>/docs.

.PARAMETER Filter
    Optional source path fragment to limit the run, e.g. 'modules/finance'.

.PARAMETER ManifestPath
    Sync manifest. Default: <DocsRoot>/.wiki-sync.json.

.PARAMETER Locale
    Wiki.js locale. Default: en.

.PARAMETER WikiUrl
    Wiki.js base URL, e.g. https://wiki.example.com. Default: WIKIJS_URL (environment or .env).

.PARAMETER RepoRoot
    Repository root. Default: `git rev-parse --show-toplevel`, else the folder containing .github.

.PARAMETER Force
    Republish every page regardless of the manifest.

.PARAMETER SkipManifestUpdate
    Publish but leave the manifest untouched (useful when testing against a scratch wiki).

.EXAMPLE
    ./Publish-Docs.ps1 -WhatIf
    Dry run: lists what would be created/updated. Needs no URL and no API key.

.EXAMPLE
    ./Publish-Docs.ps1 -Filter 'modules/finance'
    Publish only the finance area, changed pages only.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$DocsRoot,
    [string]$Filter,
    [string]$ManifestPath,
    [string]$Locale = 'en',
    [string]$WikiUrl,
    [string]$RepoRoot,
    [switch]$Force,
    [switch]$SkipManifestUpdate
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'DocsSync.Common.ps1')

$repo = Get-DocsRepoRoot -RepoRoot $RepoRoot
$DocsRoot = Get-DocsDefaultDocsRoot -DocsRoot $DocsRoot -RepoRoot $repo
if ($ManifestPath) { $ManifestPath = Resolve-DocsPath -Path $ManifestPath -RepoRoot $repo }
else { $ManifestPath = Join-Path $DocsRoot '.wiki-sync.json' }
$uploader = Join-Path $PSScriptRoot 'upload-page.ps1'

if (-not (Test-Path -LiteralPath $DocsRoot)) { throw "Docs root not found: $DocsRoot" }
if (-not (Test-Path -LiteralPath $uploader)) { throw "Uploader not found: $uploader" }

$scan = Get-PublishablePages -DocsRoot $DocsRoot -RepoRoot $repo -Locale $Locale
if (-not $scan.Pages) { Write-Host "No publishable pages found (no front-matter with 'wiki-path')." -ForegroundColor Yellow; return }

$manifest = Read-SyncManifest -Path $ManifestPath
$states = @(Get-PageSyncState -Pages $scan.Pages -Manifest $manifest -Filter $Filter -Force:$Force)

$toPublish = @($states | Where-Object { $_.Status -eq 'new' -or $_.Status -eq 'outdated' })
$unchanged = @($states | Where-Object { $_.Status -eq 'published' })
$orphans = @($states | Where-Object { $_.Status -eq 'orphaned' })

Write-Host ''
Write-Host 'Wiki.js publishing' -ForegroundColor Cyan
Write-Host "  Source     : $DocsRoot"
Write-Host "  Manifest   : $ManifestPath"
Write-Host "  Found      : $($scan.Pages.Count) page(s) with wiki-path"
if ($Filter) { Write-Host "  Filter     : $Filter -> $($toPublish.Count + $unchanged.Count) page(s)" }
Write-Host "  Unchanged  : $($unchanged.Count)"
Write-Host "  To publish : $($toPublish.Count)"
if ($scan.Skipped) { Write-Host "  No metadata: $($scan.Skipped.Count)" -ForegroundColor DarkGray }
Write-Host ''

foreach ($s in $toPublish) {
    $colour = 'Yellow'
    if ($s.Status -eq 'new') { $colour = 'Green' }
    Write-Host ('  [{0,-8}] {1}' -f $s.Status, $s.WikiPath) -ForegroundColor $colour
    Write-Host ('             <- {0}' -f $s.Source) -ForegroundColor DarkGray
}
foreach ($o in $orphans) {
    Write-Host "  [orphaned] $($o.WikiPath) - source file gone, review in Wiki.js" -ForegroundColor Magenta
}
foreach ($s in $scan.Skipped) { Write-Verbose "  skipped: $s" }

if (-not $toPublish) { Write-Host "`nNothing to do - Wiki.js is up to date." -ForegroundColor Green; return }

# --- Publish ---------------------------------------------------------------------------------

$published = @()
$failed = @()

foreach ($s in $toPublish) {
    if (-not $PSCmdlet.ShouldProcess($s.WikiPath, 'Wiki.js upsert')) { continue }
    $p = $s.Page
    try {
        $uploadArgs = @{
            Path        = $p.WikiPath
            Title       = $p.Title
            Content     = $p.Body
            Description = $p.Description
            Tags        = @($p.Tags)
            Locale      = $Locale
            Editor      = 'markdown'
        }
        if ($WikiUrl) { $uploadArgs['WikiUrl'] = $WikiUrl }
        & $uploader @uploadArgs | Out-Null
        $published += $s
    }
    catch {
        Write-Host "  ERROR for $($p.WikiPath): $($_.Exception.Message)" -ForegroundColor Red
        $failed += $s
    }
}

# --- Update the manifest ---------------------------------------------------------------------
# Only successful uploads are recorded, so a failed page is retried on the next run.

if ($published -and -not $SkipManifestUpdate -and $PSCmdlet.ShouldProcess($ManifestPath, 'Update manifest')) {
    $now = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ssK')
    foreach ($s in $published) {
        $manifest[$s.WikiPath] = [pscustomobject]@{
            wikiPath    = $s.Page.WikiPath
            source      = $s.Page.Source
            title       = $s.Page.Title
            status      = 'published'
            hash        = $s.Page.Hash
            publishedAt = $now
            checkedAt   = $now
        }
    }
    Write-SyncManifest -Path $ManifestPath -Manifest $manifest -Locale $Locale
    Write-Host "`nManifest updated: $($published.Count) entr(y/ies)" -ForegroundColor Green
}

$summaryColour = 'Green'
if ($failed) { $summaryColour = 'Red' }
Write-Host ''
Write-Host "Published: $($published.Count) | Failed: $($failed.Count)" -ForegroundColor $summaryColour

if ($failed) { exit 1 }
exit 0
