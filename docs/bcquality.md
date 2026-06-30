# BCQuality — Microsoft's BC quality knowledge base

[microsoft/BCQuality](https://github.com/microsoft/BCQuality) is a Microsoft-maintained,
**MIT-licensed** knowledge base and skills library for Business Central. This template can
consume it so that AL review is backed by Microsoft- and community-curated BC rules instead of
relying only on the model's general knowledge.

## What BCQuality actually is

It is **not** an agent or a binary you run. It is a tree of **machine-readable knowledge files**
plus **skills** that tell an agent how to consume them.

- **Knowledge files** are atomic markdown files with YAML frontmatter. They are deliberately
  *remedial*: a file exists only because a capable LLM **would get BC code wrong without it**
  (e.g. "`SetLoadFields` must be called before filters, not after", or "CodeCop AA0233 flags
  `FindFirst … Next` loops"). Generic advice ("don't hardcode secrets") is explicitly excluded.
- **Skills** define *how* an agent uses that knowledge. The agent's first call is always
  [`skills/entry.md`](https://github.com/microsoft/BCQuality/blob/main/skills/entry.md), which
  takes a **task context** and returns a **dispatch record** naming the action skills to run.
- **Action skills** do the work and emit structured JSON findings, each referencing the
  knowledge file that justified it. The headline one is `al-code-review`, a super-skill that
  composes ~12 leaf reviewers: performance, security, error-handling, events, interfaces,
  privacy, style, UI, upgrade, web-services, and breaking-changes.

### The three layers

All enabled by default; precedence is **custom › community › microsoft**:

| Layer | Path | Purpose |
|---|---|---|
| Microsoft | `/microsoft/` | Platform guardrails and official guidance. |
| Community | `/community/` | Community patterns and shared guidance. |
| **Custom** | `/custom/` | **Your** partner/customer-specific rules. Empty upstream; you populate it. |

The custom layer is the integration point for a team: your own BC gotchas live there and flow
through the **same** dispatch pipeline as Microsoft's, overriding upstream files with the same id.

### How the flow runs

```
orchestrator → entry.md (task context) → dispatch record
            → al-code-review (super-skill) → leaf review skills
            → structured findings (with knowledge-file references)
```

## How this template uses it

This is **additive** — BCQuality augments our own review gate, it does not replace it.

- **`bc-review-self`** (the shared pre-PR review skill used by `bc-dev` and `bc-pr`) has an
  optional *BCQuality augmentation* step: when a BCQuality checkout is present it invokes
  `entry.md` with a PR/feature task context, runs the dispatched review skills, and folds the
  findings into the self-review report.
- **`al-coding-standards.instructions.md`** stays our *house style* (generic conventions);
  BCQuality's custom layer holds the *remedial BC-specific* rules the review agent cites with
  references. Clean separation: style here, gotchas there.

## Getting it into your repo

Run the helper (or let the **`bc-init`** agent run it during guided setup):

```powershell
# Vendor a shallow copy into vendor/bcquality (tracked in your repo; custom/ preserved on update)
./scripts/Add-BCQuality.ps1 -Mode vendor

# Or wire it as a git submodule (stays linked to upstream; fork it to own the custom layer)
./scripts/Add-BCQuality.ps1 -Mode submodule

# Refresh later (re-pulls microsoft/ + community/, keeps your custom/ files)
./scripts/Add-BCQuality.ps1 -Mode vendor -Update
```

After it lands, build the knowledge index that the review skills read (ships inside BCQuality):

```powershell
pwsh ./vendor/bcquality/tools/Build-KnowledgeIndex.ps1
```

### Vendor vs. submodule

| | `vendor` (default) | `submodule` |
|---|---|---|
| Files tracked in your repo | ✅ Yes (offline, no submodule setup) | ➖ Pointer only |
| Edit `custom/` directly | ✅ Yes | ⚠️ Need a fork of BCQuality |
| Stay in sync with upstream | Re-run with `-Update` | `git submodule update --remote` |
| Best for | Most teams / a template | Teams already forking BCQuality |

## Adding your own custom knowledge

Author a knowledge file under `vendor/bcquality/custom/knowledge/<domain>/<slug>.md` following
BCQuality's
[WRITE meta-skill](https://github.com/microsoft/BCQuality/blob/main/skills/write.md). Keep it
atomic (one concern, ideally < 50 lines), remedial (something an LLM gets wrong), and give it the
six required frontmatter fields (`bc-version`, `domain`, `keywords`, `technologies`, `countries`,
`application-area`). Then rebuild the index. Your file now participates in every review and
overrides any upstream file sharing its id.

## License

BCQuality is MIT-licensed (© Microsoft). Vendoring or forking is permitted; keep its `LICENSE`
file with the vendored copy.
