<#
.SYNOPSIS
    Report which documentation pages are out of sync with Wiki.js - without publishing anything.

.DESCRIPTION
    Cross-check before publishing: scans the docs root, recomputes the content hash of every
    publishable page (front-matter with `wiki-path`) and compares it against the sync manifest
    (docs/.wiki-sync.json). Nothing is sent to Wiki.js; no URL or API key is needed.

    Status per page:
      new       - never published
      outdated  - published before, content has changed since
      published - manifest hash matches the current content
      orphaned  - in the manifest but the source file is gone (never auto-deleted in Wiki.js)

    Exit code 0 = everything is in sync (or nothing is publishable), 1 = there is something to
    publish. That makes the script usable as a CI gate or a pull-request check.

    The console report is the authoritative answer, because it is computed right now. The `status`
    field written into the manifest by -UpdateManifest is only a snapshot of the last run - which
    is why every entry also carries `checkedAt`.

.PARAMETER DocsRoot
    Documentation root. Default: the docs/ folder next to .github, else <repo root>/docs.

.PARAMETER Filter
    Only consider pages whose repo-relative source path contains this text, e.g. 'modules/sales'.

.PARAMETER ManifestPath
    Sync manifest. Default: <DocsRoot>/.wiki-sync.json.

.PARAMETER Locale
    Wiki.js locale used for link rewriting. Default: en.

.PARAMETER RepoRoot
    Repository root. Default: `git rev-parse --show-toplevel`, else the folder containing .github.

.PARAMETER UpdateManifest
    Write the current status and a checkedAt timestamp into the manifest. Off by default: a check
    should not change tracked files unless asked.

.PARAMETER Quiet
    No console report; only the exit code.

.EXAMPLE
    ./Get-DocsSyncStatus.ps1
    Show what would be published.

.EXAMPLE
    ./Get-DocsSyncStatus.ps1 -Filter 'modules/finance' -UpdateManifest
    Check the finance area and persist the status snapshot.

.EXAMPLE
    ./Get-DocsSyncStatus.ps1 -Quiet; if ($LASTEXITCODE -ne 0) { ./Publish-Docs.ps1 }
    Check first, publish only when needed.
#>
[CmdletBinding()]
param(
    [string]$DocsRoot,
    [string]$Filter,
    [string]$ManifestPath,
    [string]$Locale = 'en',
    [string]$RepoRoot,
    [switch]$UpdateManifest,
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'DocsSync.Common.ps1')

$repo = Get-DocsRepoRoot -RepoRoot $RepoRoot
$DocsRoot = Get-DocsDefaultDocsRoot -DocsRoot $DocsRoot -RepoRoot $repo
if ($ManifestPath) { $ManifestPath = Resolve-DocsPath -Path $ManifestPath -RepoRoot $repo }
else { $ManifestPath = Join-Path $DocsRoot '.wiki-sync.json' }

if (-not (Test-Path -LiteralPath $DocsRoot)) {
    if (-not $Quiet) { Write-Host "Docs root not found: $DocsRoot - nothing to publish." -ForegroundColor Yellow }
    exit 0
}

$scan = Get-PublishablePages -DocsRoot $DocsRoot -RepoRoot $repo -Locale $Locale
if (-not $scan.Pages) {
    if (-not $Quiet) { Write-Host "No publishable pages found (no front-matter with 'wiki-path') under $DocsRoot." -ForegroundColor Yellow }
    exit 0
}

$manifest = Read-SyncManifest -Path $ManifestPath
$states = @(Get-PageSyncState -Pages $scan.Pages -Manifest $manifest -Filter $Filter)

$new = @($states | Where-Object { $_.Status -eq 'new' })
$outdated = @($states | Where-Object { $_.Status -eq 'outdated' })
$published = @($states | Where-Object { $_.Status -eq 'published' })
$orphaned = @($states | Where-Object { $_.Status -eq 'orphaned' })
$pending = $new.Count + $outdated.Count

if (-not $Quiet) {
    $manifestAge = 'not created yet'
    if (Test-Path -LiteralPath $ManifestPath) {
        $manifestAge = Get-DocsProperty -Object (Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json) -Name 'updated' -Default 'unknown'
    }

    Write-Host ''
    Write-Host 'Wiki.js sync status (check only, nothing is sent)' -ForegroundColor Cyan
    Write-Host "  Source         : $DocsRoot"
    Write-Host "  Manifest       : $ManifestPath"
    Write-Host "  Last published : $manifestAge"
    if ($Filter) { Write-Host "  Filter         : $Filter" }
    Write-Host ''
    Write-Host ('  {0,-10} {1,5}   {2}' -f 'Status', 'Count', 'Meaning')
    Write-Host ('  {0,-10} {1,5}   {2}' -f 'new', $new.Count, 'never published') -ForegroundColor Green
    Write-Host ('  {0,-10} {1,5}   {2}' -f 'outdated', $outdated.Count, 'changed in the repo, wiki is stale') -ForegroundColor Yellow
    Write-Host ('  {0,-10} {1,5}   {2}' -f 'published', $published.Count, 'up to date') -ForegroundColor DarkGray
    Write-Host ('  {0,-10} {1,5}   {2}' -f 'orphaned', $orphaned.Count, 'source file gone, review the wiki page') -ForegroundColor Magenta
    if ($scan.Skipped) { Write-Host ('  {0,-10} {1,5}   {2}' -f 'skipped', $scan.Skipped.Count, 'no wiki-path in front-matter') -ForegroundColor DarkGray }
    Write-Host ''

    foreach ($s in @($new + $outdated | Sort-Object Status, WikiPath)) {
        $colour = 'Yellow'
        if ($s.Status -eq 'new') { $colour = 'Green' }
        Write-Host ('  [{0,-8}] {1}' -f $s.Status, $s.WikiPath) -ForegroundColor $colour
        Write-Host ('             <- {0}' -f $s.Source) -ForegroundColor DarkGray
    }
    foreach ($s in $orphaned) {
        Write-Host ('  [orphaned] {0}' -f $s.WikiPath) -ForegroundColor Magenta
        Write-Host ('             source was: {0}' -f $s.Source) -ForegroundColor DarkGray
    }
    foreach ($s in $scan.Skipped) { Write-Verbose "  skipped: $s" }

    Write-Host ''
    if ($pending -eq 0) {
        Write-Host 'Wiki.js is up to date - nothing to publish.' -ForegroundColor Green
    }
    else {
        Write-Host "$pending page(s) to publish. Next step (explicit request only):" -ForegroundColor Yellow
        $cmd = '  ./Publish-Docs.ps1'
        if ($Filter) { $cmd += " -Filter '$Filter'" }
        Write-Host $cmd -ForegroundColor White
    }
}

if ($UpdateManifest) {
    $now = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ssK')
    foreach ($s in $states) {
        if ($s.Status -eq 'new') {
            # Not published yet: record it so the overview is complete, but without a hash -
            # a hash here would later be mistaken for "already published".
            $manifest[$s.WikiPath] = [pscustomobject]@{
                wikiPath    = $s.WikiPath
                source      = $s.Source
                title       = $s.Title
                status      = 'new'
                hash        = $null
                publishedAt = $null
                checkedAt   = $now
            }
            continue
        }
        $entry = $null
        if ($manifest.ContainsKey($s.WikiPath)) { $entry = $manifest[$s.WikiPath] }
        $manifest[$s.WikiPath] = [pscustomobject]@{
            wikiPath    = $s.WikiPath
            source      = $s.Source
            title       = $s.Title
            status      = $s.Status
            hash        = (Get-DocsProperty -Object $entry -Name 'hash')   # stays the hash of what is live in Wiki.js
            publishedAt = $s.PublishedAt
            checkedAt   = $now
        }
    }
    Write-SyncManifest -Path $ManifestPath -Manifest $manifest -Locale $Locale
    if (-not $Quiet) { Write-Host "`nManifest status updated ($now)." -ForegroundColor Cyan }
}

if ($pending -gt 0) { exit 1 }
exit 0
