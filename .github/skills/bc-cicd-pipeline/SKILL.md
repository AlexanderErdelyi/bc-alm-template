---
name: bc-cicd-pipeline
description: "Author and maintain CI/CD for a Business Central AL app — GitHub Actions workflows or AL-Go for GitHub (Azure Pipelines snippets for versioning). Use when: set up CI/CD, create a GitHub Actions workflow, configure AL-Go for GitHub, add a build/test/publish pipeline, fix a failing workflow, add a deployment environment, automate AL compile and test, pipeline-managed app versioning, compute the app version per branch."
---

# BC · CI/CD Pipeline

Wire up the automation that compiles, tests, packages, and deploys this BC app. This is the
**CI/CD** procedure and the core of the **`bc-workflow`** agent. It does not write feature code
(`bc-dev`) or run releases by hand (`bc-deploy`).

## When to use

- The repo has no CI yet and you want PR builds + tests.
- You want releases and environment deployments automated.
- A workflow run is failing and needs diagnosis (compile, symbols, secrets, runner).

## Choose a path first

1. **Hand-written GitHub Actions** — a workflow under `.github/workflows/` that you fully control.
   Build with `microsoft/AL-Go` composite actions or `BcContainerHelper` / `al-build`.
2. **AL-Go for GitHub** — Microsoft's opinionated AL DevOps system (`.AL-Go/` settings + its
   workflow set). Prefer it for teams that want releases/environments managed for them. See
   [`docs/al-go-upgrade.md`](../../../docs/al-go-upgrade.md).

Ask which path the user wants (or respect the existing one) before scaffolding.

> **ALTool option (container-free CI).** For a fast PR build without spinning up a BC
> container, install the AL Dev Tools on the runner and compile with ALTool:
> ```bash
> dotnet tool install --global Microsoft.Dynamics.BusinessCentral.Development.Tools
> # Hydrate symbols into each project's .alpackages from the public MSSymbolsV2 feed
> # (ALTool has no 'downloadsymbols' verb — see docs/al-agent-tools.md section 1), then:
> al workspace compile --packagecachepath "app/.alpackages;test/.alpackages" \
>   --analyzers CodeCop,UICop,PerTenantExtensionCop
> ```
> The repo's [`bc-alm-template.code-workspace`](../../../bc-alm-template.code-workspace)
> defines the `app/` + `test/` projects, so `al workspace compile` builds both in dependency
> order. Full reference: [`docs/al-agent-tools.md`](../../../docs/al-agent-tools.md).

## Procedure

1. **Assess.** List `.github/workflows/`, check for `.AL-Go/` and read `app/app.json` (name, version,
   id, ranges). Read `values.branchingStrategy`, `values.versioning`, `values.defaultBranch` and
   `values.environments` from `template.config.json` (see *Mode awareness* below). Report current state.
2. **Define triggers.** Decide events: PR build/test, push to `main`, tag/release, manual dispatch.
   With `environment-promotion`, also build on push to every environment branch.
3. **Author.**
   - *CI:* compile the app and run AL tests on every PR; upload the `.app` as an artifact.
   - *CD:* package, create a GitHub release, and deploy to BC environments in order
     (`environments` from `template.config.json`, e.g. TEST → PROD).
   - *Versioning:* with `versioning: pipeline`, add the version step before compile (see below).
4. **Secrets & environments.** Reference repository/environment secrets — never hardcode. List every
   secret the user must create (e.g. BC auth context, publisher credentials).
5. **Verify.** Validate the YAML; where possible trigger the workflow and read the run logs. Iterate
   until build + tests pass.
6. **Document.** Record required secrets, environments, and how to read a failed run.

## Mode awareness (optional practices)

Both settings are **optional alternatives**; the defaults need nothing extra.

| `template.config.json` | Default | Alternative | Pipeline impact |
|---|---|---|---|
| `values.branchingStrategy` | `feature-release-selective` — PR builds; `release/*` deploys TEST; `main` deploys PROD | `environment-promotion` — one long-lived branch per environment (e.g. `develop` → DEV, `release/UAT` → TEST/UAT, `main` → PROD) | Trigger on push to each environment branch and map **branch → environment** (names from `values.environments`, production branch from `values.defaultBranch`). PRs into any environment branch run the CI build. See [`docs/branching-strategy.md`](../../../docs/branching-strategy.md#alternative-environment-promotion). |
| `values.versioning` | `manual` — `app.json` version bumped in the PR; CI just checks it was bumped | `pipeline` — the build computes `Major.Minor.Build.Revision` per branch and stamps `app.json` | Add a version step that runs [`references/scripts/Get-BranchVersion.ps1`](references/scripts/Get-BranchVersion.ps1) (copy it into the repo's CI folder), fetch tags in checkout, tag `v<version>` after a successful deployable build, and publish feed packages with the channel-tagged SemVer. Do **not** add a "version was bumped" PR check. Full scheme + GitHub Actions / Azure Pipelines snippets: [`references/versioning.md`](references/versioning.md). |

For AL-Go, map environments to branches with the per-environment `DeployTo<EnvName>` setting
(`"DeployToDEV": { "Branches": [ "develop" ] }`) and replace AL-Go's own `repoVersion` /
`versioningStrategy` numbering with the version step only if the team chose `pipeline`.

## Quality bar

- No secrets/PATs in the repo; third-party actions pinned to a version or SHA (no floating `@main`).
- Prefix, object ID range, environment names and branch names match `template.config.json`.
- With `versioning: pipeline`, the computed version is visible in the run log and the tag/feed
  version matches it.
- The pipeline actually builds and tests the sample app before you call it done.

## Hand-off

When the pipeline is green, hand off to **`bc-ship-release`** (agent: `bc-deploy`) for the actual
release/deploy run.
