# Acceptance Criteria — Second sync from the Nobilis project

"Done" = the target files contain the generalized pattern, contain **no** Nobilis-specific content
(prefix, German text, project/org names, private MCP servers), and the extension tests, template
validator and PowerShell parse checks pass.

## 1 — Models with fallback lists — ✅ done
- **AC-01** ✅ — Given `template.config.json` `models`, When a value is an array, Then the
  initializer, update script and VS Code extension write it as a YAML flow list; a one-item array is
  written as a plain string.
- **AC-02** ✅ — All 10 agents declare a current model (or fallback list); the validator accepts both forms.

## 2 — Agent tool sets — ✅ done
- **AC-03** ✅ — Agents gain ask-questions, sub-agents, todo, AL debug/ID and translation tools as
  relevant; bc-dev/bc-doc gain browser tools; no private MCP server IDs are present.
- **AC-04** ✅ — `.vscode/mcp.json` registers the public Microsoft Learn MCP server.

## 3 — Planning — ✅ done
- **AC-05** ✅ — bc-plan reads its skill at start-up and asks questions one at a time via the ask-questions tool.
- **AC-06** ✅ — In ADO, ACs are written to `Microsoft.VSTS.Common.AcceptanceCriteria` (HTML) with a
  fallback to the Description when the process lacks the field.

## 4 — Estimation — ✅ done
- **AC-07** ✅ — `bc-spec-author/references/estimation.md` defines work packages with Must/Should/Could,
  options A/B/C, a plan-task appendix and an "Approved option" line.
- **AC-08** ✅ — bc-build-feature / bc-dev build only the approved option's scope when an estimate exists.

## 5 — PR tiers and titles — ✅ done
- **AC-09** ✅ — bc-ship-pull-request selects tier A/B/C from the target branch's role; feature → `main`
  under the default strategy stays tier C (unchanged behaviour).
- **AC-10** ✅ — PR titles follow `<type>: #{ID} - description`; `Closes` only on the production PR.

## 6 — Instruction files — ✅ done
- **AC-11** ✅ — `al-test-standards.instructions.md` applies to test AL files and matches the sample
  test app (ID offset +50, GIVEN/WHEN/THEN, `TransactionModel` as a procedure attribute).
- **AC-12** ✅ — `spec-workflow.instructions.md` applies to `specs/**` and matches the `_TEMPLATE` layout.

## 7 — Interactive test and docs tooling — ✅ done
- **AC-13** ✅ — `bc-interactive-test` selects the target from `.vscode/launch.json`, never silently
  picks production, asserts persisted data, cleans up and reports in a fixed format.
- **AC-14** ✅ — bc-docs-feature and the documentation-tooling guide/policy are ported without
  project-specific paths or languages.

## 8 — Optional delivery practices — ✅ done
- **AC-15** ✅ — `branchingStrategy: environment-promotion` is documented in `docs/branching-strategy.md`
  and honoured by bc-ship-release / bc-deploy / bc-ship-pull-request; the default is unchanged.
- **AC-16** ✅ — `versioning: pipeline` is selectable via `-Versioning` / the VS Code task; agents skip
  the `app.json` bump; `Get-BranchVersion.ps1` parses in PowerShell 5.1 and 7.

## Registrations — ✅ done
- **AC-17** ✅ — README, AGENT-ARCHITECTURE, SKILLS, WHEN-TO-USE, skills/README and bc-init-template
  list the new skill, instruction files, model fallback lists and the new config options.
- **AC-18** ✅ — `template.version` is bumped to 0.4.0.
