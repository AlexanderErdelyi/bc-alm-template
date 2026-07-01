# Prompt files

Reusable [Copilot prompt files](https://docs.github.com/en/copilot/concepts/prompting/response-customization#about-prompt-files)
(`*.prompt.md`). Run one from Copilot Chat in VS Code by typing `/` followed by the file
name (e.g. `/onboarding-plan`); you'll be asked for any `${input:...}` values it declares.
Unlike agents (personas) and skills (auto-firing procedures), prompt files are **explicitly
invoked, parameterized tasks**.

| Prompt | Invoke | What it does |
|---|---|---|
| [`onboarding-plan`](onboarding-plan.prompt.md) | `/onboarding-plan` | Builds a phased, personalized onboarding plan for a new team member, grounded in this repo. |
| [`onboard-app`](onboard-app.prompt.md) | `/onboard-app` | Brings a new/existing AL app under the template: captures the ALM decisions, applies them via the initializer, and scaffolds instructions + the first spec. |
| [`generate-copilot-instructions`](generate-copilot-instructions.prompt.md) | `/generate-copilot-instructions` | Analyzes the codebase and writes/refreshes `.github/copilot-instructions.md` and path-scoped `.github/instructions/*.instructions.md`. |

## Onboarding a new project — the short path

1. **`/onboard-app`** — answer the prompts; it runs the initializer and wires the app into the workflow.
2. **`/generate-copilot-instructions`** — grounds Copilot in your actual code and conventions.
3. **`/onboarding-plan`** — hand this to each new team member.

## Adding your own

Drop a `<name>.prompt.md` file here with frontmatter (`mode`, `description`, optional `tools`)
and a Markdown body. These files are VS Code-discoverable customizations, so they follow the
same `customizationsPath` placement and template-sync rules as `.github/agents` and
`.github/skills`. See the [VS Code prompt-files guide](https://code.visualstudio.com/docs/copilot/customization/prompt-files)
and the community [Awesome GitHub Copilot](https://github.com/github/awesome-copilot) library.
