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

## Contributing templates

This repository is also a **template catalog**: the root template `bc-alm` plus additional templates
and variants in [`.templates/<id>/`](.templates/README.md) (for example BC Upgrade or BC ALM Lite).

- **Easiest path — the BC ALM VS Code extension.** *Add New Template to This Repository…* creates a
  template, *Create Variant…* a variant, and *Contribute to Source Template (Pull Request)…* sends a
  changed agent or skill from your project. The extension generalizes your project values to the
  template placeholders, proposes the version bump and changelog entry, and opens the pull request
  (through a fork when you cannot push here).
- **By hand:** follow [`.templates/README.md`](.templates/README.md) and open the PR with the
  [template contribution PR template](.github/PULL_REQUEST_TEMPLATE/template.md)
  (`?template=template.md` on the compare page).
- **Checks:** the `template-validate` workflow validates every manifest (id equals folder, unique ids,
  semver, `extends`/`remove` targets) and every agent/skill/prompt/instruction, and requires a
  `template.version` bump plus a `CHANGELOG.md` section when `.templates/<id>/` changes. Run it locally:

  ```powershell
  cd vscode-extension; npm ci; npm run compile
  node out/src/cli/validate.js --root .. --base origin/main
  ```

- **Ownership:** list yourself in `template.maintainers` and add the folder to
  [`.github/CODEOWNERS`](.github/CODEOWNERS) so you review changes to your template. Maintainers release
  versions (tags `<id>/vX.Y.Z`) with *Release Version…* in the extension.
- **Root template changes** (`.github/agents|skills|prompts|instructions`) also drive Copilot in this
  repository, so keep them working here; they are reviewed by the repository owners.

## Adapting vs contributing

If you forked this to run your own BC team, you do **not** need to contribute back — but
if you build a genuinely reusable improvement (a new agent, a better triage check, a
clearer spec template), please send it upstream.
