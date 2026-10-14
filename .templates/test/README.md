# test

BC ALM without release management: triage, plan, spec, build, PR and docs agents for teams that deploy through their own pipeline.

Variant of `bc-alm-lite`: it uses all of its components, and replaces the components that have files in this folder.

Template id `test` in `.templates/test/`. Add it in the BC ALM extension under **Template Sources** (the repository lists its templates),
choose **Use in This Project**, then pick the components you want.

Maintainers: @AlexanderErdelyi

## Components

- agent `bc-doc`
- agent `bc-init`
