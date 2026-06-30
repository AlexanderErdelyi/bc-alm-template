# Contributing

Thanks for your interest in improving this template! This is a public, opinionated
BC ALM template — contributions to the agents, instructions, spec templates, workflows,
and documentation are welcome.

## How to contribute

1. **Open an issue first** for anything non-trivial. This repo runs an automated
   [Issue Orchestrator](.github/ISSUE_ORCHESTRATION.md) that triages issues, so a clear
   title and description help the pipeline (and reviewers).
2. **Fork and branch.** Use the branch naming from the
   [branching strategy](docs/branching-strategy.md): `feature/<issue-number>-<short-name>`.
3. **Follow the conventions.** AL changes must follow
   [AL coding standards](.github/instructions/al-coding-standards.instructions.md).
   Process/doc changes should stay consistent with the existing style.
4. **Open a PR** using the [pull request template](.github/PULL_REQUEST_TEMPLATE.md) and
   complete the checklist.

## What makes a good contribution

- **Agents** — keep them focused on a single workflow stage; describe behaviour, not models.
- **Instructions** — keep rules concrete with ✅/❌ examples.
- **Spec templates** — keep them tool-agnostic so any team can adopt them.
- **Workflows** — preserve the concurrency/anti-recursion safeguards already in place.

## Adapting vs contributing

If you forked this to run your own BC team, you do **not** need to contribute back — but
if you build a genuinely reusable improvement (a new agent, a better triage check, a
clearer spec template), please send it upstream.
