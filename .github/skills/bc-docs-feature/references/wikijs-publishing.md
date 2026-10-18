# Reference — Wiki.js Publishing (optional)

How to mirror repo markdown to a **Wiki.js** instance. This is **strictly optional**: read this only
when the user explicitly asks to **publish / upload / sync** docs to Wiki.js. Repo markdown is
always the source of truth; the wiki page is a mirror. Projects that do not use Wiki.js ignore this
file — nothing else in the skill depends on it.

> **Golden rule:** write and review the markdown in the repo first, get it approved (PR merged),
> **then** publish. Never hand-author content directly in the wiki.

> **Format rule — markdown everywhere.** The **same** markdown file is the source and the published
> content (`editor: markdown`); there is no HTML conversion step. One source of truth, clean diffs,
> and no fight with firewalls that dislike styled HTML.

---

## Configuration

| Setting | Source |
|---|---|
| Base URL | `-WikiUrl` parameter, else env var `WIKIJS_URL`, else `WIKIJS_URL=` in a git-ignored `.env` |
| GraphQL API | `<base URL>/graphql` |
| Locale | `-Locale` parameter, default `en` |
| API key | **only** env var `WIKIJS_API_KEY` or `WIKIJS_API_KEY=` in a git-ignored `.env` — never a parameter, never committed |
| Path prefix | project choice, e.g. `bc/modules` — set it in each page's `wiki-path` |

`.env` is looked up next to `.github` (its parent folder), then at the repository root. The
template's `.gitignore` already ignores `.env`; keep it that way. The read-only status check and
`Publish-Docs.ps1 -WhatIf` need neither URL nor key.

### Path convention

```
<prefix>/<area>                      ← area index (docs/modules/<area>/index.md)
<prefix>/<area>/<page-slug>
<prefix>/<area>/<topic>              ← topic index (docs/modules/<area>/<topic>/index.md)
<prefix>/<area>/<topic>/<page-slug>
```

- The Wiki.js path mirrors the repo path under `docs/modules/` one-to-one. If a page moves into a
  topic folder in the repo, the Wiki.js path moves with it.
- An **index** page maps to the folder path itself (no page name; a trailing slash is trimmed).
- `<page-slug>` is the English file name without extension (`architecture`, `setup-guide`,
  `user-guide`, `object-reference`) — never a translation.
- Pick the prefix once per project (e.g. `bc/modules`) and keep it stable: changing a `wiki-path`
  creates a new page and leaves the old one behind.

Example (`finance` area with a `document-output` topic, prefix `bc/modules`):

```
bc/modules/finance                                              → finance/index.md
bc/modules/finance/document-output                              → finance/document-output/index.md
bc/modules/finance/document-output/invoice-credit-memo-layouts
```

---

## Front-matter → upload parameters

Front-matter is the opt-in: **only pages with a `wiki-path` key are ever published.**

| Front-matter | Upload parameter |
|---|---|
| `wiki-path` | `path` |
| `wiki-title` | `title` (default: file name) |
| `wiki-tags` | `tags` |
| `description` (optional) | `description` (default: first prose line of the body) |
| (page body, front-matter stripped) | `content` |
| — | `locale` (default `en`), `editor = markdown` |

The YAML block is upload metadata, never page content — both scripts strip it.

| Editor key | Use |
|---|---|
| `markdown` | **Standard.** Repo markdown published as-is. Diff-friendly, firewall-friendly. |
| `code` (HTML) | Rare exception only, when a page genuinely needs styled HTML; expect the firewall rules below. |

---

## Batch publishing and change tracking (recommended)

Two scripts in [`scripts/`](scripts/) share `DocsSync.Common.ps1`, so the check and the publish
step derive the content hash identically. Run them from anywhere inside the repository.

```powershell
$s = './.github/skills/bc-docs-feature/references/scripts'

# What is out of sync? Read-only, no URL/key. Exit 0 = in sync, 1 = something to publish.
& "$s/Get-DocsSyncStatus.ps1"

# Preview — needs no URL/key, changes nothing
& "$s/Publish-Docs.ps1" -WhatIf

# Publish changed pages of one area (URL from WIKIJS_URL, key from WIKIJS_API_KEY / .env)
& "$s/Publish-Docs.ps1" -Filter 'modules/finance'

# Publish everything that changed / republish everything
& "$s/Publish-Docs.ps1"
& "$s/Publish-Docs.ps1" -Force
```

| Parameter | Effect |
|---|---|
| `-WhatIf` | Dry run: lists the pages, sends nothing, writes no manifest (Publish-Docs only) |
| `-Filter <path part>` | Only pages whose source path contains the text, e.g. `modules/finance` |
| `-Force` | Republish every page regardless of the manifest |
| `-SkipManifestUpdate` | Publish but leave the manifest untouched (e.g. scratch wiki) |
| `-UpdateManifest` | Status check only: write `status` + `checkedAt` into the manifest |
| `-Quiet` | Status check only: no output, just the exit code |
| `-Locale`, `-WikiUrl`, `-DocsRoot`, `-ManifestPath`, `-RepoRoot` | Overrides |

`Publish-Docs.ps1` exits `1` if at least one page failed, otherwise `0`.

### What happens per page

| Step | Behaviour |
|---|---|
| **Opt-in** | Only files with a `wiki-path` front-matter key are published; everything else is skipped and counted. |
| **Links rewritten** | Relative `.md` links become absolute Wiki.js paths (`[Layouts](invoice-credit-memo-layouts.md)` → `[Layouts](/en/bc/modules/finance/document-output/invoice-credit-memo-layouts)`). **The repo file is never modified** — it keeps relative links so it stays navigable in VS Code, GitHub and Azure DevOps. |
| **Ordering** | Parents before children, index before siblings, so Wiki.js always has the parent path. |
| **Change detection** | SHA256 over path + title + tags + description + rewritten body (LF-normalised), compared against the manifest. |
| **Failures** | A failed page is not written to the manifest, so simply re-running retries exactly those pages. |
| **Deleted sources** | Reported as `orphaned`; wiki pages are **never** deleted automatically — removal stays a deliberate manual act. |

Edge cases:

- **A filter can leave gaps.** Publishing only a sub-folder may leave the parent area page missing
  in the wiki. The scan always covers *all* pages (otherwise links could not be rewritten), but only
  the filtered part is sent.
- **Links inside code samples** are rewritten too if they happen to point at a real published page.
  Use an obviously fake file name in examples you want kept literally.
- **A changed title or tag** also triggers republication — the hash covers metadata, not just body.
  So does a moved link target: every page linking to it gets a new hash and is republished.

### The manifest — `docs/.wiki-sync.json`

Answers *"was this page already published, and has it changed since?"*. It is **committed**, so the
publication state is visible in Git history.

```json
{
  "schema": 2,
  "locale": "en",
  "updated": "2026-01-15T14:12:03+01:00",
  "pages": [
    {
      "wikiPath": "bc/modules/finance/document-output",
      "source": "docs/modules/finance/document-output/index.md",
      "title": "Document output — invoices and credit memos",
      "status": "published",
      "hash": "9f2c…",
      "publishedAt": "2026-01-15T14:12:03+01:00",
      "checkedAt": "2026-01-15T14:12:03+01:00"
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `wikiPath` | Target path in the wiki; also the key of the entry |
| `source` | Source file, repo-relative |
| `title` | Title at the last publication/check |
| `status` | Snapshot of the last run: `new` · `outdated` · `published` · `orphaned` |
| `hash` | SHA256 of the **published** content; `null` while the page was never sent |
| `publishedAt` / `checkedAt` | Last successful publication / last check or publication |

> The stored `status` is a **snapshot**, not live truth — anyone can edit a file afterwards. The
> authoritative answer is always the console output of `Get-DocsSyncStatus.ps1`, which recomputes
> the hashes at run time.

| Trigger | Fields written |
|---|---|
| `Publish-Docs.ps1`, successful page | `status = published`, `hash`, `publishedAt`, `checkedAt` |
| `Publish-Docs.ps1`, failed page / `-WhatIf` / `-SkipManifestUpdate` | nothing |
| `Get-DocsSyncStatus.ps1` | nothing |
| `Get-DocsSyncStatus.ps1 -UpdateManifest` | `status`, `checkedAt` — `hash` stays the hash of what is live |

**Merge conflicts** in the manifest (two people published in parallel): merge both page lists (entries
are unique by `wikiPath`); for the same entry keep the newer `publishedAt`. If in doubt, run the
status check — a wrong hash only ever causes one extra publication, never data loss.
**Lost manifest:** every page counts as `new` and is republished. Harmless — the upload is an
idempotent upsert — it only costs time.

---

## Single page

`upload-page.ps1` does an idempotent upsert (looks the page up by path, then create or update):

```powershell
./.github/skills/bc-docs-feature/references/scripts/upload-page.ps1 `
    -Path        'bc/modules/<area>/<slug>' `
    -Title       '<page title>' `
    -ContentFile 'docs/modules/<area>/<slug>.md' `
    -Description '<short description>' `
    -Tags        @('bc', '<area>', 'module-docs', '<page-type>')
```

If a Wiki.js MCP server with an upsert tool is configured in your environment, you may use it for
single pages instead (pass the same path/title/content/tags/locale/editor, front-matter stripped).
For several pages or whenever you want change tracking, use `Publish-Docs.ps1`.

GraphQL notes (handled by the script): `create` **requires** `isPrivate: false`; `update` **must
not** include `isPrivate`. Detect which one with a `pages.singleByPath(path, locale)` query first.

---

## Firewall (WAF) constraints

Some reverse proxies / WAFs in front of Wiki.js return **403 Forbidden** for request bodies that look
like attacks. `upload-page.ps1` already mitigates the common triggers:

1. **No multi-byte UTF-8 in the raw body** — accented letters, em dashes, typographic quotes and
   arrows can trigger a 403. The script sends every non-ASCII character as a `\uXXXX` JSON escape;
   Wiki.js decodes it back. You do not need to rewrite your text.
2. **No `%` in the raw body** — it can read as URL-encoded attack payload; escaped the same way.
   For HTML (`editor: code`) pages the script refuses `%` entirely (e.g. CSS `width:100%` →
   `width:auto`).
3. **PowerShell:** pass `Content-Type` **only** via `-ContentType`, never also in `-Headers`.
4. **Body as UTF-8 bytes**, not a string.
5. **`update` never contains `isPrivate`.**
6. **No inline `<script>`** and **no HTML comments** (`<!-- -->`) in content.

**Diagnosing a 403**, in this order:

| Step | Probe | If it succeeds |
|---|---|---|
| 1 | `singleByPath` read query | Token and network path are fine — the problem is the request body. |
| 2 | `create` with `content = "Test"` | The mutation is allowed — the problem is the page content. |
| 3 | `update` with `'a' * 3000` | Size is not the limit. |
| 4 | `update` with the same length of real prose | If this fails where step 3 passed, it is the character class. |

| Symptom | Cause / fix |
|---|---|
| `WIKIJS_API_KEY not found` / `Wiki.js URL not set` | Set the env vars or the git-ignored `.env`. |
| 403 on every page | If a read query fails too, the key is invalid or the network path is blocked. |
| 403 on single pages | Firewall rule — look for HTML comments or `<script>`. |
| 400 Bad Request | **Not** the firewall: GraphQL rejected the query (missing/invalid argument). |
| Page appears twice in the wiki | `wiki-path` changed; remove the old page manually. |
| Everything shows as `new` | Manifest missing or not committed. |

---

## CI/CD (optional)

The publisher is pipeline-ready: idempotent, non-zero exit on failure, only changed pages. Run it
after a merge to `main`, with URL and key as secrets:

```yaml
# GitHub Actions
- name: Publish docs to Wiki.js
  shell: pwsh
  run: ./.github/skills/bc-docs-feature/references/scripts/Publish-Docs.ps1
  env:
    WIKIJS_URL: ${{ vars.WIKIJS_URL }}
    WIKIJS_API_KEY: ${{ secrets.WIKIJS_API_KEY }}
```

```yaml
# Azure Pipelines
- task: PowerShell@2
  displayName: Publish docs to Wiki.js
  inputs:
    filePath: '.github/skills/bc-docs-feature/references/scripts/Publish-Docs.ps1'
    pwsh: true
  env:
    WIKIJS_URL: $(WikiJsUrl)
    WIKIJS_API_KEY: $(WikiJsApiKey)   # secret pipeline variable
```

Settle two things first:

1. **Manifest write-back.** CI must commit the updated `docs/.wiki-sync.json` back, otherwise every
   run republishes everything. Alternative: keep publishing a local, reviewed step and use
   `Get-DocsSyncStatus.ps1 -Quiet` in CI only as a check.
2. **Trigger scope.** Restrict the trigger to `docs/**` so unrelated AL changes do not start a
   publication.

---

## Security

- **Never** commit the API key or pass it on the command line. It lives only in an env var or a
  git-ignored `.env`.
- Never print the key in logs, terminal output, or generated content.
- Do not put meeting transcripts, personal data, or secrets into wiki content — link to the source.

---

## After publishing — confirm to the user

```
Published:
| Page          | Wiki.js path                        | Action  |
|---------------|-------------------------------------|---------|
| Overview      | bc/modules/<area>                   | created |
| Architecture  | bc/modules/<area>/architecture      | updated |

Source of truth: docs/modules/<area>/   Manifest: docs/.wiki-sync.json (commit it)
```
