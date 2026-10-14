# Marketplace screenshots

These PNGs are used by the Marketplace page (`vscode-extension/README.md`) through absolute
`raw.githubusercontent.com` URLs. They are **not** packaged into the VSIX (see `.vscodeignore`).

## Rules

- **Format:** PNG.
- **Width:** about 1280–1600 px, using the default **Dark Modern** theme.
- **Content:** no customer names, tokens or private repository names. Use the sample app (`ABC`
  prefix) or a demo org.
- **Focus:** crop to the relevant part of the window, with the side bar and editor visible.

## Shot list

| File | What to show |
| --- | --- |
| `components.png` | The BC ALM **Components** view, grouped by template, with a mix of statuses (*up to date*, *update available*, *modified*, *conflict*). |
| `new-project.png` | **New Project from Template…**: the step that asks for prefix and object range, or the finished project with the Components view filled. |
| `browse-templates.png` | **Browse Templates…** on a catalog with several templates, showing the actions (Use in This Project / Add to My Sources / Preview Components / Open README). |
| `contribute.png` | **Contribute to Source Template (Pull Request)…**: the pick of changed components, or the resulting pull request. |

The images are referenced near the top of `vscode-extension/README.md`. When you replace a file,
keep its name, or update the link and caption there.
