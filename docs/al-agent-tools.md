# AL Agent Tools (AL LSP, AL MCP Server, ALTool)

Microsoft ships first-party tooling that lets AI agents — including GitHub Copilot —
**build, compile, publish, and navigate** AL code reliably instead of guessing from text.
This template is wired to use it. This page explains what the pieces are and how to turn
them on.

> Requires the **AL Language extension 17.0+** for the VS Code surface. The headless
> surfaces (MCP / LSP / `al`) work without VS Code.

References:
- [AL Agent Tools overview](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/al-agent-tools/al-agent-tools-overview)
- [AL development tools (`al` / ALTool)](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-al-tool)

---

## The three surfaces

| Surface | What it is | Best for |
|---|---|---|
| **VS Code Language Model Tools** | Tools exposed to Copilot **Agent mode** in VS Code. Reference them in chat with `#al_build`, `#al_getdiagnostics`, `#al_symbolsearch`, … | Day-to-day in-editor agent work |
| **AL MCP Server** | A Model Context Protocol server that exposes the same actions over stdio to any MCP-capable agent | Headless / CI / non-VS Code agents |
| **AL LSP Server** | A standalone Language Server (JSON-RPC over stdio): go-to-definition, find-references, completions, rename, type hierarchy across multi-project workspaces | Agents that need to *navigate* AL structurally |

### Available tools

| Tool | Purpose | Where |
|---|---|---|
| `al_build` | Compile the current AL project to a `.app` | VS Code + MCP |
| `al_compile` | Compile without packaging | MCP |
| `al_publish` | Publish the `.app` to a sandbox | VS Code + MCP |
| `al_downloadsymbols` | Download dependency/symbol packages | VS Code + MCP |
| `al_symbolsearch` | Find objects/symbols across the workspace + symbols | VS Code + MCP |
| `al_getdiagnostics` | Return compiler diagnostics (errors/warnings) | VS Code + MCP |
| `al_getpackagedependencies` | List resolved dependencies | MCP |
| `al_debug` / `al_setbreakpoint` / `al_snapshotdebugging` | Debugging | VS Code |
| `al_auth_login` / `al_auth_logout` | Browser-based MSAL auth (tokens cached on disk) | MCP |

---

## 1. Install the AL Dev Tools (`al` / ALTool)

The `al` command wraps the AL compiler and hosts the MCP/LSP servers. Install it as a
.NET global tool:

```powershell
dotnet tool install --global Microsoft.Dynamics.BusinessCentral.Development.Tools
al version
```

Key commands:

```powershell
# Create a multi-root workspace file from the app folders
al workspace create bc-alm-template.code-workspace ./app ./test

# Compile every project in dependency order with the standard analyzers
al workspace compile --analyzers CodeCop,UICop,PerTenantExtensionCop --maxcpucount

# Render a Mermaid dependency diagram of the workspace
al workspace map
```

> The `workspace` sub-commands require **BC 2026 release wave 1 or later** of the tools.
> On earlier versions, compile each project with `al compile` pointed at `./app` and `./test`.

This template already ships a [`bc-alm-template.code-workspace`](../bc-alm-template.code-workspace)
covering the `app/` and `test/` projects, so `al workspace compile` works out of the box.

### Symbols & building from the CLI (no Docker / no online sandbox)

VS Code downloads symbols for you (**AL: Download Symbols**), but you can also fetch them
headlessly from the **public Microsoft symbols feed** and build with the bundled compiler.
The sample app in this repo is verified to compile clean on **BC 2026 wave 1 (v28,
runtime 16.0)** this way.

- **Feed:** `https://pkgs.dev.azure.com/dynamicssmb2/DynamicsBCPublicFeeds/_packaging/MSSymbolsV2/nuget/v3/index.json`
  (a public NuGet v3 feed). Each `*.symbols*` package is a `.nupkg` (a zip) containing one
  `.app` symbol file — extract it into the project's `.alpackages/` folder.
- **What the sample needs (v28):** `Microsoft.Platform.symbols` (System), plus the GUID-suffixed
  `Microsoft.SystemApplication.symbols.*`, `Microsoft.BusinessFoundation.symbols.*`,
  `Microsoft.BaseApplication.symbols.*` and `Microsoft.Application.symbols`. The test project
  additionally needs `Microsoft.LibraryAssert.symbols.*`, `Microsoft.Any.symbols.*`,
  `Microsoft.TestRunner.symbols.*`, `Microsoft.LibraryVariableStorage.symbols.*` and
  `Microsoft.Library-NoTransactions.symbols.*`.
- **Compile** with the compiler shipped inside the ALTool global tool (`alc.exe`):

  ```powershell
  alc.exe /project:app  /packagecachepath:app\.alpackages  /out:app\out\main.app
  alc.exe /project:test /packagecachepath:test\.alpackages /out:test\out\tests.app
  ```

  `alc.exe` lives under the global-tool store, e.g.
  `~\.dotnet\tools\.store\microsoft.dynamics.businesscentral.development.tools\<ver>\...\tools\net8.0\any\alc.exe`.

> **Targeting a different BC release:** set `values.bcVersion` (`application` / `platform` /
> `runtime`) in [`template.config.json`](../template.config.json) and re-run
> [`scripts/Initialize-Template.ps1`](../scripts/Initialize-Template.ps1) — it rewrites
> `platform`/`application`/`runtime` in **both** `app/app.json` and `test/app.json`. Then
> re-download matching symbols. When you change the **major** version, also bump the Microsoft
> test-library dependency versions in `test/app.json`.


---

## 2. Enable the AL MCP Server for agents

[`​.vscode/mcp.json`](../.vscode/mcp.json) contains a ready-to-use entry, **disabled by
default** under the key `_al`. Once `al` is on your PATH, enable it by renaming the key
from `_al` to `al`:

```jsonc
"al": {
  "type": "stdio",
  "command": "al",
  "args": ["launchmcpserver", "--transport", "stdio"]
}
```

Now agents can call `al_build`, `al_getdiagnostics`, `al_symbolsearch`, etc. against this
repo. Authentication for `al_publish` is browser-based (MSAL) and cached on disk — tokens
are never passed as tool parameters.

You can also launch the servers directly:

```powershell
al launchmcpserver --transport stdio        # MCP server
al launchlspserver                          # LSP server (JSON-RPC on stdio)
```

> **Version note (important):** `launchmcpserver` ships in current ALTool builds.
> `launchlspserver` is newer and currently ships **only in prerelease/beta** ALTool builds —
> **verified working on `18.0.37-beta`**; the latest *stable* channel is `17.x`, which does
> **not** have it. If `al launchlspserver --help` reports an unknown command, update with the
> `--prerelease` flag:
> `dotnet tool update --global Microsoft.Dynamics.BusinessCentral.Development.Tools --prerelease`
> Confirm with `al --help` (the `launchlspserver` verb should be listed).

---

## 2b. Enable the AL LSP Server for agents

The **AL Language Server** ([`launchlspserver`](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-al-tool#al-lsp))
gives an autonomous agent the same *semantic* understanding of AL that a developer gets inside
VS Code — go-to-definition, find-references (across projects), completions, rename, document
symbols, and type hierarchy — over JSON-RPC on stdio. This is structurally more reliable than
`grep`/regex: it distinguishes a `Customer` record reference from the word *Customer* in a
string, and follows AL-specific relationships such as `internalsVisibleTo` and
`propagateDependencies` across `app/` + `test/`.

Unlike the MCP server, the LSP server is **spawned by an LSP host** (an agent runtime or
editor) as a child process — there's no `mcp.json`-style registry for it. Wire ALTool into
your host's language-server/plugin configuration so it invokes, from the repo root, the `al`
executable **directly** (do *not* route it through a shell wrapper — an intermediate process
applies text-mode/encoding translation that corrupts the binary JSON-RPC framing):

```powershell
# Pass both projects so cross-project find-references works; point it at the symbol caches.
al launchlspserver "app" "test" `
  --workspacefile bc-alm-template.code-workspace `
  --packagecachepath "app/.alpackages;test/.alpackages"
```

Configuration is layered (least → most authoritative): CLI flags → `--workspacefile` inline
settings → `--settingspath` file → auto-discovered `.vscode/settings.json` → LSP
`initializationOptions`. The recognized `al.*` keys are `packageCachePath`,
`assemblyProbingPaths`, `ruleSetPath`, `enableCodeAnalysis`, and `codeAnalyzers` — this repo's
[`.vscode/settings.json`](../.vscode/settings.json) already sets sensible values, so the server
auto-discovers them when launched from the project folder. A reachable package cache (`.app`
symbols) is **required** for full language intelligence — run **AL: Download Symbols** in VS
Code or fetch them from the feed (see section 1) first.

For convenience this template ships
[`scripts/Start-ALLanguageServer.ps1`](../scripts/Start-ALLanguageServer.ps1) as an
**interactive smoke-test**: it resolves both projects + symbol caches, runs the command above,
prints the exact direct `al` invocation to **stderr** (copy that into your host config), and
warns — with the `--prerelease` update hint — if your ALTool build predates `launchlspserver`.
Use it to confirm the server starts; don't put it in a host's stdio path (see the warning
above).

```powershell
pwsh ./scripts/Start-ALLanguageServer.ps1
```

> **Verified:** on ALTool `18.0.37-beta` this server starts and completes a full LSP
> `initialize` handshake against `app/` + `test/`, advertising `definitionProvider`,
> `referencesProvider`, `renameProvider`, `typeHierarchyProvider`, `workspaceSymbolProvider`,
> `hoverProvider`, `completionProvider`, `implementationProvider`, `signatureHelpProvider`,
> `inlayHintProvider`, and `codeActionProvider`.

---

## 3. How the agents in this template use them

- **`bc-dev`** — when implementing a feature, the developer agent uses `#al_build` and
  `#al_getdiagnostics` to compile and read real compiler errors instead of guessing, and
  `#al_symbolsearch` (or LSP find-references / go-to-definition) to locate base-app objects
  and events to subscribe to.
- **`bc-workflow`** — the CI/CD agent uses `al workspace compile` (ALTool) in pipelines as
  a lightweight alternative to a full BcContainerHelper build, and `#al_downloadsymbols`
  (VS Code / MCP) or a feed fetch (section 1) to hydrate symbols on the runner.

See [`.github/skills/bc-build-feature/SKILL.md`](../.github/skills/bc-build-feature/SKILL.md)
and [`.github/skills/bc-cicd-pipeline/SKILL.md`](../.github/skills/bc-cicd-pipeline/SKILL.md).

---

## When to use what

- **In VS Code, building a feature** → Copilot Agent mode + `#al_*` tools.
- **A headless agent (CI, Copilot CLI, a background job)** → the AL MCP server.
- **An agent that must resolve symbols / references across `app/` + `test/`** → the AL LSP
  server, which correctly follows `internalsVisibleTo` and `propagateDependencies` instead
  of relying on text search.
