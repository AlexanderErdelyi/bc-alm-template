<#
.SYNOPSIS
    Adds Microsoft's BCQuality knowledge base (https://github.com/microsoft/BCQuality)
    to this repository so the AL review skills can consume it.

.DESCRIPTION
    BCQuality is an MIT-licensed, machine-readable knowledge base + skills library for
    Business Central. The 'bc-review-self' skill (used by bc-dev and bc-pr) can invoke
    its skills/entry.md to back AL review with Microsoft- and community-curated rules.

    Two modes:
      * vendor    (default) - shallow-clone BCQuality and copy its content into
                  vendor/bcquality WITHOUT a nested .git, so the files are tracked in
                  this repo (works offline; you edit vendor/bcquality/custom/ directly).
                  Re-run with -Update to refresh microsoft/ + community/ + skills/ +
                  tools/ while PRESERVING your vendor/bcquality/custom/ files.
      * submodule - register BCQuality as a git submodule at vendor/bcquality. Stays
                  linked to upstream; to own the custom layer, point the submodule at
                  your own fork of BCQuality.

    After it lands, build the knowledge index the review skills read:
        pwsh ./vendor/bcquality/tools/Build-KnowledgeIndex.ps1

.PARAMETER Mode
    'vendor' (default), 'submodule', or 'off' (remove a previously vendored copy).

.PARAMETER Ref
    Git ref (branch/tag) of BCQuality to fetch. Default 'main'.

.PARAMETER Path
    Destination folder. Default 'vendor/bcquality'.

.PARAMETER Update
    For -Mode vendor: refresh upstream layers, keep the local custom/ layer.

.PARAMETER BuildIndex
    Run Build-KnowledgeIndex.ps1 after fetching (default $true).

.EXAMPLE
    pwsh ./scripts/Add-BCQuality.ps1 -Mode vendor

.EXAMPLE
    pwsh ./scripts/Add-BCQuality.ps1 -Mode submodule

.EXAMPLE
    pwsh ./scripts/Add-BCQuality.ps1 -Mode vendor -Update
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [ValidateSet('vendor', 'submodule', 'off')]
    [string] $Mode = 'vendor',

    [string] $Ref = 'main',

    [string] $Path = 'vendor/bcquality',

    [switch] $Update,

    [bool] $BuildIndex = $true
)

$ErrorActionPreference = 'Stop'
$RepoUrl = 'https://github.com/microsoft/BCQuality.git'

# Resolve repo root (script lives in scripts/)
$repoRoot = Split-Path -Parent $PSScriptRoot
$destFull = Join-Path $repoRoot $Path
$customRel = 'custom'

function Assert-Git {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        throw "git is required but was not found on PATH."
    }
}

function Update-ConfigFlag([string] $mode) {
    $cfgPath = Join-Path $repoRoot 'template.config.json'
    if (-not (Test-Path $cfgPath)) { return }
    try {
        $cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
    } catch {
        Write-Warning "Could not parse template.config.json; skipping config update."
        return
    }
    if (-not $cfg.values) { return }
    $enabled = ($mode -ne 'off')
    if ($cfg.values.PSObject.Properties.Name -contains 'bcQuality') {
        $cfg.values.bcQuality.enabled = $enabled
        $cfg.values.bcQuality.mode = $mode
        $cfg.values.bcQuality.path = $Path
    } else {
        $cfg.values | Add-Member -NotePropertyName 'bcQuality' -NotePropertyValue ([pscustomobject]@{
            enabled = $enabled; mode = $mode; path = $Path
        })
    }
    if ($PSCmdlet.ShouldProcess($cfgPath, "record bcQuality.mode=$mode")) {
        ($cfg | ConvertTo-Json -Depth 12) | Set-Content $cfgPath -Encoding utf8
    }
}

function Seed-CustomLayer([string] $root) {
    foreach ($d in @("$customRel/knowledge", "$customRel/skills")) {
        $full = Join-Path $root $d
        if (-not (Test-Path $full)) {
            if ($PSCmdlet.ShouldProcess($full, 'create custom-layer folder')) {
                New-Item -ItemType Directory -Force -Path $full | Out-Null
            }
        }
    }
    $readme = Join-Path $root "$customRel/README.md"
    if (-not (Test-Path $readme)) {
        $body = @"
# Custom layer — your organization's BC knowledge

Files here OVERRIDE the microsoft/ and community/ layers (custom > community > microsoft).
Author atomic, remedial knowledge files under ``knowledge/<domain>/<slug>.md`` following
BCQuality's WRITE meta-skill: https://github.com/microsoft/BCQuality/blob/main/skills/write.md

Each knowledge file needs the six required frontmatter fields:
``bc-version``, ``domain``, ``keywords``, ``technologies``, ``countries``, ``application-area``.

After adding files, rebuild the index:

    pwsh ./tools/Build-KnowledgeIndex.ps1
"@
        if ($PSCmdlet.ShouldProcess($readme, 'write custom-layer README')) {
            Set-Content -Path $readme -Value $body -Encoding utf8
        }
    }
}

function Invoke-BuildIndex([string] $root) {
    if (-not $BuildIndex) { return }
    $indexer = Join-Path $root 'tools/Build-KnowledgeIndex.ps1'
    if (Test-Path $indexer) {
        if ($PSCmdlet.ShouldProcess($indexer, 'build knowledge index')) {
            Write-Host "Building knowledge index..." -ForegroundColor Cyan
            & pwsh -NoProfile -File $indexer
        }
    } else {
        Write-Warning "Build-KnowledgeIndex.ps1 not found in the BCQuality checkout; skipping index build."
    }
}

Assert-Git

switch ($Mode) {
    'off' {
        if (Test-Path $destFull) {
            if ($PSCmdlet.ShouldProcess($destFull, 'remove vendored BCQuality')) {
                # If it is a submodule, deregister first
                $gm = Join-Path $repoRoot '.gitmodules'
                if ((Test-Path $gm) -and (Select-String -Path $gm -Pattern ([regex]::Escape($Path)) -Quiet)) {
                    & git -C $repoRoot submodule deinit -f $Path 2>$null
                    & git -C $repoRoot rm -f $Path 2>$null
                } else {
                    Remove-Item -Recurse -Force $destFull
                }
            }
        }
        Update-ConfigFlag 'off'
        Write-Host "BCQuality removed." -ForegroundColor Green
        break
    }

    'submodule' {
        if (Test-Path (Join-Path $destFull '.git')) {
            Write-Host "Submodule already present at $Path. Updating..." -ForegroundColor Cyan
            if ($PSCmdlet.ShouldProcess($Path, 'submodule update --remote')) {
                & git -C $repoRoot submodule update --init --remote -- $Path
            }
        } else {
            if ($PSCmdlet.ShouldProcess($Path, "git submodule add $RepoUrl")) {
                & git -C $repoRoot submodule add -b $Ref $RepoUrl $Path
                & git -C $repoRoot submodule update --init -- $Path
            }
        }
        Update-ConfigFlag 'submodule'
        Invoke-BuildIndex $destFull
        Write-Host "BCQuality added as a submodule at $Path." -ForegroundColor Green
        Write-Host "To own the custom layer, point this submodule at your own fork of BCQuality." -ForegroundColor Yellow
        break
    }

    'vendor' {
        $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("bcquality_" + [guid]::NewGuid().ToString('N'))
        try {
            if ($PSCmdlet.ShouldProcess($RepoUrl, "shallow clone ($Ref)")) {
                Write-Host "Cloning BCQuality ($Ref)..." -ForegroundColor Cyan
                & git clone --depth 1 --branch $Ref $RepoUrl $tmp
            }
            if (-not (Test-Path $tmp) -and -not $WhatIfPreference) {
                throw "Clone failed: $tmp not created."
            }

            # Preserve an existing custom layer on update
            $preserved = $null
            $existingCustom = Join-Path $destFull $customRel
            if ($Update -and (Test-Path $existingCustom)) {
                $preserved = Join-Path ([System.IO.Path]::GetTempPath()) ("bcq_custom_" + [guid]::NewGuid().ToString('N'))
                Copy-Item -Recurse -Force $existingCustom $preserved
                Write-Host "Preserved existing custom/ layer." -ForegroundColor Cyan
            }

            if (Test-Path $destFull) {
                if ($PSCmdlet.ShouldProcess($destFull, 'replace upstream layers')) {
                    Remove-Item -Recurse -Force $destFull
                }
            }
            if ($PSCmdlet.ShouldProcess($destFull, 'copy BCQuality content (without .git)')) {
                New-Item -ItemType Directory -Force -Path $destFull | Out-Null
                Get-ChildItem -Force $tmp | Where-Object { $_.Name -ne '.git' } |
                    ForEach-Object { Copy-Item -Recurse -Force $_.FullName (Join-Path $destFull $_.Name) }
            }

            # Restore preserved custom layer
            if ($preserved) {
                $target = Join-Path $destFull $customRel
                if (Test-Path $target) { Remove-Item -Recurse -Force $target }
                Copy-Item -Recurse -Force $preserved $target
                Remove-Item -Recurse -Force $preserved
            }

            Seed-CustomLayer $destFull
            Update-ConfigFlag 'vendor'
            Invoke-BuildIndex $destFull
            Write-Host "BCQuality vendored into $Path (tracked in this repo)." -ForegroundColor Green
            Write-Host "Add org-specific rules under $Path/custom/knowledge/ and rebuild the index." -ForegroundColor Yellow
        } finally {
            if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }
        }
        break
    }
}
