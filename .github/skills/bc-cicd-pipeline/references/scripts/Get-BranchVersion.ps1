<#
.SYNOPSIS
    Computes the Business Central app version for the current branch (pipeline-managed versioning).

.DESCRIPTION
    Platform-neutral version computation for GitHub Actions, Azure Pipelines or a local shell.
    Used when template.config.json 'values.versioning' is 'pipeline'. See ../versioning.md.

    Scheme: Major.Minor.Build.Revision
      Major.Minor  Taken from app.json (or -BaseVersion). Changed manually, e.g. when you move to a
                   new BC platform version.
      Build        Release counter. A build of the production branch uses
                   (highest Build seen) + 1 and Revision 0.
      Revision     CI counter for every other branch (develop, release/*, ...). Uses the Build of the
                   last production release and the next multiple of -RevisionStep (default 10) above
                   the highest existing revision for that Build. The slots in between (.11-.19,
                   .21-.29, ...) stay free for manual hotfix deploys. Resets on every new Build.

    Previous versions come from git tags ('<TagPrefix><Major>.<Minor>.<Build>.<Revision>', for example
    v28.0.5.10) plus the version currently in app.json. Pass -ExistingVersions to feed the list from
    somewhere else instead (for example your artifact feed); both 4-part versions and the SemVer
    feed versions produced by this script (28.0.5, 28.0.5-dev.10) are understood.

    Feed version (SemVer 2.0, for NuGet / Universal Packages / GitHub Packages):
      production branch  ->  28.0.5          (stable)
      channel branch     ->  28.0.5-dev.10   (prerelease label = channel, numeric revision)

    Outputs: returns an object and, when running in a pipeline, sets output variables:
      GitHub Actions ($env:GITHUB_OUTPUT): app_version, feed_version, channel, build, revision,
                                           tag, is_production
      Azure Pipelines ($env:TF_BUILD):     AppVersion, FeedVersion, VersionChannel, VersionBuild,
                                           VersionRevision, VersionTag, IsProductionBuild
                                           (plain and isOutput=true)

    Compatible with Windows PowerShell 5.1 and PowerShell 7+.

.PARAMETER Branch
    Branch being built. Default: detected from GITHUB_HEAD_REF / GITHUB_REF_NAME,
    SYSTEM_PULLREQUEST_SOURCEBRANCH / BUILD_SOURCEBRANCH, or 'git rev-parse --abbrev-ref HEAD'.
    A leading 'refs/heads/' is removed.

.PARAMETER ProductionBranch
    Production branch name(s). Default: 'values.defaultBranch' from template.config.json at the repo
    root, else 'main'.

.PARAMETER ChannelMap
    Branch pattern (-like wildcards) to channel label. A hashtable (@{ 'develop' = 'dev' }) or a
    string 'develop=dev;release/*=uat'. Default: develop=dev; release/*=uat. Unmatched branches use
    -DefaultChannel.

.PARAMETER AppJsonPath
    app.json file(s). The first one supplies Major.Minor (unless -BaseVersion is given); all of them
    are stamped with -WriteAppJson. Default: app/app.json.

.PARAMETER BaseVersion
    Override Major.Minor, e.g. '28.0' or '28.0.0.0'.

.PARAMETER ExistingVersions
    Previously used versions. When supplied, git tags are not read.

.PARAMETER WriteAppJson
    Stamp the computed 4-part version into the top-level 'version' of every -AppJsonPath file
    (formatting is preserved; dependency versions are not touched).

.PARAMETER UpdateBuildNumber
    Azure Pipelines only: rename the run to the computed version (channel suffix on non-production).

.EXAMPLE
    ./Get-BranchVersion.ps1 -Branch develop
.EXAMPLE
    ./Get-BranchVersion.ps1 -WriteAppJson -AppJsonPath app/app.json,test/app.json
.EXAMPLE
    ./Get-BranchVersion.ps1 -Branch release/UAT -ExistingVersions '28.0.5','28.0.5-dev.10','28.0.5-uat.20'
#>
[CmdletBinding()]
param(
    [string]$Branch,
    [string[]]$ProductionBranch,
    [object]$ChannelMap,
    [string]$DefaultChannel = 'ci',
    [string[]]$AppJsonPath = @('app/app.json'),
    [string]$BaseVersion,
    [string[]]$ExistingVersions,
    [string]$TagPrefix = 'v',
    [ValidateRange(1, 100000)]
    [int]$RevisionStep = 10,
    [switch]$WriteAppJson,
    [switch]$UpdateBuildNumber
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Invoke-GitText {
    param([string[]]$Arguments)
    $gitCmd = Get-Command git -ErrorAction SilentlyContinue
    if (-not $gitCmd) { return $null }
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & git @Arguments 2>$null
        if ($LASTEXITCODE -ne 0) { return $null }
        return $out
    } finally {
        $ErrorActionPreference = $previous
    }
}

function ConvertTo-VersionInfo {
    # Accepts 'v28.0.5.10', '28.0.5.10', '28.0.5.10-dev', '28.0.5-dev.10', '28.0.5'.
    param([string]$Text, [string]$Prefix)
    if (-not $Text) { return $null }
    $t = $Text.Trim()
    if ($Prefix -and $t.StartsWith($Prefix)) { $t = $t.Substring($Prefix.Length) }
    $m = [regex]::Match($t, '^(\d+)\.(\d+)\.(\d+)\.(\d+)')
    if ($m.Success) {
        return New-Object PSObject -Property @{
            Major = [int]$m.Groups[1].Value; Minor = [int]$m.Groups[2].Value
            Build = [int]$m.Groups[3].Value; Revision = [int]$m.Groups[4].Value
        }
    }
    $m = [regex]::Match($t, '^(\d+)\.(\d+)\.(\d+)-[0-9A-Za-z-]+\.(\d+)$')
    if ($m.Success) {
        return New-Object PSObject -Property @{
            Major = [int]$m.Groups[1].Value; Minor = [int]$m.Groups[2].Value
            Build = [int]$m.Groups[3].Value; Revision = [int]$m.Groups[4].Value
        }
    }
    $m = [regex]::Match($t, '^(\d+)\.(\d+)\.(\d+)$')
    if ($m.Success) {
        return New-Object PSObject -Property @{
            Major = [int]$m.Groups[1].Value; Minor = [int]$m.Groups[2].Value
            Build = [int]$m.Groups[3].Value; Revision = 0
        }
    }
    return $null
}

function Read-JsonFile {
    param([string]$Path)
    $text = [System.IO.File]::ReadAllText((Resolve-Path -LiteralPath $Path).ProviderPath)
    return $text
}

function Set-TopLevelJsonVersion {
    # Replaces the value of the top-level "version" property without reformatting the file.
    param([string]$Json, [string]$NewVersion)
    $depth = 0
    $inString = $false
    $escape = $false
    $stringStart = -1
    for ($i = 0; $i -lt $Json.Length; $i++) {
        $c = $Json[$i]
        if ($inString) {
            if ($escape) { $escape = $false; continue }
            if ($c -eq [char]'\') { $escape = $true; continue }
            if ($c -eq [char]'"') {
                $inString = $false
                if ($depth -eq 1 -and $Json.Substring($stringStart, $i - $stringStart + 1) -eq '"version"') {
                    $m = [regex]::Match($Json.Substring($i + 1), '^\s*:\s*"[^"]*"')
                    if ($m.Success) {
                        $valueMatch = [regex]::Match($m.Value, '"[^"]*"$')
                        $start = $i + 1 + $valueMatch.Index
                        return $Json.Substring(0, $start) + '"' + $NewVersion + '"' + $Json.Substring($start + $valueMatch.Length)
                    }
                }
            }
        } else {
            if ($c -eq [char]'"') { $inString = $true; $stringStart = $i }
            elseif ($c -eq [char]'{' -or $c -eq [char]'[') { $depth++ }
            elseif ($c -eq [char]'}' -or $c -eq [char]']') { $depth-- }
        }
    }
    throw 'No top-level "version" property found.'
}

function Get-ChannelEntries {
    param([object]$Map)
    $entries = @()
    if ($null -eq $Map -or ($Map -is [string] -and -not $Map)) {
        $entries += New-Object PSObject -Property @{ Pattern = 'develop'; Channel = 'dev' }
        $entries += New-Object PSObject -Property @{ Pattern = 'release/*'; Channel = 'uat' }
        return $entries
    }
    if ($Map -is [System.Collections.IDictionary]) {
        foreach ($key in $Map.Keys) {
            $entries += New-Object PSObject -Property @{ Pattern = [string]$key; Channel = [string]$Map[$key] }
        }
        return $entries
    }
    foreach ($pair in ([string]$Map).Split(';')) {
        if (-not $pair.Trim()) { continue }
        $kv = $pair.Split('=')
        if ($kv.Count -ne 2) { throw "Invalid -ChannelMap entry '$pair'. Use 'pattern=channel'." }
        $entries += New-Object PSObject -Property @{ Pattern = $kv[0].Trim(); Channel = $kv[1].Trim() }
    }
    return $entries
}

function Set-PipelineOutput {
    param([string]$GitHubName, [string]$AdoName, [string]$Value)
    if ($env:GITHUB_OUTPUT) {
        $utf8NoBom = New-Object System.Text.UTF8Encoding $false
        [System.IO.File]::AppendAllText($env:GITHUB_OUTPUT, ("{0}={1}`n" -f $GitHubName, $Value), $utf8NoBom)
    }
    if ($env:TF_BUILD) {
        Write-Host ("##vso[task.setvariable variable={0}]{1}" -f $AdoName, $Value)
        Write-Host ("##vso[task.setvariable variable={0};isOutput=true]{1}" -f $AdoName, $Value)
    }
}

# --- Resolve inputs ----------------------------------------------------------
# 'powershell -File' passes 'a,b' as one string: accept comma/semicolon separated lists as well.
$AppJsonPath = @($AppJsonPath | ForEach-Object { ([string]$_).Split(',;') } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($null -ne $ExistingVersions) {
    $ExistingVersions = @($ExistingVersions | ForEach-Object { ([string]$_).Split(',; ') } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}
if ($null -ne $ProductionBranch) {
    $ProductionBranch = @($ProductionBranch | ForEach-Object { ([string]$_).Split(',;') } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

if (-not $Branch) {
    if ($env:GITHUB_HEAD_REF) { $Branch = $env:GITHUB_HEAD_REF }
    elseif ($env:GITHUB_REF_NAME) { $Branch = $env:GITHUB_REF_NAME }
    elseif ($env:SYSTEM_PULLREQUEST_SOURCEBRANCH) { $Branch = $env:SYSTEM_PULLREQUEST_SOURCEBRANCH }
    elseif ($env:BUILD_SOURCEBRANCH) { $Branch = $env:BUILD_SOURCEBRANCH }
    else { $Branch = [string](Invoke-GitText @('rev-parse', '--abbrev-ref', 'HEAD')) }
}
if (-not $Branch) { throw 'Could not determine the branch. Pass -Branch.' }
$Branch = $Branch.Trim() -replace '^refs/heads/', ''

if (-not $ProductionBranch -or $ProductionBranch.Count -eq 0) {
    $ProductionBranch = @('main')
    $repoRoot = Invoke-GitText @('rev-parse', '--show-toplevel')
    if ($repoRoot) {
        $configPath = Join-Path ([string]$repoRoot) 'template.config.json'
        if (Test-Path -LiteralPath $configPath) {
            try {
                $config = (Read-JsonFile $configPath) | ConvertFrom-Json
                $valuesProp = $config.PSObject.Properties['values']
                if ($valuesProp -and $valuesProp.Value.PSObject.Properties['defaultBranch']) {
                    $defaultBranch = [string]$valuesProp.Value.defaultBranch
                    if ($defaultBranch) { $ProductionBranch = @($defaultBranch) }
                }
            } catch {
                Write-Warning ("Could not read {0}: {1}" -f $configPath, $_.Exception.Message)
            }
        }
    }
}

$appJsonVersion = $null
if (-not $BaseVersion -or $WriteAppJson) {
    foreach ($p in $AppJsonPath) {
        if (-not (Test-Path -LiteralPath $p)) { throw "app.json not found: $p" }
    }
}
if (Test-Path -LiteralPath $AppJsonPath[0]) {
    $appJsonVersion = [string]((Read-JsonFile $AppJsonPath[0]) | ConvertFrom-Json).version
}
if (-not $BaseVersion) { $BaseVersion = $appJsonVersion }
$baseMatch = [regex]::Match([string]$BaseVersion, '^(\d+)\.(\d+)')
if (-not $baseMatch.Success) { throw "Invalid base version '$BaseVersion'. Expected 'Major.Minor[.x.y]'." }
$major = [int]$baseMatch.Groups[1].Value
$minor = [int]$baseMatch.Groups[2].Value

$isProduction = $false
foreach ($pb in $ProductionBranch) {
    if ($Branch -eq ($pb -replace '^refs/heads/', '')) { $isProduction = $true }
}

$channel = $DefaultChannel
if ($isProduction) {
    $channel = 'prod'
} else {
    foreach ($entry in (Get-ChannelEntries $ChannelMap)) {
        if ($Branch -like $entry.Pattern) { $channel = $entry.Channel; break }
    }
}
if ($channel -notmatch '^[0-9A-Za-z-]+$') { throw "Invalid channel label '$channel' (SemVer allows [0-9A-Za-z-])." }

# --- Collect previous versions -----------------------------------------------
$source = 'parameter'
$rawVersions = @()
if ($null -ne $ExistingVersions -and $ExistingVersions.Count -gt 0) {
    $rawVersions += $ExistingVersions
} else {
    $source = 'git tags'
    $insideRepo = Invoke-GitText @('rev-parse', '--is-inside-work-tree')
    if ([string]$insideRepo -ne 'true') {
        Write-Warning 'Not a git repository (or git is missing): no previous versions read. Pass -ExistingVersions or run inside the checkout.'
    } else {
        $tags = Invoke-GitText @('tag', '--list', ("{0}{1}.{2}.*" -f $TagPrefix, $major, $minor))
        if ($null -ne $tags) { $rawVersions += @($tags) }
        if (@($tags).Count -eq 0 -or $null -eq $tags) {
            Write-Warning ("No '{0}{1}.{2}.*' tags found. If this is not the first release, make sure the checkout fetches tags (fetch-depth: 0)." -f $TagPrefix, $major, $minor)
        }
    }
}
if ($appJsonVersion) { $rawVersions += $appJsonVersion }

$known = @()
foreach ($raw in $rawVersions) {
    $info = ConvertTo-VersionInfo -Text ([string]$raw) -Prefix $TagPrefix
    if ($null -ne $info -and $info.Major -eq $major -and $info.Minor -eq $minor) { $known += $info }
}

$prodBuilds = @($known | Where-Object { $_.Revision -eq 0 } | ForEach-Object { $_.Build })
$lastProdBuild = 0
if ($prodBuilds.Count -gt 0) { $lastProdBuild = [int](($prodBuilds | Measure-Object -Maximum).Maximum) }

# --- Compute -------------------------------------------------------------------
if ($isProduction) {
    $maxBuild = $lastProdBuild
    if ($known.Count -gt 0) {
        $maxBuild = [int]((@($known | ForEach-Object { $_.Build }) | Measure-Object -Maximum).Maximum)
    }
    $build = $maxBuild + 1
    $revision = 0
    $maxRevision = 0
} else {
    $build = $lastProdBuild
    $maxRevision = 0
    $sameBuild = @($known | Where-Object { $_.Build -eq $build -and $_.Revision -gt 0 } | ForEach-Object { $_.Revision })
    if ($sameBuild.Count -gt 0) { $maxRevision = [int](($sameBuild | Measure-Object -Maximum).Maximum) }
    $revision = ([int][Math]::Floor($maxRevision / $RevisionStep) + 1) * $RevisionStep
}

$appVersion = '{0}.{1}.{2}.{3}' -f $major, $minor, $build, $revision
if ($isProduction) {
    $feedVersion = '{0}.{1}.{2}' -f $major, $minor, $build
    $buildNumber = $appVersion
} else {
    $feedVersion = '{0}.{1}.{2}-{3}.{4}' -f $major, $minor, $build, $channel, $revision
    $buildNumber = '{0}-{1}' -f $appVersion, $channel
}
$tag = '{0}{1}' -f $TagPrefix, $appVersion

Write-Host '=== Get-BranchVersion ==='
Write-Host ('Branch            : {0}' -f $Branch)
Write-Host ('Production branch : {0} (is production: {1})' -f ($ProductionBranch -join ', '), $isProduction)
Write-Host ('Base Major.Minor  : {0}.{1}' -f $major, $minor)
Write-Host ('Known versions    : {0} (source: {1})' -f $known.Count, $source)
Write-Host ('Last prod Build   : {0}' -f $lastProdBuild)
if (-not $isProduction) { Write-Host ('Max revision      : {0} (step {1})' -f $maxRevision, $RevisionStep) }
Write-Host ('App version       : {0}' -f $appVersion)
Write-Host ('Channel           : {0}' -f $channel)
Write-Host ('Feed version      : {0}' -f $feedVersion)
Write-Host ('Tag               : {0}' -f $tag)

# --- Stamp app.json ------------------------------------------------------------
if ($WriteAppJson) {
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    foreach ($p in $AppJsonPath) {
        $full = (Resolve-Path -LiteralPath $p).ProviderPath
        $json = [System.IO.File]::ReadAllText($full)
        [System.IO.File]::WriteAllText($full, (Set-TopLevelJsonVersion -Json $json -NewVersion $appVersion), $utf8NoBom)
        Write-Host ('Stamped {0} -> {1}' -f $p, $appVersion)
    }
}

# --- Pipeline outputs ----------------------------------------------------------
$isProdText = 'false'
if ($isProduction) { $isProdText = 'true' }
Set-PipelineOutput 'app_version' 'AppVersion' $appVersion
Set-PipelineOutput 'feed_version' 'FeedVersion' $feedVersion
Set-PipelineOutput 'channel' 'VersionChannel' $channel
Set-PipelineOutput 'build' 'VersionBuild' ([string]$build)
Set-PipelineOutput 'revision' 'VersionRevision' ([string]$revision)
Set-PipelineOutput 'tag' 'VersionTag' $tag
Set-PipelineOutput 'is_production' 'IsProductionBuild' $isProdText
if ($UpdateBuildNumber -and $env:TF_BUILD) {
    Write-Host ("##vso[build.updatebuildnumber]{0}" -f $buildNumber)
}

New-Object PSObject -Property ([ordered]@{
    Branch       = $Branch
    IsProduction = $isProduction
    Channel      = $channel
    AppVersion   = $appVersion
    FeedVersion  = $feedVersion
    BuildNumber  = $buildNumber
    Tag          = $tag
    Build        = $build
    Revision     = $revision
})
