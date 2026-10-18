<#
.SYNOPSIS
    Record which AL objects a documentation folder covers, together with their current hashes.

.DESCRIPTION
    Writes metadata.json into a documentation folder. It answers two questions later:
      1. Which AL objects does this documentation describe?
      2. What did those objects look like when the documentation was last confirmed correct?

    Running it again refreshes the hashes - that is the "documentation is up to date again" step
    after someone has reviewed and corrected the text.

    For every referenced object the file also records the extensions layered on it. That is what
    makes base objects trackable: the Customer table itself lives in Microsoft's application and
    has no file here, but every tableextension the app puts on it does.

.PARAMETER DocFolder
    Documentation folder, e.g. docs/modules/sales/payment-tolerance. Relative paths resolve against
    the current directory, then the repository root.

.PARAMETER Object
    Object references to record, e.g. 'Codeunit 50103', 'Table Customer'. Added to what is already
    recorded; nothing is removed.

.PARAMETER Remove
    Remove these references from the metadata.

.PARAMETER Detect
    Scan the markdown in the folder for typed object references such as "Report 50100" and add what
    is found. Suggestions only - always review the result.

.PARAMETER IncludeBareIds
    Also treat bare five-digit numbers as object IDs. Off by default because documentation mentions
    field IDs, option values and page IDs the same way, which produces false entries.

.PARAMETER SourcePath
    AL source folder(s) to scan. Default: every app.json folder in the repository.

.PARAMETER RepoRoot
    Repository root. Default: `git rev-parse --show-toplevel`, else the folder containing .github.

.EXAMPLE
    ./Update-DocsObjectMetadata.ps1 -DocFolder docs/modules/sales/payment-tolerance -Object 'Codeunit 50103', 'Table Customer'

.EXAMPLE
    ./Update-DocsObjectMetadata.ps1 -DocFolder docs/modules/sales/payment-tolerance -Detect

.EXAMPLE
    ./Update-DocsObjectMetadata.ps1 -DocFolder docs/modules/sales/payment-tolerance
    Refresh the hashes after the documentation has been brought up to date.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)][string]$DocFolder,
    [string[]]$Object = @(),
    [string[]]$Remove = @(),
    [switch]$Detect,
    [switch]$IncludeBareIds,
    [Alias('SourceRoot')][string[]]$SourcePath,
    [string]$RepoRoot
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'ALObjects.Common.ps1')

$repo = Get-DocsRepoRoot -RepoRoot $RepoRoot
$roots = @(Get-DocsSourceRoots -SourcePath $SourcePath -RepoRoot $repo)

$folder = Resolve-DocsPath -Path $DocFolder -RepoRoot $repo
if (-not (Test-Path -LiteralPath $folder)) { throw "Documentation folder not found: $folder" }
$folder = (Resolve-Path -LiteralPath $folder).Path
$metadataPath = Join-Path $folder 'metadata.json'
$relFolder = Get-DocsRelativePath -Path $folder -Root $repo

# --- Existing references ---------------------------------------------------------------------

$references = @()
if (Test-Path -LiteralPath $metadataPath) {
    $existing = Get-Content -LiteralPath $metadataPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $references = @($existing.objects | ForEach-Object { $_.ref })
}

# --- Detection -------------------------------------------------------------------------------

if ($Detect) {
    $found = @()
    foreach ($md in @(Get-ChildItem -LiteralPath $folder -Filter *.md -File)) {
        $text = Get-Content -LiteralPath $md.FullName -Raw -Encoding UTF8
        if (-not $text) { continue }
        foreach ($m in [regex]::Matches($text, '(?i)\b(reportextension|report|tableextension|table|pageextension|page|codeunit|query|xmlport|enumextension|enum)\s+(\d{4,9})\b')) {
            $found += '{0} {1}' -f $m.Groups[1].Value.ToLowerInvariant(), $m.Groups[2].Value
        }
        # Bare numbers are ambiguous: documentation mentions field IDs and option values the same
        # way as object IDs, so this stays opt-in.
        if ($IncludeBareIds) {
            foreach ($m in [regex]::Matches($text, '\b(5\d{4}|99[89]\d{2})\b')) { $found += $m.Groups[1].Value }
        }
    }
    $new = @($found | Sort-Object -Unique | Where-Object { $_ -notin $references })
    if ($new) {
        Write-Host 'Detected and added:' -ForegroundColor Cyan
        $new | ForEach-Object { Write-Host "  + $_" }
        $references += $new
    }
    else { Write-Host 'No new object references found in the text.' -ForegroundColor DarkGray }
}

foreach ($o in $Object) { if ($o -notin $references) { $references += $o } }
if ($Remove) { $references = @($references | Where-Object { $_ -notin $Remove }) }
$references = @($references | Sort-Object -Unique)

if (-not $references) { throw 'No object references. Use -Object or -Detect.' }

# --- Resolve and hash ------------------------------------------------------------------------

Write-Host 'Scanning AL objects ...' -ForegroundColor DarkGray
$all = @(Get-ALObjects -SourceRoots $roots -RepoRoot $repo)

$entries = @()
$unresolved = @()
$ambiguousRefs = @()
foreach ($ref in $references) {
    $r = Resolve-ALObjectReference -Reference $ref -Objects $all
    if ($r.Ambiguous) { $ambiguousRefs += [pscustomobject]@{ Ref = $ref; Candidates = $r.Ambiguous }; continue }
    if (-not $r.Resolved -and -not $r.Extensions) { $unresolved += $ref; continue }

    $entries += [pscustomobject]@{
        ref        = $ref
        type       = $r.Type
        id         = $r.Id
        name       = $r.Name
        resolved   = $r.Resolved
        hash       = $r.Hash
        files      = @($r.Files)
        extensions = @($r.Extensions)
    }
}

# Several references can point at the same object ("50100" and "Codeunit 50100"). Keep one entry
# per object, preferring the reference that names its type.
$entries = @($entries | Group-Object { '{0}|{1}|{2}' -f $_.type, $_.id, $_.name } | ForEach-Object {
        $_.Group | Sort-Object { [bool]($_.ref -match '^\s*\d+\s*$') } | Select-Object -First 1
    })

Write-Host ''
Write-Host "Documented objects in $relFolder" -ForegroundColor Cyan
foreach ($e in $entries) {
    $own = 'own object'
    if (-not $e.resolved) { $own = 'base object (not in this repository)' }
    Write-Host ('  {0,-28} {1}' -f $e.ref, $own)
    foreach ($x in $e.extensions) { Write-Host ('      + {0} {1} {2}' -f $x.type, $x.id, $x.name) -ForegroundColor DarkGray }
}
foreach ($u in $unresolved) { Write-Host "  $u -> not found, not recorded" -ForegroundColor Yellow }
foreach ($a in $ambiguousRefs) {
    Write-Host "  $($a.Ref) -> ambiguous, not recorded" -ForegroundColor Yellow
    Write-Host '      Object IDs are unique per type only. Reference it with its type, e.g.:' -ForegroundColor DarkGray
    foreach ($c in $a.Candidates) { Write-Host "      - $c" -ForegroundColor DarkGray }
}

if (-not $entries) { throw 'None of the references could be resolved; metadata.json was not written.' }

if ($PSCmdlet.ShouldProcess($metadataPath, 'Write metadata.json')) {
    $json = [pscustomobject]@{
        schema     = 1
        docFolder  = $relFolder
        recordedAt = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ssK')
        gitCommit  = Get-DocsGitCommit -RepoRoot $repo
        objects    = @($entries | Sort-Object type, id, ref)
    } | ConvertTo-Json -Depth 8
    Write-DocsUtf8File -Path $metadataPath -Text $json

    Write-Host ''
    Write-Host "Written: $relFolder/metadata.json ($($entries.Count) object(s))" -ForegroundColor Green
}
