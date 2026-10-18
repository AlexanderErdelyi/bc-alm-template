# Pipeline-managed versioning (optional)

> **Optional.** Applies only when `template.config.json` → `values.versioning` is `pipeline`.
> The default is `manual`: the developer (or the `bc-dev` agent) bumps `app.json` `version` in the
> same PR as the change. With `pipeline`, **nobody hand-edits the `app.json` version** — the build
> computes it per branch and stamps it into the build workspace before compiling.

It pairs naturally with the optional `environment-promotion` branching strategy
([`docs/branching-strategy.md`](../../../../docs/branching-strategy.md)), where several long-lived
environment branches build in parallel and a hand-maintained version would constantly conflict. It
also works with the default `feature-release-selective` model.

## Version scheme

Business Central apps use a four-part version: **`Major.Minor.Build.Revision`**.

| Segment | Meaning | Who changes it |
|---|---|---|
| `Major.Minor` | Taken from the committed `app.json` (e.g. `28.0` to track the BC platform, or your own product major) | A person, in a normal PR, when you move to a new BC version / product line |
| `Build` | Release counter — `+1` on every build of the **production branch** (`values.defaultBranch`, e.g. `main`) | The pipeline |
| `Revision` | CI counter for every other branch (`develop`, `release/*`, …) **between two production releases**, in steps of **10** | The pipeline |

- Non-production builds reuse the `Build` of the **last production release** and take the next
  multiple of 10 above the highest revision already used for that `Build`.
- The slots in between (`.11`–`.19`, `.21`–`.29`, …) are reserved for **manual hotfix deploys**
  (an `app.json` edited by hand and uploaded without a pipeline run). Tag them (`git tag v28.0.5.11`)
  and the next pipeline build skips past them.
- The revision counter **resets** with every new `Build`.

### Example timeline

```text
production merge   -> 28.0.5.0    (Build+1, Revision 0)
1st develop build  -> 28.0.5.10   (first pipeline slot)
manual hotfix      -> 28.0.5.11   (hand-edited app.json, tagged v28.0.5.11)
2nd develop build  -> 28.0.5.20   (max = 11 -> next slot 20)
1st UAT build      -> 28.0.5.30   (max = 20 -> next slot 30)
next prod merge    -> 28.0.6.0    (Build+1, Revision 0)
1st develop build  -> 28.0.6.10   (revision resets per Build)
```

### Feed version (SemVer)

The `.app` keeps the native 4-part version. When you also publish to an artifact feed (Azure
Artifacts, GitHub Packages, NuGet, Universal Packages), use the **channel-tagged SemVer 2.0**
version the script outputs:

| Branch | Channel | Feed version |
|---|---|---|
| production branch | `prod` | `28.0.5` (stable) |
| `release/*` | `uat` | `28.0.5-uat.30` |
| `develop` | `dev` | `28.0.5-dev.20` |
| anything else | `ci` | `28.0.5-ci.40` |

Benefits: parallel `develop` and `release/*` builds never collide in the feed; the production
version is the only stable one; the revision is a numeric prerelease identifier, so `.100` sorts
above `.90`. Trade-off: a prerelease of Build 5 sorts **below** the stable `28.0.5` even though it
is newer — pick feed packages by channel, not by "latest".

Channels are configurable with `-ChannelMap` (e.g. `'develop=dev;release/*=uat;hotfix/*=hf'`) and
should follow your environment branches (`values.environments`, e.g. DEV / TEST / PROD).

## The script: `scripts/Get-BranchVersion.ps1`

[`scripts/Get-BranchVersion.ps1`](scripts/Get-BranchVersion.ps1) is platform-neutral (GitHub
Actions, Azure Pipelines, local shell; Windows PowerShell 5.1 and PowerShell 7). Copy it into your
repo's CI folder (e.g. `scripts/ci/Get-BranchVersion.ps1`) so the pipeline does not depend on the
location of the Copilot customizations.

| Parameter | Default | Purpose |
|---|---|---|
| `-Branch` | detected from `GITHUB_HEAD_REF`/`GITHUB_REF_NAME`, `SYSTEM_PULLREQUEST_SOURCEBRANCH`/`BUILD_SOURCEBRANCH`, or git | Branch being built (`refs/heads/` is stripped) |
| `-ProductionBranch` | `values.defaultBranch` from `template.config.json`, else `main` | Branch(es) that produce `Build+1`, `Revision 0` |
| `-ChannelMap` | `develop=dev; release/*=uat` | Branch pattern → prerelease channel (hashtable or `'a=b;c=d'`) |
| `-AppJsonPath` | `app/app.json` | First file supplies `Major.Minor`; all are stamped by `-WriteAppJson` |
| `-BaseVersion` | from `app.json` | Override `Major.Minor` |
| `-ExistingVersions` | git tags `v<Major>.<Minor>.*` + `app.json` version | Feed the used versions from elsewhere (e.g. your artifact feed); accepts `28.0.5.10`, `28.0.5-dev.10`, `28.0.5` |
| `-TagPrefix` | `v` | Tag naming (`v28.0.5.10`) |
| `-RevisionStep` | `10` | Spacing of pipeline revisions |
| `-WriteAppJson` | off | Stamp the version into the top-level `version` of each `app.json` (formatting kept; dependency versions untouched) |
| `-UpdateBuildNumber` | off | Azure Pipelines: rename the run (`28.0.5.20-dev`) so release pickers show the channel |

Outputs (also returned as an object):

| GitHub Actions (`steps.<id>.outputs.*`) | Azure Pipelines (`$(…)`, also `isOutput=true`) | Example |
|---|---|---|
| `app_version` | `AppVersion` | `28.0.5.20` |
| `feed_version` | `FeedVersion` | `28.0.5-dev.20` |
| `channel` | `VersionChannel` | `dev` |
| `build` / `revision` | `VersionBuild` / `VersionRevision` | `5` / `20` |
| `tag` | `VersionTag` | `v28.0.5.20` |
| `is_production` | `IsProductionBuild` | `false` |

### Where previous versions come from

By default **git tags** are the history, so the approach needs no platform API:

1. The checkout must fetch tags (`fetch-depth: 0` on GitHub, `fetchDepth: 0` + `fetchTags: true` on
   Azure Pipelines).
2. After a **successful** build of a deployable branch, the pipeline pushes `v<AppVersion>`. A failed
   run pushes nothing, so a re-run computes the same version.
3. Do **not** tag pull-request validation builds — they compute a version but do not consume it.
4. Serialize version-producing runs (one concurrency group / exclusive lock for the repo), otherwise
   two branches building at the same moment can compute the same revision and the second tag push
   fails.
5. **First release:** set `app.json` to `<Major>.<Minor>.0.0` (e.g. `28.0.0.0`); the first production
   build becomes `28.0.1.0`. To continue an existing numbering, push a seed tag such as
   `v28.0.41.0` on the production branch once.

Prefer the artifact feed as the source of truth instead? Query the package versions in a prior
step and pass them with `-ExistingVersions`.

## GitHub Actions sample

```yaml
permissions:
  contents: write                 # push the version tag

concurrency:
  group: versioning-${{ github.repository }}
  cancel-in-progress: false

jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0          # tags are the version history
      - name: Compute version
        id: version
        shell: pwsh
        run: ./scripts/ci/Get-BranchVersion.ps1 -WriteAppJson -AppJsonPath app/app.json,test/app.json
      # ... compile / test / package using ${{ steps.version.outputs.app_version }}
      #     publish to a feed as ${{ steps.version.outputs.feed_version }}
      - name: Tag version
        if: success() && github.event_name == 'push'
        shell: pwsh
        run: |
          git tag "${{ steps.version.outputs.tag }}"
          git push origin "${{ steps.version.outputs.tag }}"
```

## Azure Pipelines sample

```yaml
trigger:
  branches:
    include: [ main, develop, release/* ]

steps:
  - checkout: self
    fetchDepth: 0
    fetchTags: true
    persistCredentials: true      # allows the tag push below
  - task: PowerShell@2
    name: version
    displayName: Compute version
    inputs:
      pwsh: true
      filePath: scripts/ci/Get-BranchVersion.ps1
      arguments: -WriteAppJson -AppJsonPath app/app.json,test/app.json -UpdateBuildNumber
  # ... compile / test / package using $(AppVersion); publish to the feed as $(FeedVersion)
  - pwsh: |
      git tag "$(VersionTag)"
      git push origin "$(VersionTag)"
    displayName: Tag version
    condition: and(succeeded(), ne(variables['Build.Reason'], 'PullRequest'))
```

The build service identity needs **Contribute** and **Create tag** on the repository. Use an
exclusive lock (environment check) or a single agent pool slot to serialize runs.

## Rules for agents when `versioning` is `pipeline`

- **Do not bump `app.json` `version`** in feature work, PRs or releases; reviewers must not ask for it.
- Changing `Major.Minor` is a deliberate, separate PR (e.g. a BC platform upgrade).
- Release notes and changelog sections use the version the pipeline produced for the production
  build (read it from the run, the tag or the feed).
- Optional idea: a release step can also create a "release changelog" work item / issue that lists
  what went into each production build.
