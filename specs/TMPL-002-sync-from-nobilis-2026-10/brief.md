# Brief — Second sync from the Nobilis project (models, ways of working, new practices)

> **Note:** This is a *template self-improvement* spec, not an end-user AL feature. `plan.md` lists
> **affected template files** instead of AL objects. Predecessor: [TMPL-001](../TMPL-001-enrich-from-nobilis/brief.md).

## Reference

- **Source of patterns:** the Nobilis project (`D365BC-Nobilis-Core`, `origin/main` + feature
  branches) — a production BC project that started from this template and evolved its agents,
  skills, docs tooling and CI/CD. Read-only; not part of this repo.
- **Prior sync:** TMPL-001 (E1–E9, all delivered). TMPL-001 deliberately left the environment-
  promotion branching model and the documentation tooling out of scope; this pass ports them as
  **optional, generic** features.

## Request in plain words

"Our template is a bit outdated — check what I did in Nobilis and take over what could become part
of the template: new models, how things are done, and so on."

## Business value

- Agents run on **current models with fallback lists**, so a missing model no longer breaks an agent.
- Agents get **current tool sets** (ask-questions UI, sub-agents, todo, AL debug/ID tools,
  translation tools, browser tools, Microsoft Learn docs MCP).
- Better ways of working proven in a real project: acceptance criteria in their own ADO field,
  customer-facing **estimates** with scope options, **PR description tiers** per target branch,
  conventional PR titles, test/spec instruction files, interactive browser testing, a docs-coverage
  tooling set.
- Two delivery practices available as **opt-in** choices without changing the default:
  **environment-promotion branching** and **pipeline-managed versioning**.

## Scope

Confirmed by the maintainer: **everything generalizable** (items 1–8 in `plan.md`).

## Out of scope

- Anything Nobilis-specific: prefix/ID range, German text, module table, ADO org/project names,
  Cosmo/Alpaca/DocuWare specifics, private MCP servers (prism, nexus-translator, al-symbols-mcp,
  azure-mcp, ado-remote-mcp, bc-code-intel).
- Nobilis's whole-toolset agent `tools:` style — the template keeps least-privilege, scoped tool IDs.
- Places where the template is already ahead (branch-reuse logic, task status legend, richer AL
  standards, work-item tools section in copilot-instructions) — kept as is.

## Open questions

| # | Question | Status |
|---|---|---|
| Q1 | Exact tool ID of the Microsoft Learn MCP server (`microsoft.docs.mcp/*`) and browser tool IDs | Taken from the working Nobilis configuration; verify in VS Code after merge |
| Q2 | Should a customer-language value be added to `template.config.json` for `estimation.md` and docs? | Not now — follows the existing "customer's preferred language = work-item language" rule |
