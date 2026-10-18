<#
.SYNOPSIS
    Publish (create or update) a single Wiki.js page via the GraphQL API.

.DESCRIPTION
    Idempotent upsert: looks the page up by path, then creates or updates it. Used by
    Publish-Docs.ps1 and usable on its own for a single page. If a Wiki.js MCP server with an
    upsert tool is configured in your environment, you may prefer it for single pages.

    Firewall-friendly by design (some reverse proxies / WAFs in front of Wiki.js reject requests
    otherwise): the JSON body is pure ASCII (non-ASCII characters and '%' are sent as \uXXXX
    escapes), Content-Type is set only via -ContentType, and `isPrivate` is never sent on update.
    See ../wikijs-publishing.md for the troubleshooting ladder.

    Connection settings:
      - URL: -WikiUrl, else $env:WIKIJS_URL, else WIKIJS_URL in a git-ignored .env
      - API key: ONLY $env:WIKIJS_API_KEY or WIKIJS_API_KEY in a git-ignored .env
        (never pass a key on the command line, never commit it)
    The .env file is looked up next to .github (its parent folder), then at the repository root.

.PARAMETER Path
    Wiki.js page path without locale, e.g. bc/modules/sales/payment-tolerance.

.PARAMETER Title
    Page title.

.PARAMETER ContentFile
    Markdown file to upload. A leading YAML front-matter block is stripped.

.PARAMETER Content
    Page content passed inline (used by Publish-Docs.ps1).

.PARAMETER Description
    Short page description.

.PARAMETER Locale
    Wiki.js locale. Default: en.

.PARAMETER Tags
    Page tags.

.PARAMETER Editor
    markdown (default) or code (HTML).

.PARAMETER WikiUrl
    Wiki.js base URL, e.g. https://wiki.example.com. Default: WIKIJS_URL.

.EXAMPLE
    $env:WIKIJS_URL = 'https://wiki.example.com'   # API key already in the environment or .env
    ./upload-page.ps1 -Path 'bc/modules/sales/payment-tolerance' -Title 'Payment tolerance' `
        -ContentFile ../../../../../docs/modules/sales/payment-tolerance.md `
        -Description 'How payment tolerance works' -Tags @('bc', 'sales', 'module-docs')
#>
[CmdletBinding(DefaultParameterSetName = 'File')]
param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$Title,
    [Parameter(Mandatory, ParameterSetName = 'File')][string]$ContentFile,
    [Parameter(Mandatory, ParameterSetName = 'Inline')][AllowEmptyString()][string]$Content,
    [string]$Description = '',
    [string]$Locale = 'en',
    [string[]]$Tags = @(),
    [ValidateSet('markdown', 'code')][string]$Editor = 'markdown',
    [string]$WikiUrl
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'DocsSync.Common.ps1')

if ($PSVersionTable.PSVersion.Major -lt 6) {
    # Windows PowerShell 5.1 may default to TLS 1.0/1.1.
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
}

$repoRootForEnv = $null
try { $repoRootForEnv = Get-DocsRepoRoot } catch { $repoRootForEnv = $null }

if (-not $WikiUrl) { $WikiUrl = Get-DocsSetting -Name 'WIKIJS_URL' -RepoRoot $repoRootForEnv }
if (-not $WikiUrl) { throw 'Wiki.js URL not set. Pass -WikiUrl or set WIKIJS_URL (environment variable or git-ignored .env).' }
$WikiUrl = $WikiUrl.TrimEnd('/')

$apiKey = Get-DocsSetting -Name 'WIKIJS_API_KEY' -RepoRoot $repoRootForEnv
if (-not $apiKey) { throw 'WIKIJS_API_KEY not found. Set the environment variable or add it to a git-ignored .env file.' }

$gqlUrl = "$WikiUrl/graphql"
$headers = @{ 'Authorization' = "Bearer $apiKey"; 'User-Agent' = 'ps-wikijs/1.0' }

if ($PSCmdlet.ParameterSetName -eq 'File') {
    $ContentFile = Resolve-DocsPath -Path $ContentFile -RepoRoot (Get-Location).Path
    if (-not (Test-Path -LiteralPath $ContentFile)) { throw "Content file not found: $ContentFile" }
    $Content = Get-Content -LiteralPath $ContentFile -Raw -Encoding UTF8

    # The YAML front-matter carries upload parameters, not page content - never publish it.
    $stripped = [regex]::Match($Content, '^\uFEFF?---\r?\n.*?\r?\n---\r?\n?(?<body>.*)$',
        [System.Text.RegularExpressions.RegexOptions]::Singleline)
    if ($stripped.Success) { $Content = $stripped.Groups['body'].Value.TrimStart() }
}

# Guard: some WAFs block '%' in HTML pages even when escaped.
if ($Editor -eq 'code' -and $Content.Contains('%')) {
    throw "Content contains '%', which firewalls often block for HTML pages. Replace it (see references/wikijs-publishing.md) before uploading."
}

function Invoke-WikiGraphQL {
    param([string]$Query, [hashtable]$Variables)
    $body = @{ query = $Query; variables = $Variables } | ConvertTo-Json -Depth 8 -Compress
    # Multi-byte UTF-8 (accents, dashes, typographic quotes) and a literal '%' in the body can
    # trigger a 403 from a WAF. \uXXXX escapes are equivalent JSON, keep the payload pure ASCII and
    # '%'-free, and Wiki.js decodes them back to the original characters.
    $body = [regex]::Replace($body, '[^\x00-\x7F]|%', [System.Text.RegularExpressions.MatchEvaluator] { param($m) '\u{0:x4}' -f [int][char]$m.Value })
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
    return Invoke-RestMethod -Uri $gqlUrl -Method Post -Body $bytes `
        -ContentType 'application/json; charset=utf-8' -Headers $headers -TimeoutSec 60
}

try {
    # --- 1) Does the page already exist? ---
    $findQuery = 'query($path: String!, $locale: String!) { pages { singleByPath(path: $path, locale: $locale) { id path title } } }'
    $existing = Invoke-WikiGraphQL -Query $findQuery -Variables @{ path = $Path; locale = $Locale }
    $pageId = $null
    if ($existing -and $existing.data -and $existing.data.pages -and $existing.data.pages.singleByPath) {
        $pageId = $existing.data.pages.singleByPath.id
    }

    if ($pageId) {
        # --- 2a) UPDATE (no isPrivate - including it can trigger a 403 from a WAF) ---
        $mutation = 'mutation($id: Int!, $content: String!, $description: String!, $editor: String!, $isPublished: Boolean!, $locale: String!, $path: String!, $tags: [String]!, $title: String!) { pages { update(id: $id, content: $content, description: $description, editor: $editor, isPublished: $isPublished, locale: $locale, path: $path, tags: $tags, title: $title) { responseResult { succeeded errorCode message } page { id path } } } }'
        $vars = @{ id = $pageId; content = $Content; description = $Description; editor = $Editor; isPublished = $true; locale = $Locale; path = $Path; tags = @($Tags); title = $Title }
        $resp = Invoke-WikiGraphQL -Query $mutation -Variables $vars
        $result = $resp.data.pages.update.responseResult
        $action = 'updated'
    }
    else {
        # --- 2b) CREATE (isPrivate is required here) ---
        $mutation = 'mutation($content: String!, $description: String!, $editor: String!, $isPublished: Boolean!, $isPrivate: Boolean!, $locale: String!, $path: String!, $tags: [String]!, $title: String!) { pages { create(content: $content, description: $description, editor: $editor, isPublished: $isPublished, isPrivate: $isPrivate, locale: $locale, path: $path, tags: $tags, title: $title) { responseResult { succeeded errorCode message } page { id path } } } }'
        $vars = @{ content = $Content; description = $Description; editor = $Editor; isPublished = $true; isPrivate = $false; locale = $Locale; path = $Path; tags = @($Tags); title = $Title }
        $resp = Invoke-WikiGraphQL -Query $mutation -Variables $vars
        $result = $resp.data.pages.create.responseResult
        $action = 'created'
    }

    if (-not $result.succeeded) {
        throw "Wiki.js $action failed: [$($result.errorCode)] $($result.message)"
    }
    Write-Host "Page $action`: $Path" -ForegroundColor Green
    [pscustomobject]@{ action = $action; path = $Path; title = $Title; url = "$WikiUrl/$Locale/$Path" }
}
catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    # The response body (GraphQL error, WAF page) is exposed via ErrorDetails in PowerShell 7.
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
        Write-Host $_.ErrorDetails.Message -ForegroundColor Red
    }
    throw
}
