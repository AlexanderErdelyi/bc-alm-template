# Optional: Upgrading to AL-Go for GitHub

This template ships with a **minimal, hand-rolled AL app**, structured as a two-project
workspace (`app/` production app + `test/` test app, tied together by
`bc-alm-template.code-workspace`), plus a set of custom GitHub Actions for issue
orchestration. That is intentionally lightweight so the focus stays on the ALM *process*
(specs, agents, branching). The `app/` + `test/` split already matches AL-Go's app/test
folder model, so adopting AL-Go is mostly a matter of adding its workflows and settings.

When your project grows and you want a full, Microsoft-maintained **CI/CD pipeline** for
Business Central — automated builds, test execution, signing, dependency management, and
deployment to environments — consider adopting
[**AL-Go for GitHub**](https://github.com/microsoft/AL-Go).

## What AL-Go adds

| Capability | This template | AL-Go for GitHub |
|---|---|---|
| Spec-driven workflow + agents | ✅ Built in | ➖ Not included (keep this template's) |
| Issue orchestration | ✅ Custom workflows | ➖ Different model |
| Automated AL build / compile | ➖ Manual (VS Code) | ✅ CI on every push/PR |
| Automated test execution | ➖ Manual | ✅ Test runner in CI |
| App signing | ➖ Manual | ✅ Built in |
| Multi-environment deploy (Dev/Test/Prod) | ➖ Guided by bc-deploy agent | ✅ Automated with approvals |
| AppSource / PTE delivery | ➖ Manual | ✅ Supported |

## How they fit together

The two are **complementary**. A common setup is:

1. Keep this template's `.github/agents/`, `.github/instructions/`, `specs/`, and
   `docs/` — they cover the human + AI process AL-Go does not address.
2. Add AL-Go's workflows and project settings for the build/test/deploy pipeline.

## Migration outline

1. **Start from an AL-Go repo** (recommended): create a new repo from the
   [AL-Go PTE template](https://github.com/microsoft/AL-Go-PTE) (per-tenant extension) or
   [AL-Go AppSource template](https://github.com/microsoft/AL-Go-AppSource), then copy this
   template's `.github/agents/`, `.github/instructions/`, `.github/copilot-instructions.md`,
   `specs/`, and `docs/` into it.
2. **Or add AL-Go to this repo**: follow
   [Add AL-Go to an existing repository](https://github.com/microsoft/AL-Go/blob/main/Scenarios/AddExistingAppOrTestApp.md).
   The app is already split into `app/` and `test/` projects, so point AL-Go's `appFolders`
   at `app` and `testFolders` at `test`. Review whether AL-Go's own build/deploy workflows
   replace or coexist with the custom workflows in `.github/workflows/`.
3. **Reconcile workflows**: AL-Go owns `*.yaml` build/deploy workflows. The issue
   orchestration workflows here (`issue-orchestrator.yml`, `issue-planning.yml`,
   `issue-implementation.yml`) are independent and can stay.

## When to bother

- **Stay minimal** if you are prototyping, teaching the process, or your build/deploy is
  already handled elsewhere.
- **Adopt AL-Go** once you need reproducible CI builds, gated multi-environment
  deployments, signing, or AppSource publishing.

See the [AL-Go documentation](https://github.com/microsoft/AL-Go#readme) for full details.
