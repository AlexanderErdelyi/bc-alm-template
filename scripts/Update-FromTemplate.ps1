<#
.SYNOPSIS
    Updates the template-managed files in THIS repo from the latest
    bc-alm-template (the "update from template" flow, run locally).

.DESCRIPTION
    Fetches the template's default branch into a temporary clone and refreshes the
    files the template owns - agents, skills, instructions, workflows, meta-docs,
    scripts, and the shared .vscode files. Your project-owned files are never
    touched: AL source (app/, test/), your specs, PROJECT.md, template.config.json,
    copilot-instructions.md, and the token-injected .vscode files (launch.json,
    mcp.json, settings.json).

    The 'sync' block in template.config.json steers the refresh so it respects your
    project's choices:

      * customizationsPath - '.' keeps the VS Code-discoverable customizations
        (.github/agents, .github/skills, .github/prompts, .github/instructions and
        the agent meta-docs) at the repo root (default). Set it to a subfolder (e.g.
        'app') and those are refreshed under <path>/.github instead. GitHub platform
        files (.github/workflows, ISSUE_TEMPLATE, PULL_REQUEST_TEMPLATE) always stay
        at the repo root.
      * updateModels     - false (default) re-applies your agent 'model:' choices
        from template.config.json after the refresh, so you get template prompt/
        handoff improvements but keep your own models. true accepts the template's.
      * updateExtensions - false (default) leaves .vscode/extensions.json (your
        toolset) untouched. true pulls the template's recommended list.
      * updateInstructions - true (default) refreshes .github/instructions. false
        keeps your edited AL coding standards.
      * include           - per-category on/off switches (metaDocs, referenceDocs,
        issueOps, specs, prTemplate). A category set to false is never refreshed or
        re-added, so an existing repo that opted out of, say, the docs/ library or
        the GitHub issue-ops pipeline stays that way across every sync.
      * components        - per-component policy shared with the BC ALM VS Code
        extension: 'disabled' (never installed/updated) and 'keepLocal' (keep your
        version, never updated). Ids look like agent:bc-dev, skill:bc-spec-author,
        prompt:onboard-app, instruction:al-coding-standards, doc:<name>,
        workflow:<name> or file:<path>.

    template.lock.json (written by this script and by the VS Code extension) records
    which template commit each file came from. When it exists:

      * The template URL/branch default to the lock's primary source (your fork or
        own template), unless -TemplateUrl / -Branch are passed.
      * Files you changed since the last sync are KEPT and reported instead of being
        overwritten (merge them in the extension, or pass -OverwriteLocalChanges).
      * Files of components you never installed are not added.
    Without a lock (first run) the template wins as before, and the lock is created.

    After the refresh, your 'values' choices are re-applied so a sync never reverts
    the initialization:

      * prefix / ticket prefix / repo slug / ADO org / object-ID range / work-item
        linking - the template ships its own placeholders (ABC, AB#, 50100-50199,
        AlexanderErdelyi/bc-alm-template, ...), so every refreshed prose/customization
        file is re-parameterized from template.config.json 'values'. This mirrors the
        initializer's token replacement. Scripts and the template-sync workflow are left
        as-is (the workflow's slug guard must keep pointing at the template).
      * extraTools - project-specific tool IDs merged (additive, de-duplicated) into
        every agent + prompt 'tools:' list. 'all' applies everywhere; 'agents'/'prompts'
        add per-file extras keyed by file name (e.g. 'bc-dev', 'onboard-app'). This is
        how custom MCP servers stay in the toolsets after the template files are
        overwritten. Also, when workItemSystem = GitHub, the azure-devops/* group the
        template ships is trimmed back out of the agent/prompt toolsets.

    This mirrors the split used by the GitHub Action
    (.github/workflows/template-sync.yml), which runs this same script. Use the
    Action for automatic PRs; use this script to pull updates on demand.

    Nothing is committed. After it runs, review 'git diff' and commit what you want.

    Catalog repositories hold several templates: the root one plus .templates/<id>/ folders.
    -TemplatePath (or the lock source's "path") selects one. A template whose
    template.config.json has "template.extends" is a variant: it starts from its base,
    replaces every component it ships its own files for, and drops the component ids
    listed in "template.remove".

.EXAMPLE
    pwsh ./scripts/Update-FromTemplate.ps1 -WhatIf

.EXAMPLE
    pwsh ./scripts/Update-FromTemplate.ps1

.EXAMPLE
    pwsh ./scripts/Update-FromTemplate.ps1 -OverwriteLocalChanges

.EXAMPLE
    pwsh ./scripts/Update-FromTemplate.ps1 -TemplateUrl https://github.com/AlexanderErdelyi/bc-alm-template.git -Branch main

.EXAMPLE
    pwsh ./scripts/Update-FromTemplate.ps1 -TemplateUrl https://github.com/my-org/bc-templates.git -TemplatePath .templates/bc-upgrade
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string] $TemplateUrl = 'https://github.com/AlexanderErdelyi/bc-alm-template.git',
    [string] $Branch = 'main',
    # Folder of the template inside the repository for catalog repositories (e.g. .templates/bc-upgrade).
    # Default: the lock's primary source path, else the repository root.
    [string] $TemplatePath = '',
    # Repository root. Default: the folder above scripts/ (or above .bc-alm/scripts/).
    [string] $RepoRoot = '',
    [switch] $OverwriteLocalChanges,
    # Keep config, lock and scripts at the repo root instead of moving them into .bc-alm/.
    [switch] $ClassicLayout
)

$ErrorActionPreference = 'Stop'
if (-not $RepoRoot) {
    $RepoRoot = if ((Split-Path (Split-Path $PSScriptRoot -Parent) -Leaf) -eq '.bc-alm') { Join-Path $PSScriptRoot '../..' } else { Join-Path $PSScriptRoot '..' }
}
# Long-path form (Resolve-Path / $env:TEMP can return 8.3 names like AERDEL~1).
$RepoRoot = (Get-Item -LiteralPath (Resolve-Path $RepoRoot).Path).FullName

# --- .bc-alm/ layout (mirrors core/layout.ts in the BC ALM VS Code extension) ----------
# Projects keep the BC ALM bookkeeping in one folder instead of the repo root:
#   .bc-alm/template.config.json, .bc-alm/template.lock.json, .bc-alm/scripts/*.ps1,
#   .bc-alm/.templatesyncignore, .bc-alm/PROJECT.md
# The template repository itself keeps the classic root layout.
$bcAlmScripts = @('Initialize-Template', 'Add-BCQuality', 'Start-ALLanguageServer', 'Update-FromTemplate', 'Enable-CopilotCustomizations', 'Install-IntoExistingRepo')

# Rewrite mentions of scripts/X.ps1, template.config.json, template.lock.json and
# .templatesyncignore to their .bc-alm/ location. $depth = folders the file was relocated by
# (customizationsPath), so relative links still resolve. Idempotent.
function ConvertTo-BcAlmLayout([string] $text, [int] $depth = 0) {
    if (-not $text) { return $text }
    $pattern = '(?<![A-Za-z0-9_.\\/-])((?:\.\.?[/\\])*|\$\{workspaceFolder\}[/\\])(?:scripts([/\\])(' + ($bcAlmScripts -join '|') + ')\.ps1|template\.(config|lock)\.json|\.templatesyncignore)'
    $ms = [regex]::Matches($text, $pattern)
    if ($ms.Count -eq 0) { return $text }
    $sb = New-Object System.Text.StringBuilder
    $pos = 0
    foreach ($m in $ms) {
        [void]$sb.Append($text, $pos, $m.Index - $pos)
        $prefix = $m.Groups[1].Value
        $sep = if ($prefix.EndsWith('\')) { '\' } else { '/' }
        $up = if ($depth -gt 0 -and ($prefix.StartsWith('${workspaceFolder}') -or $prefix.StartsWith('..'))) { "..$sep" * $depth } else { '' }
        $rest = if ($m.Groups[3].Success) { 'scripts' + $m.Groups[2].Value + $m.Groups[3].Value + '.ps1' }
                elseif ($m.Groups[4].Success) { 'template.' + $m.Groups[4].Value + '.json' }
                else { '.templatesyncignore' }
        [void]$sb.Append($prefix + $up + '.bc-alm' + $sep + $rest)
        $pos = $m.Index + $m.Length
    }
    [void]$sb.Append($text, $pos, $text.Length - $pos)
    return $sb.ToString()
}

function Get-BcAlmHash([string] $path) {
    $enc = New-Object System.Text.UTF8Encoding($false)
    $t = [System.IO.File]::ReadAllText($path, $enc)
    if ($t.Length -gt 0 -and $t[0] -eq [char]0xFEFF) { $t = $t.Substring(1) }
    $t = $t.Replace("`r`n", "`n").Replace("`r", "`n")
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return -join ($sha.ComputeHash($enc.GetBytes($t)) | ForEach-Object { $_.ToString('x2') }) }
    finally { $sha.Dispose() }
}

# Move config, lock, scripts, .templatesyncignore and PROJECT.md of a classic-layout project
# into .bc-alm/, rename the lock keys and fix the links that pointed at the old locations.
# Same steps as migrateToBcAlm() + the sync-workflow fix in the VS Code extension.
function Move-ToBcAlmLayout([string] $root) {
    $enc = New-Object System.Text.UTF8Encoding($false)
    $sd = Join-Path $root '.bc-alm'
    $cr = ''
    try {
        $c = [System.IO.File]::ReadAllText((Join-Path $root 'template.config.json'), $enc) | ConvertFrom-Json
        $cp = [string]$c.values.sync.customizationsPath
        if ($cp -and $cp -ne '.') { $cr = $cp.Trim().TrimEnd('/', '\').Replace('\', '/') }
    } catch { }
    $moved = New-Object System.Collections.Generic.List[string]
    $mv = {
        param([string] $from, [string] $to)
        $f = Join-Path $root $from
        if (-not (Test-Path -LiteralPath $f -PathType Leaf)) { return $false }
        $t = Join-Path $root $to
        $d = Split-Path $t -Parent
        if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
        Move-Item -LiteralPath $f -Destination $t -Force
        $moved.Add("$from -> $to")
        return $true
    }
    [void](& $mv 'template.config.json' '.bc-alm/template.config.json')
    [void](& $mv 'template.lock.json' '.bc-alm/template.lock.json')
    [void](& $mv '.templatesyncignore' '.bc-alm/.templatesyncignore')
    if (-not (& $mv 'PROJECT.md' '.bc-alm/PROJECT.md') -and $cr) { [void](& $mv "$cr/PROJECT.md" '.bc-alm/PROJECT.md') }
    foreach ($n in $bcAlmScripts) { [void](& $mv "scripts/$n.ps1" ".bc-alm/scripts/$n.ps1") }
    $sdir = Join-Path $root 'scripts'
    if ((Test-Path -LiteralPath $sdir) -and -not (Get-ChildItem -LiteralPath $sdir -Force)) { Remove-Item -LiteralPath $sdir -Force }

    # Lock keys: scripts/X.ps1 and .templatesyncignore now live under .bc-alm/ (kept sorted ordinally).
    $lockFile = Join-Path $sd 'template.lock.json'
    if (Test-Path -LiteralPath $lockFile) {
        $lt = [System.IO.File]::ReadAllText($lockFile, $enc)
        $keyRe = '^(scripts/(?:' + ($bcAlmScripts -join '|') + ')\.ps1|\.templatesyncignore)$'
        $fm = [regex]::Match($lt, '(?s)(\r?\n  "files": \{\r?\n)(.*?)(\r?\n  \}\r?\n?\}\s*)$')
        if ($fm.Success) {
            $entries = [regex]::Matches($fm.Groups[2].Value, '(?s)    "((?:[^"\\]|\\.)*)": \{.*?\r?\n    \}')
            $sorted = New-Object 'System.Collections.Generic.SortedDictionary[string,string]' ([System.StringComparer]::Ordinal)
            foreach ($en in $entries) {
                $k = $en.Groups[1].Value
                $nk = if ($k -match $keyRe) { ".bc-alm/$k" } else { $k }
                $sorted[$nk] = '    "' + $nk + '"' + $en.Value.Substring($k.Length + 6)
            }
            $nl = if ($lt.Contains("`r`n")) { "`r`n" } else { "`n" }
            $body = @($sorted.Values) -join (',' + $nl)
            $lt = $lt.Substring(0, $fm.Index) + $fm.Groups[1].Value + $body + $fm.Groups[3].Value
            [System.IO.File]::WriteAllText($lockFile, $lt, $enc)
        }
    }

    # README links to PROJECT.md and the update script.
    $readmes = @('README.md'); if ($cr) { $readmes += "$cr/README.md" }
    foreach ($r in $readmes) {
        $f = Join-Path $root $r
        if (-not (Test-Path -LiteralPath $f -PathType Leaf)) { continue }
        $t = [System.IO.File]::ReadAllText($f, $enc)
        $up = '../' * ($r.Split('/').Count - 1)
        $n = [regex]::Replace($t, '\]\((?:\./)?PROJECT\.md\)', "](${up}.bc-alm/PROJECT.md)")
        $n = [regex]::Replace($n, '(?<![A-Za-z0-9_.\\/-])((?:\./)?)scripts/Update-FromTemplate\.ps1', '$1.bc-alm/scripts/Update-FromTemplate.ps1')
        if ($n -ne $t) { [System.IO.File]::WriteAllText($f, $n, $enc); $moved.Add("$r (links)") }
    }

    # The sync workflow must call the moved script (fixed even when edited; the old path is gone).
    $wf = Join-Path $root '.github/workflows/template-sync.yml'
    if (Test-Path -LiteralPath $wf -PathType Leaf) {
        $t = [System.IO.File]::ReadAllText($wf, $enc)
        if (-not $t.Contains('.bc-alm/scripts/Update-FromTemplate.ps1')) {
            $before = Get-BcAlmHash $wf
            $n = [regex]::Replace($t, '(?<![A-Za-z0-9_.\\/-])\./scripts/Update-FromTemplate\.ps1', './.bc-alm/scripts/Update-FromTemplate.ps1')
            if ($n -ne $t) {
                [System.IO.File]::WriteAllText($wf, $n, $enc)
                $moved.Add('.github/workflows/template-sync.yml (script path)')
                if (Test-Path -LiteralPath $lockFile) {
                    $after = Get-BcAlmHash $wf
                    $lt = [System.IO.File]::ReadAllText($lockFile, $enc)
                    $em = [regex]::Match($lt, '(?s)"\.github/workflows/template-sync\.yml": \{.*?"installedHash": "([0-9a-f]+)"')
                    if ($em.Success -and $em.Groups[1].Value -eq $before) {
                        $g = $em.Groups[1]
                        $lt = $lt.Substring(0, $g.Index) + $after + $lt.Substring($g.Index + $g.Length)
                        [System.IO.File]::WriteAllText($lockFile, $lt, $enc)
                    }
                }
            }
        }
    }
    return $moved
}

# Move a classic-layout project (config/lock/scripts at the root) into .bc-alm/ first.
$stateDir = ''
if (Test-Path -LiteralPath (Join-Path $RepoRoot '.bc-alm/template.config.json')) { $stateDir = '.bc-alm' }
elseif (-not $ClassicLayout -and (Test-Path -LiteralPath (Join-Path $RepoRoot 'template.config.json'))) {
    $rootCfg = $null
    try { $rootCfg = Get-Content (Join-Path $RepoRoot 'template.config.json') -Raw | ConvertFrom-Json } catch { }
    if ($rootCfg -and $rootCfg.PSObject.Properties['initialized'] -and [bool]$rootCfg.initialized -and
        $PSCmdlet.ShouldProcess($RepoRoot, 'Move config, lock and scripts into .bc-alm/')) {
        Write-Host "Moving BC ALM files into .bc-alm/" -ForegroundColor Cyan
        foreach ($m in (Move-ToBcAlmLayout $RepoRoot)) { Write-Host "  moved      $m" -ForegroundColor DarkGray }
        $stateDir = '.bc-alm'
    }
}
$stateRoot = if ($stateDir) { Join-Path $RepoRoot $stateDir } else { $RepoRoot }

# --- Read the sync configuration (template.config.json 'values.sync') ------------
$sync = [pscustomobject]@{
    customizationsPath = '.'
    syncWorkflow       = $true
    updateModels       = $false
    updateExtensions   = $false
    updateInstructions = $true
    include            = [pscustomobject]@{
        metaDocs      = $true
        referenceDocs = $true
        issueOps      = $true
        specs         = $true
        prTemplate    = $true
    }
}
$policyDisabled = @(); $policyKeep = @(); $policyTplDisabled = @()
$config = $null
$configPath = Join-Path $stateRoot 'template.config.json'
if (Test-Path $configPath) {
    try { $config = Get-Content $configPath -Raw | ConvertFrom-Json } catch { $config = $null }
    if ($config -and $config.values -and $config.values.sync) {
        $s = $config.values.sync
        if ($s.PSObject.Properties['customizationsPath'] -and $s.customizationsPath) { $sync.customizationsPath = [string]$s.customizationsPath }
        if ($s.PSObject.Properties['syncWorkflow'])       { $sync.syncWorkflow       = [bool]$s.syncWorkflow }
        if ($s.PSObject.Properties['updateModels'])       { $sync.updateModels       = [bool]$s.updateModels }
        if ($s.PSObject.Properties['updateExtensions'])   { $sync.updateExtensions   = [bool]$s.updateExtensions }
        if ($s.PSObject.Properties['updateInstructions']) { $sync.updateInstructions = [bool]$s.updateInstructions }
        if ($s.PSObject.Properties['include'] -and $s.include) {
            foreach ($k in 'metaDocs', 'referenceDocs', 'issueOps', 'specs', 'prTemplate') {
                if ($s.include.PSObject.Properties[$k]) { $sync.include.$k = [bool]$s.include.$k }
            }
        }
        if ($s.PSObject.Properties['components'] -and $s.components) {
            $c = $s.components
            if ($c.PSObject.Properties['disabled'])  { $policyDisabled = @($c.disabled  | Where-Object { $_ } | ForEach-Object { [string]$_ }) }
            if ($c.PSObject.Properties['keepLocal']) { $policyKeep     = @($c.keepLocal | Where-Object { $_ } | ForEach-Object { [string]$_ }) }
        }
        if ($s.PSObject.Properties['templates'] -and $s.templates -and $s.templates.PSObject.Properties['disabled']) {
            $policyTplDisabled = @($s.templates.disabled | Where-Object { $_ } | ForEach-Object { ([string]$_).Trim().ToLowerInvariant() })
        }
    }
}

# Folder that holds the VS Code-discoverable customizations. '' = repo root.
$custRoot = ''
if ($sync.customizationsPath -and $sync.customizationsPath -ne '.') {
    $custRoot = $sync.customizationsPath.Trim().TrimEnd('/', '\')
}

Write-Host "Sync config: customizationsPath='$($sync.customizationsPath)', syncWorkflow=$($sync.syncWorkflow), updateModels=$($sync.updateModels), updateExtensions=$($sync.updateExtensions), updateInstructions=$($sync.updateInstructions)" -ForegroundColor DarkGray
$inc = $sync.include
Write-Host "  include: metaDocs=$($inc.metaDocs), referenceDocs=$($inc.referenceDocs), issueOps=$($inc.issueOps), specs=$($inc.specs), prTemplate=$($inc.prTemplate)" -ForegroundColor DarkGray

# --- Template-managed paths ------------------------------------------------------
# Customization trees are VS Code-discoverable and follow customizationsPath.
$customTrees = @(
    '.github/agents',
    '.github/skills',
    '.github/prompts'
)
if ($sync.updateInstructions) { $customTrees += '.github/instructions' }

# Root-only trees always land at the repo root (GitHub reads them there). Optional
# content categories are gated by sync.include so excluded content is never re-added.
$rootTrees = @()
if ($inc.referenceDocs) { $rootTrees += 'docs' }
if ($inc.specs)         { $rootTrees += 'specs/_TEMPLATE' }
if ($inc.issueOps)      { $rootTrees += '.github/ISSUE_TEMPLATE' }

# Core files always refreshed (shared scripts/config).
$rootFiles = @(
    'scripts/Initialize-Template.ps1',
    'scripts/Add-BCQuality.ps1',
    'scripts/Start-ALLanguageServer.ps1',
    'scripts/Update-FromTemplate.ps1',
    'scripts/Enable-CopilotCustomizations.ps1',
    'scripts/Install-IntoExistingRepo.ps1',
    '.vscode/tasks.json'
)
# GitHub Actions template-sync machinery (skipped for Azure DevOps-only repos).
if ($sync.syncWorkflow) { $rootFiles += '.github/workflows/template-sync.yml', '.templatesyncignore' }
if ($inc.metaDocs) {
    $rootFiles += '.github/AGENT-ARCHITECTURE.md', '.github/WHEN-TO-USE.md', '.github/SKILLS.md'
}
if ($inc.issueOps) {
    $rootFiles += '.github/ISSUE_ORCHESTRATION.md',
    '.github/workflows/issue-implementation.yml',
    '.github/workflows/issue-orchestrator.yml',
    '.github/workflows/issue-planning.yml'
}
if ($inc.prTemplate)       { $rootFiles += '.github/PULL_REQUEST_TEMPLATE.md' }
if ($sync.updateExtensions) { $rootFiles += '.vscode/extensions.json' }

$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) { throw "git is required but was not found on PATH." }

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
function Read-Text([string] $path) { return [System.IO.File]::ReadAllText($path, $utf8NoBom) }
function Write-Text([string] $path, [string] $text) { [System.IO.File]::WriteAllText($path, $text, $utf8NoBom) }

# LF-normalized sha256 (strip BOM, CRLF/CR -> LF, lowercase hex). Identical to hashText() in
# the BC ALM VS Code extension, so both tools agree on what "unchanged" means in the lock.
function Get-NormHash([string] $path) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
    $text = Read-Text $path
    if ($text.Length -gt 0 -and $text[0] -eq [char]0xFEFF) { $text = $text.Substring(1) }
    $text = $text.Replace("`r`n", "`n").Replace("`r", "`n")
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return -join ($sha.ComputeHash($utf8NoBom.GetBytes($text)) | ForEach-Object { $_.ToString('x2') }) }
    finally { $sha.Dispose() }
}

# Folder of a template in its repository ('' = root). Mirrors templatePath() in the extension.
function Get-TplPath([string] $p) {
    if (-not $p) { return '' }
    return ($p.Trim().Replace('\', '/') -replace '^(\./)+', '' -replace '^/+|/+$', '' -replace '^\.$', '')
}

# Normalized source key: the URL, plus "#<path>" for a template in a catalog subfolder.
# Mirrors normalizeUrl() in the extension (lock entries store url or url#path).
function Get-NormUrl([string] $url) {
    if (-not $url) { return '' }
    $i = $url.IndexOf('#')
    $base = if ($i -ge 0) { $url.Substring(0, $i) } else { $url }
    $base = ($base.Trim().Replace('\', '/') -replace '/+$', '' -replace '(?i)\.git$', '').ToLowerInvariant()
    $p = if ($i -ge 0) { (Get-TplPath $url.Substring($i + 1)).ToLowerInvariant() } else { '' }
    if ($p) { return "$base#$p" } else { return $base }
}
function Get-SourceKey($s) {
    $p = if ($s.PSObject.Properties['path']) { Get-TplPath ([string]$s.path) } else { '' }
    if ($p) { return "$($s.url)#$p" } else { return [string]$s.url }
}

# Component id of a template-relative path (agent:<name>, skill:<folder>, ...). Mirrors
# componentOf() in the VS Code extension; these ids are what sync.components lists.
function Get-ComponentId([string] $srcRel) {
    $r = $srcRel.Replace('\', '/')
    if ($r -cmatch '^\.github/agents/([^/]+)\.agent\.md$') { return "agent:$($Matches[1])" }
    if ($r -cmatch '^\.github/skills/([^/]+)/.+$') { return "skill:$($Matches[1])" }
    if ($r -cmatch '^\.github/prompts/([^/]+)\.prompt\.md$') { return "prompt:$($Matches[1])" }
    if ($r -cmatch '^\.github/instructions/([^/]+)\.instructions\.md$') { return "instruction:$($Matches[1])" }
    if ($r -cmatch '^\.github/workflows/([^/]+)\.ya?ml$') { return "workflow:$($Matches[1])" }
    if ($r -cmatch '^docs/([^/]+?)(\.md)?(/.*)?$') { return "doc:$($Matches[1])" }
    return "file:$r"
}

# --- template.lock.json (shared with the VS Code extension) ----------------------
# Records, per installed file, the template commit + raw template hash + the hash of what
# was installed. With it, a sync can tell "you never touched this file" (safe to update)
# from "you edited this file" (kept, reported). Without it (first run) the template wins,
# as before, and the lock is created so later syncs are protected.
$lockPath = Join-Path $stateRoot 'template.lock.json'
$hasLock = Test-Path -LiteralPath $lockPath
$lockSources = New-Object System.Collections.Generic.List[object]
$lockFiles = New-Object System.Collections.Hashtable ([System.StringComparer]::Ordinal)
if ($hasLock) {
    try { $lockJson = (Read-Text $lockPath) | ConvertFrom-Json }
    catch { throw "template.lock.json is not valid JSON: $($_.Exception.Message)" }
    foreach ($s in @($lockJson.sources)) {
        if (-not ($s -and $s.url)) { continue }
        $o = [ordered]@{}
        if ($s.PSObject.Properties['name'] -and $s.name) { $o.name = [string]$s.name }
        if ($s.PSObject.Properties['id'] -and $s.id) { $o.id = [string]$s.id }
        $o.url = [string]$s.url
        if ($s.PSObject.Properties['path'] -and (Get-TplPath ([string]$s.path))) { $o.path = Get-TplPath ([string]$s.path) }
        $o.ref = if ($s.PSObject.Properties['ref'] -and $s.ref) { [string]$s.ref } else { 'main' }
        if ($s.PSObject.Properties['exclude'] -and $null -ne $s.exclude) { $o.exclude = @($s.exclude | Where-Object { $_ } | ForEach-Object { [string]$_ }) }
        $lockSources.Add([pscustomobject]$o)
    }
    if ($lockJson.files) {
        foreach ($p in $lockJson.files.PSObject.Properties) { $lockFiles[$p.Name] = $p.Value }
    }
    # The primary lock source is the template this project tracks (a fork or your own
    # template). Use it unless -TemplateUrl / -Branch were given explicitly.
    if ($lockSources.Count -gt 0) {
        if (-not $PSBoundParameters.ContainsKey('TemplateUrl')) {
            $TemplateUrl = $lockSources[0].url
            if (-not $PSBoundParameters.ContainsKey('TemplatePath') -and $lockSources[0].PSObject.Properties['path']) { $TemplatePath = [string]$lockSources[0].path }
        }
        if (-not $PSBoundParameters.ContainsKey('Branch'))      { $Branch = $lockSources[0].ref }
    }
}
$TemplatePath = Get-TplPath $TemplatePath
if ($TemplatePath -split '/' -contains '..') { throw "Invalid -TemplatePath '$TemplatePath'." }
$sourceKey = if ($TemplatePath) { "$TemplateUrl#$TemplatePath" } else { $TemplateUrl }
$templateKey = Get-NormUrl $sourceKey

if ($policyDisabled.Count -or $policyKeep.Count) {
    Write-Host ("  components: disabled=[{0}], keepLocal=[{1}]" -f ($policyDisabled -join ', '), ($policyKeep -join ', ')) -ForegroundColor DarkGray
}

$temp = Join-Path ([System.IO.Path]::GetTempPath()) ("bc-template-" + [guid]::NewGuid().ToString('N'))
$stage = "$temp-stage"
function Get-SlugId([string] $s) {
    $id = ($s.Trim().ToLowerInvariant() -replace '\.git$', '' -replace '[^a-z0-9._-]+', '-').Trim('-')
    if ($id) { return $id } else { return 'template' }
}
$repoClone = "$temp-repo"
Write-Host "Fetching template $TemplateUrl ($Branch)$(if ($TemplatePath) { " [$TemplatePath]" })..." -ForegroundColor White
& git clone --depth 1 --branch $Branch --quiet $TemplateUrl $repoClone 2>$null
if ($LASTEXITCODE -ne 0) { throw "git clone failed for $TemplateUrl ($Branch)." }
$commit = ([string](& git -C $repoClone rev-parse HEAD)).Trim()

# --- Template view (mirrors TemplateRepo.layout() in the extension) ----------------------
# A catalog repository keeps extra templates in .templates/<id>/. A variant's template.config.json
# has "template.extends" (base id) and optional "template.remove" (component ids). The view is
# assembled base first: a variant that ships any file of a component replaces that whole
# component of its base. $temp then holds exactly the files of the selected template.
function Read-TplConfig([string] $dir) {
    $p = Join-Path $dir 'template.config.json'
    if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { return $null }
    try { return (Read-Text $p | ConvertFrom-Json) } catch { return $null }
}
function Get-LayerFiles([string] $layerPath) {
    $out = [ordered]@{}
    $base = if ($layerPath) { Join-Path $repoClone $layerPath } else { $repoClone }
    if (-not (Test-Path -LiteralPath $base)) { return $out }
    $full = (Get-Item -LiteralPath $base).FullName
    Get-ChildItem -LiteralPath $full -Recurse -File -Force | ForEach-Object {
        $rel = $_.FullName.Substring($full.Length).TrimStart('\', '/').Replace('\', '/')
        if ($rel -match '^\.git/' -or (-not $layerPath -and $rel -match '^\.templates/')) { return }
        $out[$rel] = $_.FullName
    }
    return $out
}
function Find-TemplateLayer([string] $id) {
    $rootCfg = Read-TplConfig $repoClone
    $rootId = if ($rootCfg -and $rootCfg.template -and $rootCfg.template.id) { Get-SlugId ([string]$rootCfg.template.id) } else { Get-SlugId ((($TemplateUrl.Trim() -replace '[\\/]+$', '') -split '[\\/:]')[-1]) }
    if ($rootId -eq $id) { return [pscustomobject]@{ Path = ''; Id = $id; Cfg = $rootCfg } }
    $cat = Join-Path $repoClone '.templates'
    if (Test-Path -LiteralPath $cat) {
        foreach ($d in Get-ChildItem -LiteralPath $cat -Directory) {
            $c = Read-TplConfig $d.FullName
            if ($c -and $c.template -and $c.template.id -and (Get-SlugId ([string]$c.template.id)) -eq $id -and (Get-SlugId $d.Name) -eq $id) {
                return [pscustomobject]@{ Path = ".templates/$($d.Name)"; Id = $id; Cfg = $c }
            }
        }
    }
    return $null
}
$topDir = if ($TemplatePath) { Join-Path $repoClone $TemplatePath } else { $repoClone }
if (-not (Test-Path -LiteralPath $topDir)) { throw "Template folder '$TemplatePath' does not exist in $TemplateUrl ($Branch)." }
$topCfg = Read-TplConfig $topDir
$chain = New-Object System.Collections.Generic.List[object]
$chain.Add([pscustomobject]@{ Path = $TemplatePath; Id = $(if ($topCfg -and $topCfg.template -and $topCfg.template.id) { Get-SlugId ([string]$topCfg.template.id) } else { '' }); Cfg = $topCfg })
$cur = $topCfg
while ($cur -and $cur.template -and $cur.template.PSObject.Properties['extends'] -and $cur.template.extends) {
    $baseId = Get-SlugId ([string]$cur.template.extends)
    $layer = Find-TemplateLayer $baseId
    if (-not $layer) { throw "Template '$($chain[$chain.Count - 1].Id)' extends '$baseId', which is not a template in this repository." }
    if ($chain | Where-Object { $_.Path -eq $layer.Path -or $_.Id -eq $layer.Id }) { throw ("Template inheritance cycle: {0} -> {1}." -f (($chain | ForEach-Object { $_.Id }) -join ' -> '), $layer.Id) }
    $chain.Add($layer)
    $cur = $layer.Cfg
}
$layers = @($chain.ToArray()); [array]::Reverse($layers)
# Placeholder values of the template: its own, else the nearest base that has them.
$tplValues = $null
foreach ($l in $chain) { if ($l.Cfg -and $l.Cfg.PSObject.Properties['values'] -and $l.Cfg.values) { $tplValues = $l.Cfg.values; break } }
$viewFiles = [ordered]@{}
for ($i = 0; $i -lt $layers.Count; $i++) {
    $own = Get-LayerFiles $layers[$i].Path
    if ($i -gt 0) {
        $rm = @(); if ($layers[$i].Cfg -and $layers[$i].Cfg.template -and $layers[$i].Cfg.template.PSObject.Properties['remove']) { $rm = @($layers[$i].Cfg.template.remove | ForEach-Object { [string]$_ }) }
        $ownComps = @($own.Keys | ForEach-Object { Get-ComponentId $_ } | Select-Object -Unique)
        foreach ($rel in @($viewFiles.Keys)) {
            $cid = Get-ComponentId $rel
            if ($rm -contains $cid -or $ownComps -contains $cid) { $viewFiles.Remove($rel) }
        }
    }
    foreach ($k in $own.Keys) { $viewFiles[$k] = $own[$k] }
}
if ($layers.Count -gt 1) { Write-Host ("Variant: {0}" -f (($layers | ForEach-Object { $_.Id }) -join ' -> ')) -ForegroundColor DarkGray }
foreach ($k in $viewFiles.Keys) {
    $to = Join-Path $temp $k
    $d = Split-Path $to -Parent
    if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force -WhatIf:$false | Out-Null }
    Copy-Item -LiteralPath $viewFiles[$k] -Destination $to -Force -WhatIf:$false
}

# Template identity: "template.id" in the template's template.config.json, else the repository
# name. Mirrors manifestOf() in the VS Code extension; sync.templates.disabled lists these ids.
$templateId = $null
$tplCfgPath = Join-Path $temp 'template.config.json'
if (Test-Path -LiteralPath $tplCfgPath) {
    try {
        $tplMeta = (Read-Text $tplCfgPath | ConvertFrom-Json).template
        if ($tplMeta) {
            if ($tplMeta.PSObject.Properties['id'] -and $tplMeta.id) { $templateId = Get-SlugId ([string]$tplMeta.id) }
            elseif ($tplMeta.PSObject.Properties['name'] -and $tplMeta.name) { $templateId = Get-SlugId ([string]$tplMeta.name) }
        }
    } catch { }
}
if (-not $templateId -and $TemplatePath) { $templateId = Get-SlugId (Split-Path $TemplatePath -Leaf) }
if (-not $templateId) { $templateId = Get-SlugId ((($TemplateUrl.Trim() -replace '[\\/]+$', '') -split '[\\/:]')[-1]) }
$templateOff = $policyTplDisabled -contains $templateId
Write-Host "Template id: $templateId$(if ($templateOff) { ' (disabled in this project: its agents, skills, prompts and instructions are skipped)' })" -ForegroundColor DarkGray

$updated = 0; $added = 0; $unchanged = 0; $keptLocal = 0; $notInstalled = 0; $otherSource = 0
$policySkipped = New-Object System.Collections.Generic.HashSet[string]
$staged = New-Object System.Collections.Generic.List[object]
$lockChanged = -not $hasLock

# Map a source-relative path to its destination-relative path (relocating the
# discoverable customizations under $custRoot when configured).
function Resolve-Dest([string] $rel) {
    $r = $rel.Replace('\', '/')
    $relocate = @('.github/AGENT-ARCHITECTURE.md', '.github/WHEN-TO-USE.md', '.github/SKILLS.md')
    if ($custRoot -and ($r -match '^\.github/(agents|skills|prompts|instructions)(/|$)' -or $r -match '^specs(/|$)' -or $r -match '^\.vscode(/|$)' -or $relocate -contains $r)) {
        return "$custRoot/$r"
    }
    if ($stateDir -and ($r -match '^scripts/' -or $r -eq '.templatesyncignore')) { return "$stateDir/$r" }
    return $r
}

# Stage a template file: copy it to the staging folder so the value/model/tool passes can
# run on it BEFORE anything in the repo is touched. The final content is then compared
# against your file and the lock to decide whether it is safe to write.
function Add-Staged([string] $rel) {
    $src = Join-Path $temp $rel
    if (-not (Test-Path -LiteralPath $src -PathType Leaf)) { return }
    $comp = Get-ComponentId $rel
    if ($policyDisabled -contains $comp -or $policyKeep -contains $comp) { [void]$policySkipped.Add($comp); return }
    if ($templateOff -and $comp -match '^(agent|skill|prompt|instruction):') { [void]$policySkipped.Add($comp); return }
    $destRel = Resolve-Dest $rel
    $stagePath = Join-Path $stage $destRel
    $dir = Split-Path $stagePath -Parent
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force -WhatIf:$false | Out-Null }
    Copy-Item -LiteralPath $src -Destination $stagePath -Force -WhatIf:$false
    $staged.Add([pscustomobject]@{ Src = $rel; Dest = $destRel; Stage = $stagePath; Raw = (Get-NormHash $src); Comp = $comp })
}

function Add-StagedTree([string] $relDir) {
    $srcDir = Join-Path $temp $relDir
    if (-not (Test-Path -LiteralPath $srcDir)) { return }
    $base = (Get-Item -LiteralPath $srcDir).FullName
    Get-ChildItem -LiteralPath $base -Recurse -File | ForEach-Object {
        Add-Staged ("$relDir/" + $_.FullName.Substring($base.Length).TrimStart('\', '/').Replace('\', '/'))
    }
}

# Name of a staged agent/prompt ('bc-dev' for .github/agents/bc-dev.agent.md), else $null.
function Get-StagedName($entry, [string] $kind) {
    if ($entry.Src -cmatch "^\.github/$($kind)s/([^/]+)\.$kind\.md$") { return $Matches[1] }
    return $null
}

# Re-apply each agent's 'model:' line from template.config.json (values win over
# the template's defaults) unless the project opted into template model updates.
function Restore-Models {
    if ($sync.updateModels) { return }
    if (-not ($config -and $config.models)) { return }
    foreach ($e in $staged) {
        $name = Get-StagedName $e 'agent'
        if (-not $name -or $name -eq '_readme') { continue }
        $prop = $config.models.PSObject.Properties[$name]
        if (-not $prop) { continue }
        $model = [string]$prop.Value
        $aText = Read-Text $e.Stage
        $newText = [regex]::Replace($aText, '(?m)^model:\s*.*$', ('model: "{0}"' -f $model))
        if ($newText -ne $aText) {
            Write-Text $e.Stage $newText
            Write-Verbose ("model      {0,-16} -> {1}" -f $name, $model)
        }
    }
}

# Add project-specific extra tool IDs (template.config.json values.extraTools) to each
# agent + prompt 'tools:' list. The template ships generic toolsets, so we re-append your
# custom tools (additive, de-duplicated) to keep them across syncs.
function Add-ExtraToolsToFile([string] $filePath, [string[]] $extra) {
    if (-not $extra -or $extra.Count -eq 0 -or -not (Test-Path -LiteralPath $filePath)) { return }
    $text = Read-Text $filePath
    $m = [regex]::Match($text, '(?m)^tools:\s*\[(.*)\]\s*$')
    if (-not $m.Success) { return }
    $existing = @(); foreach ($t in ($m.Groups[1].Value -split ',')) { $tt = $t.Trim().Trim("'`""); if ($tt) { $existing += $tt } }
    $addedTools = @()
    foreach ($e in ($extra | ForEach-Object { $_ -split '\s*,\s*' })) { $en = ([string]$e).Trim().Trim("'`""); if ($en -and ($existing -notcontains $en)) { $existing += $en; $addedTools += $en } }
    if ($addedTools.Count -eq 0) { return }
    $newLine = 'tools: [' + (($existing | ForEach-Object { "'$_'" }) -join ', ') + ']'
    Write-Text $filePath ($text.Replace($m.Value, $newLine))
    Write-Verbose ("tools      {0,-28} += {1}" -f (Split-Path $filePath -Leaf), ($addedTools -join ', '))
}

function Merge-ExtraTools {
    if (-not ($config -and $config.values -and $config.values.PSObject.Properties['extraTools'])) { return }
    $et = $config.values.extraTools
    $all = @(); if ($et.PSObject.Properties['all'] -and $et.all) { $all = @($et.all) }
    $perAgent  = if ($et.PSObject.Properties['agents'])  { $et.agents }  else { $null }
    $perPrompt = if ($et.PSObject.Properties['prompts']) { $et.prompts } else { $null }
    if (-not ($all.Count -or $perAgent -or $perPrompt)) { return }
    foreach ($e in $staged) {
        foreach ($kind in 'agent', 'prompt') {
            $name = Get-StagedName $e $kind
            if (-not $name) { continue }
            $per = if ($kind -eq 'agent') { $perAgent } else { $perPrompt }
            $extra = @($all); if ($per -and $per.PSObject.Properties[$name]) { $extra += @($per.$name) }
            Add-ExtraToolsToFile $e.Stage $extra
        }
    }
}

# Keep GitHub-work-item repos lean: strip the azure-devops/* MCP group the template
# ships in agent/prompt toolsets. Mirrors the initializer's trim.
function Trim-WorkItemTools {
    if (-not ($config -and $config.values -and $config.values.PSObject.Properties['workItemSystem'])) { return }
    if ([string]$config.values.workItemSystem -ne 'GitHub') { return }
    foreach ($e in $staged) {
        if (-not ((Get-StagedName $e 'agent') -or (Get-StagedName $e 'prompt'))) { continue }
        $t = Read-Text $e.Stage
        $n = $t.Replace(", 'azure-devops/*'", '').Replace("'azure-devops/*', ", '').Replace("'azure-devops/*'", '')
        if ($n -ne $t) { Write-Text $e.Stage $n; Write-Verbose ("tools      trimmed azure-devops/* from {0}" -f $e.Src) }
    }
}

# Prose/customization files that get project values (and .bc-alm/ paths) applied. Never
# scripts or workflows. Mirrors isReparamTarget() in the VS Code extension.
$reparamExt = @('.md', '.json', '.jsonc', '.yml', '.yaml', '.txt')
$proseRootFiles = @(
    '.github/AGENT-ARCHITECTURE.md', '.github/WHEN-TO-USE.md', '.github/SKILLS.md',
    '.github/ISSUE_ORCHESTRATION.md', '.github/PULL_REQUEST_TEMPLATE.md', '.vscode/tasks.json'
)
function Test-ReparamTarget($e) {
    if ($proseRootFiles -contains $e.Src) { return $true }
    $ext = [System.IO.Path]::GetExtension($e.Src).ToLowerInvariant()
    if ($reparamExt -notcontains $ext) { return $false }
    foreach ($t in @($customTrees + $rootTrees)) { if ($e.Src.StartsWith("$t/")) { return $true } }
    return $false
}

# Point references to the root-level template files at .bc-alm/ (only in the .bc-alm layout).
function Convert-StagedLayout {
    if (-not $stateDir) { return }
    foreach ($e in $staged) {
        if (-not (Test-ReparamTarget $e)) { continue }
        $depth = if ($custRoot -and $e.Dest.StartsWith("$custRoot/")) { @($custRoot.Split('/') | Where-Object { $_ }).Count } else { 0 }
        $text = Read-Text $e.Stage
        $new = ConvertTo-BcAlmLayout $text $depth
        if ($new -ne $text) { Write-Text $e.Stage $new }
    }
}

# Re-apply this repo's configured values (template.config.json 'values') to the staged
# files. The template ships its own placeholders (prefix, ticket prefix, repo slug, ADO
# org, object-ID range, AB# linking), so a plain copy would REVERT the initialization on
# every sync. This mirrors Initialize-Template.ps1's Update-Content, using the template
# clone's own config as the 'from' side and this repo's config as the 'to' side. It
# deliberately skips scripts and the template-sync workflow: that workflow's slug guard
# must keep pointing at the template, not this repo.
function Reparameterize {
    if (-not ($config -and $config.values)) { return }
    $v = $config.values
    $tpl = $tplValues
    if (-not $tpl) { return }

    $fromPrefix = [string]$tpl.appPrefix
    $fromTicket = [string]$tpl.ticketPrefix
    $fromSlug   = [string]$tpl.repoSlug
    $fromOrg    = [string]$tpl.adoOrg
    $fromFrom   = [int]$tpl.objectIdFrom
    $fromTo     = [int]$tpl.objectIdTo

    $g = { param($n, $d) if ($v.PSObject.Properties[$n] -and $null -ne $v.$n -and "$($v.$n)" -ne '') { $v.$n } else { $d } }
    $toPrefix = [string](& $g 'appPrefix'    $fromPrefix)
    $toTicket = [string](& $g 'ticketPrefix' $fromTicket)
    $toSlug   = [string](& $g 'repoSlug'     $fromSlug)
    $toOrg    = [string](& $g 'adoOrg'       $fromOrg)
    $toFrom   = [int]   (& $g 'objectIdFrom' $fromFrom)
    $toTo     = [int]   (& $g 'objectIdTo'   $fromTo)
    $wis      = [string](& $g 'workItemSystem' 'ADO')

    $oldPrefix  = [regex]::Escape($fromPrefix)
    $oldTicket  = [regex]::Escape($fromTicket)
    $ticketRepl = if ($toTicket) { "$toTicket-" } else { '' }
    $ticketEval = [System.Text.RegularExpressions.MatchEvaluator] { param($m) $ticketRepl }
    $prefixEval = [System.Text.RegularExpressions.MatchEvaluator] { param($m) $toPrefix }
    $shiftRange = ($toFrom -ne $fromFrom) -or ($toTo -ne $fromTo)

    foreach ($e in $staged) {
        if (-not (Test-ReparamTarget $e)) { continue }
        $text = Read-Text $e.Stage
        if ($null -eq $text) { continue }
        $new = $text
        if ($fromSlug) { $new = $new.Replace($fromSlug, $toSlug) }
        if ($fromOrg)  { $new = $new.Replace($fromOrg, $toOrg) }
        if ($fromTicket) { $new = [regex]::Replace($new, "\b$oldTicket-", $ticketEval) }
        if ($fromPrefix) { $new = [regex]::Replace($new, "\b$oldPrefix", $prefixEval) }
        if ($shiftRange) {
            foreach ($dash in @('-', [char]0x2013, [char]0x2014)) {
                $new = $new.Replace(('{0}{1}{2}' -f $fromFrom, $dash, $fromTo), ('{0}-{1}' -f $toFrom, $toTo))
            }
        }
        if ($wis -eq 'GitHub') { $new = $new.Replace('AB#', '#') }
        if ($new -ne $text) {
            Write-Text $e.Stage $new
            Write-Verbose ("values     re-applied to {0}" -f $e.Dest)
        }
    }
}

function Set-LockEntry($entry, [string] $installedHash) {
    $lockFiles[$entry.Dest] = [pscustomobject][ordered]@{
        source        = $sourceKey
        template      = $templateId
        path          = $entry.Src
        commit        = $commit
        templateHash  = $entry.Raw
        installedHash = $installedHash
    }
    $script:lockChanged = $true
}

# Serialize exactly like writeLock() in the VS Code extension (2-space JSON, files sorted
# ordinally, trailing newline) so the two tools never produce noisy diffs of each other.
function Write-Lock {
    $J = { param($s) ([string]$s | ConvertTo-Json -Compress) }
    $nl = "`n"
    $comment = 'Managed by the BC ALM VS Code extension and scripts/Update-FromTemplate.ps1. Records which template version each template-managed file came from so updates never silently overwrite your own changes. Commit this file.'
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('{' + $nl)
    [void]$sb.Append('  "$comment": ' + (& $J $comment) + ',' + $nl)
    [void]$sb.Append('  "version": 1,' + $nl)
    if ($lockSources.Count -eq 0) { [void]$sb.Append('  "sources": [],' + $nl) }
    else {
        $parts = foreach ($s in $lockSources) {
            $props = @()
            foreach ($k in 'name', 'id', 'url', 'path', 'ref') { if ($s.PSObject.Properties[$k] -and $s.$k) { $props += ('      "{0}": {1}' -f $k, (& $J $s.$k)) } }
            if ($s.PSObject.Properties['exclude'] -and $null -ne $s.exclude) {
                [string[]]$ex = @($s.exclude | Where-Object { $_ } | ForEach-Object { [string]$_ } | Select-Object -Unique)
                [System.Array]::Sort($ex, [System.StringComparer]::Ordinal)
                if ($ex.Count -eq 0) { $props += '      "exclude": []' }
                else { $props += ('      "exclude": [' + $nl + (($ex | ForEach-Object { '        ' + (& $J $_) }) -join (',' + $nl)) + $nl + '      ]') }
            }
            '    {' + $nl + ($props -join (',' + $nl)) + $nl + '    }'
        }
        [void]$sb.Append('  "sources": [' + $nl + ($parts -join (',' + $nl)) + $nl + '  ],' + $nl)
    }
    [string[]]$keys = @($lockFiles.Keys)
    [System.Array]::Sort($keys, [System.StringComparer]::Ordinal)
    if ($keys.Count -eq 0) { [void]$sb.Append('  "files": {}' + $nl) }
    else {
        $parts = foreach ($k in $keys) {
            $e = $lockFiles[$k]
            $props = foreach ($f in 'source', 'template', 'path', 'commit', 'templateHash', 'installedHash') {
                if ($f -eq 'template' -and -not ($e.PSObject.Properties['template'] -and $e.template)) { continue }
                '      "{0}": {1}' -f $f, (& $J $e.$f)
            }
            '    ' + (& $J $k) + ': {' + $nl + ($props -join (',' + $nl)) + $nl + '    }'
        }
        [void]$sb.Append('  "files": {' + $nl + ($parts -join (',' + $nl)) + $nl + '  }' + $nl)
    }
    [void]$sb.Append('}' + $nl)
    Write-Text $lockPath $sb.ToString()
}

try {
    Write-Host "`nStaging template-managed files" -ForegroundColor White
    foreach ($t in $customTrees) { Add-StagedTree $t }
    foreach ($t in $rootTrees) { Add-StagedTree $t }
    foreach ($f in $rootFiles) { Add-Staged $f }

    # Same order as the initializer and the VS Code extension's transform.
    Reparameterize
    Convert-StagedLayout
    Restore-Models
    Trim-WorkItemTools
    Merge-ExtraTools

    # Components the project already has (any local file or lock entry). With a lock, files
    # of components you never installed are not added - install those from the extension.
    $installedComps = New-Object System.Collections.Generic.HashSet[string]
    foreach ($e in $staged) { if (Test-Path -LiteralPath (Join-Path $RepoRoot $e.Dest)) { [void]$installedComps.Add($e.Comp) } }
    foreach ($le in $lockFiles.Values) { if ($le.path) { [void]$installedComps.Add((Get-ComponentId ([string]$le.path))) } }

    Write-Host "`nRefreshing template-managed files" -ForegroundColor White
    foreach ($e in $staged) {
        $dst = Join-Path $RepoRoot $e.Dest
        $le = $lockFiles[$e.Dest]
        if ($le -and (Get-NormUrl ([string]$le.source)) -ne $templateKey) { $otherSource++; continue }
        $newHash = Get-NormHash $e.Stage
        $localHash = Get-NormHash $dst
        $action = $null

        if ($null -eq $localHash) {
            if ($le -and -not $OverwriteLocalChanges) {
                Write-Host "  kept       $($e.Dest) (deleted locally; -OverwriteLocalChanges restores it)" -ForegroundColor DarkYellow
                $keptLocal++; continue
            }
            if ($hasLock -and -not $le -and -not $installedComps.Contains($e.Comp)) { $notInstalled++; continue }
            $action = 'add'
        }
        elseif ($localHash -eq $newHash) { $action = 'current' }
        elseif (($le -and $localHash -eq [string]$le.installedHash) -or -not $hasLock -or $OverwriteLocalChanges) { $action = 'update' }
        else {
            $why = if ($le) { 'you changed it since the last sync' } else { 'differs and has no sync baseline' }
            Write-Host "  kept       $($e.Dest) ($why; use the VS Code extension to merge, or -OverwriteLocalChanges)" -ForegroundColor DarkYellow
            $keptLocal++; continue
        }

        if ($action -eq 'current') {
            $unchanged++
            if (-not $le -or [string]$le.templateHash -ne $e.Raw -or [string]$le.installedHash -ne $newHash -or [string]$le.path -ne $e.Src) { Set-LockEntry $e $newHash }
            continue
        }
        if ($PSCmdlet.ShouldProcess($dst, "Update $($e.Dest) from template")) {
            $dstDir = Split-Path $dst -Parent
            if (-not (Test-Path -LiteralPath $dstDir)) { New-Item -ItemType Directory -Path $dstDir -Force | Out-Null }
            Copy-Item -LiteralPath $e.Stage -Destination $dst -Force
        }
        Set-LockEntry $e $newHash
        if ($action -eq 'add') { Write-Host "  added      $($e.Dest)" -ForegroundColor Green; $added++ }
        else { Write-Host "  updated    $($e.Dest)" -ForegroundColor Yellow; $updated++ }
    }

    # Tracked files the template no longer ships: report, never delete.
    $removed = @()
    foreach ($k in @($lockFiles.Keys)) {
        $le = $lockFiles[$k]
        if ((Get-NormUrl ([string]$le.source)) -ne $templateKey) { continue }
        if (-not (Test-Path -LiteralPath (Join-Path $temp ([string]$le.path)))) {
            if (Test-Path -LiteralPath (Join-Path $RepoRoot $k)) { $removed += $k }
        }
    }

    if (-not ($lockSources | Where-Object { (Get-NormUrl (Get-SourceKey $_)) -eq $templateKey })) {
        $ns = [ordered]@{ id = $templateId; url = $TemplateUrl }
        if ($TemplatePath) { $ns.path = $TemplatePath }
        $ns.ref = $Branch
        $lockSources.Add([pscustomobject]$ns); $lockChanged = $true
    }
    else {
        foreach ($s in $lockSources) {
            if ((Get-NormUrl (Get-SourceKey $s)) -ne $templateKey) { continue }
            if ($s.ref -ne $Branch) { $s.ref = $Branch; $lockChanged = $true }
            if (-not ($s.PSObject.Properties['id'] -and $s.id)) { $s | Add-Member -NotePropertyName id -NotePropertyValue $templateId -Force; $lockChanged = $true }
        }
    }
    if ($lockChanged -and $PSCmdlet.ShouldProcess($lockPath, 'Record synced template versions')) { Write-Lock }
}
finally {
    foreach ($d in $temp, $stage, $repoClone) { if (Test-Path $d) { Remove-Item $d -Recurse -Force -ErrorAction SilentlyContinue -WhatIf:$false } }
}

Write-Host "`nSummary: $added added, $updated updated, $unchanged already current, $keptLocal kept (local changes)." -ForegroundColor White
if ($policySkipped.Count) { Write-Host ("Skipped by sync.components policy: {0}." -f (($policySkipped | Sort-Object) -join ', ')) -ForegroundColor DarkGray }
if ($notInstalled) { Write-Host "$notInstalled file(s) belong to template components you have not installed (add them from the BC ALM VS Code extension)." -ForegroundColor DarkGray }
if ($otherSource) { Write-Host "$otherSource file(s) are tracked from another template source and were left alone." -ForegroundColor DarkGray }
if ($removed.Count) {
    Write-Host "No longer shipped by the template (left in place; delete if you don't need them):" -ForegroundColor DarkYellow
    $removed | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkYellow }
}
if (-not $sync.updateExtensions) { Write-Host "Kept your .vscode/extensions.json (sync.updateExtensions = false)." -ForegroundColor DarkGray }
if (-not $sync.updateInstructions) { Write-Host "Kept your .github/instructions (sync.updateInstructions = false)." -ForegroundColor DarkGray }
$excluded = @()
if (-not $inc.metaDocs)      { $excluded += 'metaDocs' }
if (-not $inc.referenceDocs) { $excluded += 'referenceDocs' }
if (-not $inc.issueOps)      { $excluded += 'issueOps' }
if (-not $inc.specs)         { $excluded += 'specs' }
if (-not $inc.prTemplate)    { $excluded += 'prTemplate' }
if ($excluded.Count) { Write-Host ("Skipped disabled content categories (sync.include): {0}." -f ($excluded -join ', ')) -ForegroundColor DarkGray }
Write-Host "Project-owned files (app/, test/, specs/, PROJECT.md, template.config.json," -ForegroundColor DarkGray
Write-Host "copilot-instructions.md, .vscode/launch.json|mcp.json|settings.json) were left untouched." -ForegroundColor DarkGray
Write-Host "`nNext: review 'git diff', then commit the updates you want to keep (including template.lock.json)." -ForegroundColor White
