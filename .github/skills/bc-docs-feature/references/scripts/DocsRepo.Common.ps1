<#
.SYNOPSIS
    Shared repository / path resolution for the bc-docs-feature scripts.

.DESCRIPTION
    Dot-sourced by ALObjects.Common.ps1 and DocsSync.Common.ps1. Not meant to be run directly.

    The scripts live at <customizations>/.github/skills/bc-docs-feature/references/scripts. The
    customizations folder is usually the repository root, but a project may relocate it (for
    example to app/.github via sync.customizationsPath). Paths are therefore never hard-coded
    relative to the script; they are resolved in this order:

      Repository root : -RepoRoot parameter > `git rev-parse --show-toplevel` > parent of .github
      Docs root       : -DocsRoot parameter > <parent of .github>/docs > <repo root>/docs
      AL sources      : -SourcePath parameter > every folder below the repo root with an app.json
      .env file       : <parent of .github>/.env > <repo root>/.env

    Works in Windows PowerShell 5.1 and PowerShell 7+.
#>

Set-StrictMode -Version Latest

# Folders never scanned for app.json / .al files.
$script:DocsSkipDirectoryPattern = '^(\..*|node_modules|bin|obj|out)$'

function Get-DocsGithubDir {
    # scripts -> references -> bc-docs-feature -> skills -> .github
    return (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..\..')).Path
}

function Get-DocsCustomizationsRoot {
    # The folder that contains .github (repo root in the template, app/ in relocated setups).
    return (Split-Path -Parent (Get-DocsGithubDir))
}

function Get-DocsRepoRoot {
    param([string]$RepoRoot)

    if ($RepoRoot) {
        if (-not (Test-Path -LiteralPath $RepoRoot)) { throw "Repository root not found: $RepoRoot" }
        return (Resolve-Path -LiteralPath $RepoRoot).Path.TrimEnd('\', '/')
    }
    try {
        $top = (& git -C $PSScriptRoot rev-parse --show-toplevel 2>$null)
        if ($LASTEXITCODE -eq 0 -and $top) {
            return (Resolve-Path -LiteralPath ($top | Select-Object -First 1).Trim()).Path.TrimEnd('\', '/')
        }
    }
    catch { }
    return (Get-DocsCustomizationsRoot).TrimEnd('\', '/')
}

<#
.SYNOPSIS
    Resolve a user-supplied path: absolute as-is, else relative to the current directory if it
    exists there, else relative to the repository root.
#>
function Resolve-DocsPath {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$RepoRoot
    )
    if ([System.IO.Path]::IsPathRooted($Path)) { return $Path }
    $here = Join-Path (Get-Location).Path $Path
    if (Test-Path -LiteralPath $here) { return (Resolve-Path -LiteralPath $here).Path }
    return (Join-Path $RepoRoot $Path)
}

function Get-DocsDefaultDocsRoot {
    param(
        [string]$DocsRoot,
        [Parameter(Mandatory)][string]$RepoRoot
    )
    if ($DocsRoot) { return (Resolve-DocsPath -Path $DocsRoot -RepoRoot $RepoRoot) }
    $candidates = @()
    # docs/ next to a relocated .github (e.g. app/.github -> app/docs), but only inside this repo.
    $custom = [System.IO.Path]::GetFullPath((Get-DocsCustomizationsRoot)).TrimEnd('\', '/')
    $repoFull = [System.IO.Path]::GetFullPath($RepoRoot).TrimEnd('\', '/')
    if ($custom.StartsWith($repoFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        $candidates += (Join-Path $custom 'docs')
    }
    $candidates += (Join-Path $RepoRoot 'docs')
    foreach ($c in $candidates) { if (Test-Path -LiteralPath $c) { return (Resolve-Path -LiteralPath $c).Path } }
    return $candidates[-1]
}

<#
.SYNOPSIS
    Path relative to a root, with forward slashes. Paths outside the root are returned absolute.
#>
function Get-DocsRelativePath {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Root
    )
    $full = [System.IO.Path]::GetFullPath($Path)
    $rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
    if ($full.Equals($rootFull, [StringComparison]::OrdinalIgnoreCase)) { return '.' }
    if ($full.StartsWith($rootFull + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        return $full.Substring($rootFull.Length + 1).Replace('\', '/')
    }
    return $full.Replace('\', '/')
}

function Find-DocsAppFolders {
    param(
        [Parameter(Mandatory)][string]$Root,
        [int]$MaxDepth = 5
    )
    $result = @()
    $queue = New-Object System.Collections.Queue
    $queue.Enqueue(@($Root, 0))
    while ($queue.Count -gt 0) {
        $item = $queue.Dequeue()
        $dir = $item[0]
        $depth = $item[1]
        if (Test-Path -LiteralPath (Join-Path $dir 'app.json')) { $result += $dir }
        if ($depth -ge $MaxDepth) { continue }
        foreach ($sub in @(Get-ChildItem -LiteralPath $dir -Directory -ErrorAction SilentlyContinue)) {
            if ($sub.Name -match $script:DocsSkipDirectoryPattern) { continue }
            $queue.Enqueue(@($sub.FullName, ($depth + 1)))
        }
    }
    return $result
}

<#
.SYNOPSIS
    Return the AL source roots to scan: objects with AppRoot (folder holding app.json, used to
    resolve report layout paths) and SourceRoot (folder scanned for .al files).
#>
function Get-DocsSourceRoots {
    param(
        [string[]]$SourcePath,
        [Parameter(Mandatory)][string]$RepoRoot
    )

    $roots = @()
    if ($SourcePath) {
        foreach ($p in $SourcePath) {
            $full = Resolve-DocsPath -Path $p -RepoRoot $RepoRoot
            if (-not (Test-Path -LiteralPath $full)) { throw "Source path not found: $p" }
            $full = (Resolve-Path -LiteralPath $full).Path
            # The app root is the nearest folder upwards that holds app.json (layouts are relative to it).
            $appRoot = $full
            $probe = $full
            while ($probe) {
                if (Test-Path -LiteralPath (Join-Path $probe 'app.json')) { $appRoot = $probe; break }
                $parent = Split-Path -Parent $probe
                if (-not $parent -or $parent -eq $probe) { break }
                $probe = $parent
            }
            $roots += [pscustomobject]@{ AppRoot = $appRoot; SourceRoot = $full }
        }
    }
    else {
        foreach ($app in @(Find-DocsAppFolders -Root $RepoRoot)) {
            $roots += [pscustomobject]@{ AppRoot = $app; SourceRoot = $app }
        }
        if (-not $roots) {
            throw "No app.json found below $RepoRoot. Pass -SourcePath (for example -SourcePath app/src)."
        }
    }
    return $roots
}

<#
.SYNOPSIS
    Write text as UTF-8 without BOM and with LF line endings, identically in PowerShell 5.1 and 7.
#>
function Write-DocsUtf8File {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][AllowEmptyString()][string]$Text
    )
    $full = [System.IO.Path]::GetFullPath($Path)
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($full, (($Text -replace "`r`n", "`n").TrimEnd("`n") + "`n"), $encoding)
}

function Get-DocsGitCommit {
    param([Parameter(Mandatory)][string]$RepoRoot)
    try {
        $sha = (& git -C $RepoRoot rev-parse --short HEAD 2>$null)
        if ($LASTEXITCODE -eq 0 -and $sha) { return ($sha | Select-Object -First 1).Trim() }
    }
    catch { }
    return $null
}

function Test-DocsProperty {
    param($Object, [Parameter(Mandatory)][string]$Name)
    if ($null -eq $Object) { return $false }
    if ($Object -is [hashtable]) { return $Object.ContainsKey($Name) }
    return [bool]($Object.PSObject.Properties.Name -contains $Name)
}

function Get-DocsProperty {
    param($Object, [Parameter(Mandatory)][string]$Name, $Default = $null)
    if (Test-DocsProperty -Object $Object -Name $Name) {
        if ($Object -is [hashtable]) { return $Object[$Name] }
        return $Object.$Name
    }
    return $Default
}
