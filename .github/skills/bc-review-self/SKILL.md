---
name: bc-review-self
description: "Runs a pre-PR self-review of a Business Central feature branch against the AL quality gate before a pull request is opened. Use when: self review before PR, check AL quality, review my changes, pre-PR check, did I miss anything, validate before pull request, lint my AL feature."
---

# BC · Self-Review (pre-PR gate)

Catch problems on your own feature branch *before* asking anyone to review. This is the
**REVIEW** phase, shared by the `bc-dev` and `bc-pr` agents.

## Scope

Review only what changed on the feature branch since it diverged from `main`. Read the spec
(`specs/ABC-{ID}-*/`) so you can check the code against what was agreed.

## Checklist — report ✅ / ❌ with a one-line note each

**Correctness vs spec**
- [ ] Every AL object in `plan.md` is implemented.
- [ ] No object exists in code that is missing from the spec (or the spec was updated).
- [ ] Behaviour matches each acceptance criterion.

**AL standards** (see `../bc-build-feature/references/al-patterns.md`)
- [ ] No hardcoded user-visible text — all Labels, with `Comment` for placeholders.
- [ ] No hardcoded IDs / magic values — enums or setup tables.
- [ ] No base-table modifications — table extensions only.
- [ ] `DataClassification` on every new field.
- [ ] Event subscribers used instead of base edits where applicable.
- [ ] Naming: objects PascalCase + prefix, locals lowerCamelCase.

**Hygiene**
- [ ] `app.json` version bumped correctly for the change type.
- [ ] Test codeunit present and covering the acceptance criteria.
- [ ] Permission set updated for all new/changed objects.
- [ ] No leftover `// TODO`, debug `Message()`, or commented-out blocks.
- [ ] Commits follow `bc-util-commit-message`.

> Items needing a compile (e.g. "code compiles", "analyzer clean") can't be confirmed by
> reading files — mark them **"requires build verification"** and tell the user to run the build.

## BCQuality augmentation (optional)

If this repo has a **BCQuality** checkout (default `vendor/bcquality/` — see
[`docs/bcquality.md`](../../../docs/bcquality.md)), back the AL standards above with
Microsoft- and community-curated BC rules:

1. Ensure the index is current: `pwsh ./vendor/bcquality/tools/Build-KnowledgeIndex.ps1`.
2. Invoke `vendor/bcquality/skills/entry.md` with a task context:
   `goal: "pre-PR review of an AL feature branch"`, `inputs-available: [pr-diff, file-path]`,
   `technologies: [al]`, `bc-version:` (from `app/app.json` `application`), `enabled-layers:
   [microsoft, community, custom]`.
3. Run each action skill in the returned **dispatch record** (typically `al-code-review` and its
   leaf reviewers), then fold their JSON findings into the issues list below — keep each
   finding's reference to the knowledge file that justified it.

This is **additive**: it strengthens the review, it never replaces the checklist. If no BCQuality
checkout is present, skip this section silently and review against the standards above.

## Output

```
## Self-Review — ABC-{ID}

✅ Passed: <n>   ❌ Issues: <m>   ⏳ Requires build: <k>

### Issues to fix before PR
1. ❌ <file:line> — <problem> → <suggested fix>
```

If there are ❌ items, return to **`bc-build-feature`** (agent: `bc-dev`). When clean, proceed
to **`bc-ship-pull-request`** (agent: `bc-pr`).
