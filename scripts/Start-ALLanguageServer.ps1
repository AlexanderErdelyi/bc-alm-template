<#
.SYNOPSIS
    Launches Microsoft's AL Language Server (LSP) for this repo so an autonomous agent or
    editor can drive AL code intelligence (go-to-definition, find-references across app/ +
    test/, rename, type hierarchy) over JSON-RPC on stdio.

.DESCRIPTION
    Wraps `al launchlspserver` (ALTool) with arguments tuned to this template's two-project
    layout. Both projects are passed positionally so cross-project find-references resolves
    `internalsVisibleTo` / `propagateDependencies`, and the per-project symbol caches are
    supplied via --packagecachepath.

    An LSP *host* (the agent runtime or editor) normally spawns the AL server itself and talks
    to it over stdio. IMPORTANT: a host must invoke `al launchlspserver` **directly** — do NOT
    place this PowerShell wrapper in the host's stdio path, because an intermediate shell
    applies text-mode/encoding translation that corrupts the binary JSON-RPC framing. Run this
    script directly only to smoke-test the server interactively, or to print the exact `al`
    invocation (emitted to stderr) to copy into your host's language-server configuration.

    Requires the AL Development Tools package (provides the `al` command) AND a build new
    enough to expose `launchlspserver`. The verb currently ships only in PRERELEASE/beta
    builds (verified working on 18.0.37-beta; the latest *stable* channel is 17.x and does
    NOT have it), so install / update with --prerelease:
        dotnet tool install  --global Microsoft.Dynamics.BusinessCentral.Development.Tools --prerelease
        dotnet tool update   --global Microsoft.Dynamics.BusinessCentral.Development.Tools --prerelease

    A reachable package cache (.app symbols) is required for full language intelligence. Use
    VS Code's "AL: Download Symbols" or fetch from the public feed first
    (see docs/al-agent-tools.md).

.PARAMETER RepoRoot
    Repository root. Defaults to the parent of this script's folder.

.PARAMETER WorkspaceFile
    The multi-root .code-workspace file. Defaults to bc-alm-template.code-workspace.

.PARAMETER LogLevel
    ALTool log level: Debug, Verbose, Normal (default), Warning, Error.

.EXAMPLE
    pwsh ./scripts/Start-ALLanguageServer.ps1

.LINK
    https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-al-tool#al-lsp
#>
[CmdletBinding()]
param(
    [string] $RepoRoot = (Split-Path $PSScriptRoot -Parent),
    [string] $WorkspaceFile = 'bc-alm-template.code-workspace',
    [ValidateSet('Debug', 'Verbose', 'Normal', 'Warning', 'Error')]
    [string] $LogLevel = 'Normal'
)

$ErrorActionPreference = 'Stop'

# --- locate the `al` command ---
$al = Get-Command al -ErrorAction SilentlyContinue
if (-not $al) {
    $fallback = Join-Path $env:USERPROFILE '.dotnet\tools\al.exe'
    if (Test-Path $fallback) { $al = $fallback } else {
        throw "The 'al' command was not found. Install it with: dotnet tool install --global Microsoft.Dynamics.BusinessCentral.Development.Tools"
    }
}
$alPath = if ($al -is [System.Management.Automation.CommandInfo]) { $al.Source } else { [string]$al }

# --- verify launchlspserver is available in this ALTool build ---
# Out-String collapses the multi-line help to a single string so -match returns a scalar
# boolean (on an array, -notmatch returns non-matching elements and is always truthy here).
$help = (& $alPath --help 2>&1 | Out-String)
if ($help -notmatch 'launchlspserver') {
    Write-Warning "This ALTool build does not expose 'launchlspserver'."
    Write-Warning "It currently ships only in PRERELEASE builds (verified on 18.0.37-beta; stable 17.x lacks it)."
    Write-Warning "Update it with: dotnet tool update --global Microsoft.Dynamics.BusinessCentral.Development.Tools --prerelease"
    throw "launchlspserver not supported by the installed 'al' tool."
}

# --- resolve project folders + symbol caches ---
$appProj = Join-Path $RepoRoot 'app'
$testProj = Join-Path $RepoRoot 'test'
$wsPath = Join-Path $RepoRoot $WorkspaceFile

$caches = @()
foreach ($p in @($appProj, $testProj)) {
    $c = Join-Path $p '.alpackages'
    if (Test-Path $c) { $caches += $c }
}
if (-not $caches) {
    Write-Warning "No .alpackages symbol cache found under app/ or test/. AL LSP needs symbols."
    Write-Warning "Run 'AL: Download Symbols' in VS Code or fetch from the feed (see docs/al-agent-tools.md)."
}

$alArgs = @('launchlspserver', $appProj, $testProj, '--loglevel', $LogLevel)
if (Test-Path $wsPath) { $alArgs += @('--workspacefile', $wsPath) }
if ($caches) { $alArgs += @('--packagecachepath', ($caches -join ';')) }

# Banners go to STDERR so stdout stays a pure JSON-RPC stream if this is ever piped.
[Console]::Error.WriteLine("Launching AL LSP server (stdio JSON-RPC). Press Ctrl+C to stop.")
[Console]::Error.WriteLine("Host config should invoke this command DIRECTLY (not via this script):")
[Console]::Error.WriteLine(("  {0} {1}" -f $alPath, ($alArgs -join ' ')))
& $alPath @alArgs
