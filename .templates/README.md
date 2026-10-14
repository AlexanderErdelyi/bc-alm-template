# Template catalog

This repository is a **template catalog**: besides the root template (`bc-alm`, the files at the
repository root) it holds additional templates, one folder per template id:

```text
template.config.json          root template "bc-alm" (template block + placeholder values)
.github/agents|skills|...     root template components (also used by Copilot in this repo)
.templates/
  bc-alm-lite/                a variant of bc-alm
    template.config.json      { "template": { "id": "bc-alm-lite", "extends": "bc-alm", "remove": [...] } }
    README.md                 what the template is for (not synced into projects)
    CHANGELOG.md              one "## [x.y.z] - date" section per version (not synced)
    .github/agents/...        components that the template adds or replaces
  bc-upgrade/                 a standalone template (own values, own components)
```

Each folder is a complete template: it is laid out exactly like a template repository's root. Projects add
the repository once as a **Template Source** in the BC ALM VS Code extension and pick the templates they
want; the script equivalent is `Update-FromTemplate.ps1 -TemplatePath .templates/<id>`.

## Adding a template

**From the extension (recommended):** *Template Sources* → right-click this repository →
**Add New Template to This Repository…** (blank, seeded from your project's components, or a variant). The extension
writes `.templates/<id>/` and opens a pull request for you (or commits directly when you can push to the
default branch). Until it is merged you can try it from the pull-request branch.

**By hand:** create `.templates/<id>/template.config.json`:

```json
{
  "template": {
    "id": "bc-upgrade",
    "name": "BC Upgrade",
    "description": "Agents and skills for C/AL to AL and version upgrade projects.",
    "version": "0.1.0",
    "icon": "arrow-up",
    "maintainers": ["your-github-login"]
  },
  "values": { "appPrefix": "ABC", "objectIdFrom": 50100, "objectIdTo": 50199, "repoSlug": "AlexanderErdelyi/bc-alm-template", "adoOrg": "your-organization", "workItemSystem": "ADO" }
}
```

then add `README.md`, `CHANGELOG.md` and the components under `.github/agents`, `.github/skills`,
`.github/prompts` and `.github/instructions`. Write them with the placeholder values above (`ABC`, the
object range, ...) — projects replace them with their own values on sync.

Rules (checked by the `template-validate` workflow on every pull request):

- `template.id` equals the folder name (lowercase letters, digits, dots and hyphens) and is unique in
  the repository (including the root template `bc-alm`).
- `template.version` is a semantic version (`x.y.z`).
- Agents, skills, prompts and instructions pass the extension's validator (frontmatter, `description`,
  skill names, handoff targets).
- A change to `.templates/<id>/` bumps `template.version` and adds a matching `CHANGELOG.md` section
  (README-only changes are exempt).

## Variants

A variant reuses another template of this repository and only stores its differences:

| Key | Meaning |
|---|---|
| `extends` | Id of the base template (root `bc-alm` or another `.templates/<id>`). Chains are allowed, cycles are not. |
| `remove` | Component ids of the base that the variant leaves out, e.g. `agent:bc-deploy`, `skill:bc-ship-release`. |
| files in the folder | Add new components or **replace** a base component as a whole (any file of the component replaces all of its files). |
| `values` | Optional; without it the variant inherits the base's placeholder values. |

Variants pick up base changes automatically. In the extension, overridden components show **variant
override** (or **base changed** when the base moved on), and **Compare with Base Template** opens the diffs. Create
one with *Template Sources* → **Create Variant…**.

## Versions

Every catalog template is versioned independently with tags named `<id>/v<version>`
(e.g. `bc-alm-lite/v0.1.0`). Maintainers release with *Template Sources* → right-click the template →
**Release Version…**: it suggests the bump from the conventional-commit subjects since the last
tag, updates `template.version` and `CHANGELOG.md`, and creates the tag.

Projects choose what to follow with **Change Version / Branch…**:

- `latest` — the newest released version of that template (recommended),
- `<id>/vX.Y.Z` — pinned to a release (the tree shows **vX.Y.Z available** and offers **Upgrade to Newest Version**),
- a branch — follow unreleased work (e.g. `main`, or a pull-request branch to try a change).

## Contributing a change

Edit a component in your project, then use **Contribute to Source Template (Pull Request)…** on the component. The extension
generalizes your project values back to the template's placeholders, proposes a version bump and changelog
entry, asks the template's `maintainers` for review and opens a pull request against this repository
(through a fork if you cannot push here). See [CONTRIBUTING.md](../CONTRIBUTING.md#contributing-templates).
