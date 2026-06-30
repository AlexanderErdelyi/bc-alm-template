---
name: bc-util-commit-message
description: "Formats git commit messages for Business Central work using conventional commits with Azure DevOps work-item linking. Use when: write a commit message, what commit type, how to format a commit, conventional commit, link a commit to an ADO work item, commit convention."
---

# BC · Commit Message Convention

Format every commit as a [Conventional Commit](https://www.conventionalcommits.org/) with an
Azure DevOps work-item reference, so history is traceable and changelogs can be generated.

## Format

```
<type>: #<workItemId> - [(<module>): ]<description>
```

Example:

```
feat: #1759 - (Payments): add tolerance handler for partial settlements
```

Rules in one breath: lowercase `<type>` from the list below · `#<id>` taken from the branch
name (`feature/ABC-1759-...` → `#1759`) · ` - ` (space-dash-space) is the **only** separator,
never a comma · optional `(<module>)` for module-specific changes, omit for cross-cutting
work and releases · description starts with an imperative present-tense verb, ≤ 72 chars.

A typical validator: `^(feat|fix|chore|refactor|perf|docs|test|build|ci): #\d+ - `.

## Types

| Type | Use for |
|---|---|
| `feat:` | new functionality (pages, reports, codeunits, business logic, integrations) |
| `fix:` | bug fixes (calculation errors, runtime errors, data integrity, UI defects) |
| `chore:` | releases, dependency updates, cleanup, build config (no behaviour change) |
| `refactor:` | restructuring with no behaviour change |
| `perf:` | performance improvements |
| `docs:` | documentation only |
| `test:` | adding or updating tests |
| `build:` / `ci:` | build or pipeline configuration |
| `style:` | formatting / whitespace only |

## Decision shortcut

```
New release?        → chore: #<id> - Release vX.X.X.X
Adds functionality? → feat:  #<id> - (module): <description>
Fixes a bug?        → fix:   #<id> - (module): <description>
Perf only?          → perf:  #<id> - (module): <description>
Refactor only?      → refactor: #<id> - (module): <description>
Docs only?          → docs:  #<id> - <description>
Otherwise           → chore: #<id> - <description>
```

## Description do / don't

✅ imperative verb, specific, present tense, ≤ 72 chars
❌ vague ("fixed bug"), past tense ("added"), missing `#<id>`, wrong type, comma separators

## Examples

```
feat: #12345 - (Payments): add customer credit-limit validation to sales orders
fix:  #12346 - (Mail): resolve null reference in workflow journal posting
chore: #12351 - Release v25.0.1.80
refactor: #12360 - (Mail): extract DMS error handling to a helper
docs: #12354 - update release process documentation
```

## Multiple work items

```
feat: #12345, #12346 - (Reports): add multi-currency support
```

…or list extras in the body: `Also addresses: #12347`.
