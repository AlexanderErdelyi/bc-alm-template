# BC ALM Lite

BC ALM without release management: triage, plan, spec, build, PR and docs agents for teams that deploy
through their own pipeline.

Variant of `bc-alm`: it uses all of its components, except `agent:bc-deploy` and `skill:bc-ship-release`,
and replaces the components that have files in this folder (none yet — it is a pure "remove" variant).

Template id `bc-alm-lite` in `.templates/bc-alm-lite/`. Add it in the BC ALM extension under
**Template Sources** (the repository lists its templates), choose **Use in This Project**, then pick the
components you want. From a script:

```powershell
pwsh ./scripts/Update-FromTemplate.ps1 -TemplateUrl https://github.com/AlexanderErdelyi/bc-alm-template.git -TemplatePath .templates/bc-alm-lite
```

> Agents of the base that hand off to `bc-deploy` keep the handoff button; it simply has no target in
> projects using this variant. Override those agents here if you want to remove the handoff.

Maintainers: @AlexanderErdelyi
