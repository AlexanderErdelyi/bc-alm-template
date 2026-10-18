<#
.SYNOPSIS
    Shared logic for the optional Wiki.js documentation sync (scan, hash, manifest).

.DESCRIPTION
    Dot-sourced by Publish-Docs.ps1 and Get-DocsSyncStatus.ps1 so both derive the publishable
    content and its hash in exactly the same way. If the two ever computed the hash differently,
    change detection would silently break - hence one implementation, not two.

    Not meant to be run directly.
#>

Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'DocsRepo.Common.ps1')

# --- Front-matter ----------------------------------------------------------------------------

function Read-FrontMatter {
    param([AllowEmptyString()][string]$Raw)

    if (-not $Raw) { return $null }
    $m = [regex]::Match($Raw, '^\uFEFF?---\r?\n(?<fm>.*?)\r?\n---\r?\n?(?<body>.*)$',
        [System.Text.RegularExpressions.RegexOptions]::Singleline)
    if (-not $m.Success) { return $null }

    $meta = @{}
    foreach ($line in $m.Groups['fm'].Value -split "\r?\n") {
        $kv = [regex]::Match($line, '^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)$')
        if (-not $kv.Success) { continue }
        $key = $kv.Groups[1].Value
        $val = $kv.Groups[2].Value.Trim()
        # Strip a trailing YAML comment ("value   # note") when the value is not quoted.
        if ($val -notmatch '^["'']') { $val = ($val -replace '\s+#.*$', '').Trim() }

        if ($val -match '^\[(.*)\]$') {
            $meta[$key] = @($Matches[1] -split ',' |
                ForEach-Object { $_.Trim().Trim('"', "'") } |
                Where-Object { $_ })
        }
        else {
            $meta[$key] = $val.Trim('"', "'")
        }
    }

    [pscustomobject]@{ Meta = $meta; Body = $m.Groups['body'].Value.TrimStart() }
}

# First real prose line - skips nav bars, headings, rules, tables, quotes and italic footers.
function Get-Description {
    param([AllowEmptyString()][string]$Body, [string]$Fallback)

    foreach ($line in $Body -split "\r?\n") {
        $t = $line.Trim()
        if (-not $t) { continue }
        if ($t.StartsWith('#') -or $t.StartsWith('**') -or $t.StartsWith('|') -or
            $t.StartsWith('---') -or $t.StartsWith('>') -or $t.StartsWith('```') -or
            $t -match '^\*[^*].*\*$') { continue }
        $clean = ($t -replace '\[([^\]]+)\]\([^)]+\)', '$1') -replace '[*`_]', ''
        if ($clean.Length -gt 250) { $clean = $clean.Substring(0, 247) + '...' }
        return $clean
    }
    return $Fallback
}

function Get-ContentHash {
    param([AllowEmptyString()][string]$Payload)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Payload)
        return -join ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') })
    }
    finally { $sha.Dispose() }
}

# --- Scan ------------------------------------------------------------------------------------

<#
.SYNOPSIS
    Return every publishable page with its rewritten body and content hash.

.DESCRIPTION
    Always scans the complete docs root, even when the caller only wants a subset: the
    source-to-wiki-path map must be complete or relative links would not be rewritten correctly.
#>
function Get-PublishablePages {
    param(
        [Parameter(Mandatory)][string]$DocsRoot,
        [Parameter(Mandatory)][string]$RepoRoot,
        [string]$Locale = 'en'
    )

    $pages = @()
    $skipped = @()

    foreach ($file in @(Get-ChildItem -LiteralPath $DocsRoot -Filter *.md -Recurse -File)) {
        $relative = Get-DocsRelativePath -Path $file.FullName -Root $RepoRoot
        $parsed = Read-FrontMatter -Raw (Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8)

        if (-not $parsed) { $skipped += "$relative (no front-matter)"; continue }
        if (-not $parsed.Meta.ContainsKey('wiki-path') -or -not $parsed.Meta['wiki-path']) { $skipped += "$relative (no wiki-path)"; continue }

        $wikiPath = ([string]$parsed.Meta['wiki-path']).Trim('/')
        $title = $file.BaseName
        if ($parsed.Meta.ContainsKey('wiki-title') -and $parsed.Meta['wiki-title']) { $title = [string]$parsed.Meta['wiki-title'] }
        $tags = @()
        if ($parsed.Meta.ContainsKey('wiki-tags')) { $tags = @($parsed.Meta['wiki-tags']) }
        $description = $null
        if ($parsed.Meta.ContainsKey('description') -and $parsed.Meta['description']) { $description = [string]$parsed.Meta['description'] }
        else { $description = Get-Description -Body $parsed.Body -Fallback $title }
        $isIndex = ($parsed.Meta.ContainsKey('page-type') -and $parsed.Meta['page-type'] -eq 'index')

        $pages += [pscustomobject]@{
            Source      = $relative
            SourceDir   = $file.DirectoryName
            WikiPath    = $wikiPath
            Title       = $title
            Tags        = $tags
            Description = $description
            Body        = ($parsed.Body -replace "`r`n", "`n")   # LF-normalised: no phantom changes on Windows
            Hash        = $null
            Depth       = @($wikiPath -split '/').Count
            IsIndex     = $isIndex
        }
    }

    if ($pages) {
        # Repo markdown keeps relative links so it stays navigable in VS Code, GitHub and Azure
        # DevOps. Wiki.js needs absolute paths, so they are translated on the way out - the source
        # files are never modified.
        $pathMap = @{}
        foreach ($p in $pages) { $pathMap[$p.Source.ToLowerInvariant()] = $p.WikiPath }

        foreach ($p in $pages) {
            $dir = $p.SourceDir
            $evaluator = {
                param($match)
                $target = $match.Groups['target'].Value
                $frag = $match.Groups['frag'].Value
                if ($target -match '^(https?:|/)') { return $match.Value }
                try { $abs = [System.IO.Path]::GetFullPath((Join-Path $dir $target)) }
                catch { return $match.Value }
                $rel = (Get-DocsRelativePath -Path $abs -Root $RepoRoot).ToLowerInvariant()
                if ($pathMap.ContainsKey($rel)) { return "](/$Locale/$($pathMap[$rel])$frag)" }
                return $match.Value
            }
            $p.Body = [regex]::Replace($p.Body, '\]\((?<target>[^)\s]+\.md)(?<frag>#[^)\s]*)?\)', [System.Text.RegularExpressions.MatchEvaluator]$evaluator)

            # Hash after rewriting: a changed link target must count as a change.
            $p.Hash = Get-ContentHash -Payload "$($p.WikiPath)|$($p.Title)|$($p.Tags -join ',')|$($p.Description)|$($p.Body)"
        }

        # Parents before children, index before siblings - Wiki.js needs the parent path to exist.
        $pages = @($pages | Sort-Object Depth, @{ Expression = { -not $_.IsIndex } }, WikiPath)
    }

    [pscustomobject]@{ Pages = @($pages); Skipped = @($skipped) }
}

# --- Manifest --------------------------------------------------------------------------------

function Read-SyncManifest {
    param([Parameter(Mandatory)][string]$Path)

    $manifest = @{}
    if (-not (Test-Path -LiteralPath $Path)) { return $manifest }

    $loaded = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($entry in @(Get-DocsProperty -Object $loaded -Name 'pages' -Default @())) { $manifest[$entry.wikiPath] = $entry }
    return $manifest
}

function Write-SyncManifest {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][hashtable]$Manifest,
        [string]$Locale = 'en'
    )

    $out = [pscustomobject]@{
        schema  = 2
        locale  = $Locale
        updated = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ssK')
        pages   = @($Manifest.Values | Sort-Object wikiPath)
    }
    Write-DocsUtf8File -Path $Path -Text ($out | ConvertTo-Json -Depth 5)
}

<#
.SYNOPSIS
    Compare scanned pages against the manifest and label each one.

.DESCRIPTION
    Status values:
      new       - not in the manifest (or recorded without a hash), never published
      outdated  - published before, content has changed since
      published - manifest hash matches the current content
      orphaned  - in the manifest but the source file is gone (never auto-deleted in Wiki.js)
#>
function Get-PageSyncState {
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Pages,
        [Parameter(Mandatory)][hashtable]$Manifest,
        [string]$Filter,
        [switch]$Force
    )

    $candidates = $Pages
    if ($Filter) { $candidates = @($Pages | Where-Object { $_.Source -like "*$Filter*" }) }
    $states = @()

    foreach ($p in $candidates) {
        $known = $null
        if ($Manifest.ContainsKey($p.WikiPath)) { $known = $Manifest[$p.WikiPath] }
        $knownHash = Get-DocsProperty -Object $known -Name 'hash'

        $status = 'published'
        if (-not $knownHash) { $status = 'new' }
        elseif ($Force -or $knownHash -ne $p.Hash) { $status = 'outdated' }

        $states += [pscustomobject]@{
            Page        = $p
            WikiPath    = $p.WikiPath
            Source      = $p.Source
            Title       = $p.Title
            Status      = $status
            PublishedAt = (Get-DocsProperty -Object $known -Name 'publishedAt')
        }
    }

    $knownPaths = @($Pages | ForEach-Object { $_.WikiPath })
    foreach ($orphan in @($Manifest.Keys | Where-Object { $_ -notin $knownPaths })) {
        $entry = $Manifest[$orphan]
        # A filtered run only reports orphans inside the filter.
        if ($Filter -and -not ((Get-DocsProperty -Object $entry -Name 'source' -Default '') -like "*$Filter*")) { continue }
        $states += [pscustomobject]@{
            Page        = $null
            WikiPath    = $orphan
            Source      = (Get-DocsProperty -Object $entry -Name 'source')
            Title       = (Get-DocsProperty -Object $entry -Name 'title')
            Status      = 'orphaned'
            PublishedAt = (Get-DocsProperty -Object $entry -Name 'publishedAt')
        }
    }

    return $states
}

# --- Wiki.js connection (only needed when actually publishing) -------------------------------

<#
.SYNOPSIS
    Read a KEY=value setting from the environment, else from a git-ignored .env file.

.DESCRIPTION
    Looks in $env:<Name>, then <parent of .github>/.env, then <repo root>/.env. Secrets must never
    be passed on the command line or committed.
#>
function Get-DocsSetting {
    param(
        [Parameter(Mandatory)][string]$Name,
        [string]$RepoRoot
    )
    $value = [Environment]::GetEnvironmentVariable($Name)
    if ($value) { return $value.Trim() }

    $candidates = @(Join-Path (Get-DocsCustomizationsRoot) '.env')
    if ($RepoRoot) { $candidates += (Join-Path $RepoRoot '.env') }
    foreach ($envFile in $candidates) {
        if (-not (Test-Path -LiteralPath $envFile)) { continue }
        foreach ($line in Get-Content -LiteralPath $envFile -Encoding UTF8) {
            $m = [regex]::Match($line, "^\s*$([regex]::Escape($Name))\s*=\s*(.*)$")
            if ($m.Success) { return $m.Groups[1].Value.Trim().Trim('"', "'") }
        }
    }
    return $null
}
