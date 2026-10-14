## Template contribution

<!-- Use this template for changes to the template catalog: .templates/<id>/ or the root template's
     .github/agents|skills|prompts|instructions. Open it with ?template=template.md on the compare page. -->

**Template:** <!-- e.g. bc-alm-lite (or bc-alm for the root template) -->

## Change type

- [ ] New template
- [ ] New variant (`extends`)
- [ ] New component (agent / skill / prompt / instruction)
- [ ] Change to an existing component
- [ ] Removal / breaking change

## Components

<!-- List the component ids added, changed or removed, e.g. agent:bc-upgrade-analyst, skill:bc-upgrade-plan -->

| Component | Change |
|---|---|
| | |

## Version

- [ ] `template.version` bumped (patch = fix, minor = new component/behaviour, major = breaking)
- [ ] `CHANGELOG.md` has a `## [x.y.z] - date` section for the new version
- [ ] Not needed (README-only change or root template)

## Checklist

- [ ] Files use the template placeholder values (`ABC`, object range, repo slug), not my project's values
- [ ] `template.id` equals the folder name; `maintainers` lists the people who review this template
- [ ] New template folder added to `.github/CODEOWNERS`
- [ ] Agents/skills have a `description` with "Use when: …" triggers
- [ ] `template-validate` passes (`node vscode-extension/out/src/cli/validate.js --root . --base origin/main`)
- [ ] Tried in a project (Template Sources → this branch, or the PR branch)
