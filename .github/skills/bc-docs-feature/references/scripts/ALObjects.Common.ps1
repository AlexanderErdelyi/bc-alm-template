<#
.SYNOPSIS
    Shared AL object parsing and hashing for documentation drift detection and coverage.

.DESCRIPTION
    Dot-sourced by Get-ALObjectIndex.ps1, Update-DocsObjectMetadata.ps1, Test-DocsObjectDrift.ps1
    and Get-DocsCoverage.ps1 so all of them parse and hash identically. Not meant to be run directly.

    Design notes:
    - The hash of a report includes its RDLC/Word/Excel layout files. A layout change alters the
      printed document without touching the .al file, so hashing only the .al would miss it.
    - Base objects that live in Microsoft's application (for example the Customer table) have no
      file here. They resolve with Hash = $null and are tracked purely through the extensions that
      the app layers on top of them.
    - All file paths are stored relative to the repository root with forward slashes, so they can
      be passed straight to `git diff`.
#>

Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'DocsRepo.Common.ps1')

$script:ObjectTypePattern =
'tableextension|pageextension|reportextension|enumextension|permissionsetextension|profileextension|pagecustomization|table|page|report|codeunit|query|xmlport|enum|interface|controladdin|permissionset|profile|entitlement|dotnet'

function Get-FileHashLF {
    param([Parameter(Mandatory)][string]$Path)

    # LF-normalised so a CRLF checkout does not look like a change.
    $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    if ($null -eq $raw) { $raw = '' }
    $text = $raw -replace "`r`n", "`n"
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
        return -join ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') })
    }
    finally { $sha.Dispose() }
}

function Get-CombinedHash {
    param([Parameter(Mandatory)][AllowEmptyCollection()][string[]]$Parts)

    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes(($Parts -join '|'))
        return -join ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') })
    }
    finally { $sha.Dispose() }
}

function Get-ALModuleName {
    param(
        [Parameter(Mandatory)][string]$FullName,
        [Parameter(Mandatory)][string]$AppRoot,
        [Parameter(Mandatory)][string]$RepoRoot
    )
    $appLabel = Get-DocsRelativePath -Path $AppRoot -Root $RepoRoot
    if ($appLabel -eq '.') { $appLabel = Split-Path -Leaf $RepoRoot }

    $segments = @((Get-DocsRelativePath -Path $FullName -Root $AppRoot) -split '/')
    if ($segments.Count -gt 1 -and $segments[0] -eq 'src') { $segments = @($segments[1..($segments.Count - 1)]) }
    if ($segments.Count -gt 1) { return "$appLabel/$($segments[0])" }
    return $appLabel
}

<#
.SYNOPSIS
    Parse every AL object under the given source roots and return it with its content hash.

.PARAMETER SourceRoots
    Objects with AppRoot and SourceRoot, as returned by Get-DocsSourceRoots.

.OUTPUTS
    Objects with: Type, Id, Name, Extends, Module, File, Files, Hash
#>
function Get-ALObjects {
    param(
        [Parameter(Mandatory)][object[]]$SourceRoots,
        [Parameter(Mandatory)][string]$RepoRoot
    )

    $declaration = "(?im)^\s*(?<type>$script:ObjectTypePattern)\s+(?<id>\d+)?\s*(?<name>""[^""]+""|[A-Za-z_][\w]*)(?:\s+extends\s+(?<ext>""[^""]+""|[A-Za-z_][\w]*))?"
    $objects = @()
    $seen = @{}

    foreach ($root in $SourceRoots) {
        foreach ($file in @(Get-ChildItem -LiteralPath $root.SourceRoot -Recurse -File -Filter *.al -ErrorAction SilentlyContinue)) {
            if ($seen.ContainsKey($file.FullName)) { continue }
            $seen[$file.FullName] = $true

            # Skip symbol caches, snapshots and other tool folders below the app.
            $inAppPath = Get-DocsRelativePath -Path $file.DirectoryName -Root $root.AppRoot
            if (@($inAppPath -split '/' | Where-Object { $_ -ne '.' -and $_ -match $script:DocsSkipDirectoryPattern }).Count) { continue }

            $raw = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8
            if (-not $raw) { continue }

            $m = [regex]::Match($raw, $declaration)
            if (-not $m.Success) { continue }

            $relative = Get-DocsRelativePath -Path $file.FullName -Root $RepoRoot
            $files = @($relative)

            # Report layouts are part of the output, so they are part of the object's identity.
            foreach ($lm in [regex]::Matches($raw, "(?im)^\s*(?:RDLCLayout|WordLayout|ExcelLayout|LayoutFile)\s*=\s*'([^']+)'")) {
                $layoutRef = $lm.Groups[1].Value -replace '^\./', ''
                $candidate = Join-Path $root.AppRoot $layoutRef
                if (-not (Test-Path -LiteralPath $candidate)) { $candidate = Join-Path $file.DirectoryName $layoutRef }
                if (Test-Path -LiteralPath $candidate) {
                    $layoutRel = Get-DocsRelativePath -Path (Resolve-Path -LiteralPath $candidate).Path -Root $RepoRoot
                    if ($files -notcontains $layoutRel) { $files += $layoutRel }
                }
            }

            $parts = @(foreach ($f in $files) { "$f=$(Get-FileHashLF -Path (Join-Path $RepoRoot $f))" })

            $id = $null
            if ($m.Groups['id'].Success) { $id = [int]$m.Groups['id'].Value }
            $extends = $null
            if ($m.Groups['ext'].Success) { $extends = $m.Groups['ext'].Value.Trim('"') }

            $objects += [pscustomobject]@{
                Type    = $m.Groups['type'].Value.ToLowerInvariant()
                Id      = $id
                Name    = $m.Groups['name'].Value.Trim('"')
                Extends = $extends
                Module  = Get-ALModuleName -FullName $file.FullName -AppRoot $root.AppRoot -RepoRoot $RepoRoot
                File    = $relative
                Files   = @($files)
                Hash    = Get-CombinedHash -Parts $parts
            }
        }
    }

    return $objects
}

<#
.SYNOPSIS
    Resolve a documentation reference to the object it means, plus every extension layered on it.

.PARAMETER Reference
    "Report 50100", "Table Customer", "50100" or "ABC Payment Setup".

.DESCRIPTION
    A reference resolves to at most one own object. Extensions are matched by their `extends`
    target name, which is how a base object such as Customer becomes trackable: the base table has
    no file in this repo, but every tableextension on it does.
#>
function Resolve-ALObjectReference {
    param(
        [Parameter(Mandatory)][string]$Reference,
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Objects
    )

    $type = $null
    $id = $null
    $name = $null

    if ($Reference -match "^\s*(?<t>$script:ObjectTypePattern)\s+(?<rest>.+)$") {
        $type = $Matches['t'].ToLowerInvariant()
        $rest = $Matches['rest'].Trim().Trim('"')
        if ($rest -match '^\d+$') { $id = [int]$rest } else { $name = $rest }
    }
    elseif ($Reference -match '^\s*\d+\s*$') { $id = [int]$Reference.Trim() }
    else { $name = $Reference.Trim().Trim('"') }

    # Named $hits, not $matches: $Matches is an automatic variable used by -match above.
    $hits = @($Objects | Where-Object {
            (-not $type -or $_.Type -eq $type) -and
            (($null -ne $id -and $_.Id -eq $id) -or ($null -ne $name -and $_.Name -eq $name))
        })

    # Object IDs are unique per type, not globally: a table, a page and a codeunit can all be 50100.
    # Guessing would silently track the wrong object, so an ambiguous reference stays unresolved.
    $ambiguous = @()
    if ($hits.Count -gt 1 -and -not $type) {
        $ambiguous = @($hits | ForEach-Object { "{0} {1} {2}" -f $_.Type, $_.Id, $_.Name })
        $hits = @()
    }
    $match = $hits | Select-Object -First 1

    # Extensions are found by the name of what they extend, so a name is needed even when the
    # reference was given as an ID.
    $baseName = $null
    if ($match) { $baseName = $match.Name } elseif ($name) { $baseName = $name }

    $extensions = @()
    if ($baseName) {
        $extensions = @($Objects | Where-Object { $_.Extends -and $_.Extends -eq $baseName } | Sort-Object Type, Id)
    }

    $resolvedType = $type
    $resolvedId = $id
    $hash = $null
    $files = @()
    if ($match) {
        $resolvedType = $match.Type
        $resolvedId = $match.Id
        $hash = $match.Hash
        $files = @($match.Files)
    }

    [pscustomobject]@{
        Reference  = $Reference
        Resolved   = [bool]$match
        Ambiguous  = $ambiguous
        Type       = $resolvedType
        Id         = $resolvedId
        Name       = $baseName
        Hash       = $hash
        Files      = $files
        Extensions = @($extensions | ForEach-Object {
                [pscustomobject]@{
                    type = $_.Type
                    id   = $_.Id
                    name = $_.Name
                    file = $_.File
                    hash = $_.Hash
                }
            })
    }
}
