## Summary

<!-- Briefly describe what this PR does and why. 2-3 sentences. -->

## ADO Work Item

<!-- Link to the Azure DevOps work item. GitHub will auto-link AB#ID to ADO when configured. -->

Closes AB#<!-- ticket ID -->

## Type of Change

- [ ] Feature — new functionality
- [ ] Bug Fix — fixes an issue
- [ ] Hotfix — critical production fix
- [ ] Refactor — code improvement, no functional change
- [ ] Documentation — docs only, no code change

## Affected AL Objects

<!-- List all AL objects created or modified in this PR. -->

| Object Type | Object ID | Object Name | Change Summary |
|---|---|---|---|
| | | | |

## Spec

<!-- Link to the spec folder for this ticket. -->

📄 Spec: `specs/<!-- ABC-{ID}-short-description -->/`

## Testing

<!-- Reference the acceptance criteria and test codeunit. -->

Tested against: `specs/<!-- ABC-{ID} -->/acceptance-criteria.md`

Test codeunit: <!-- Codeunit XXXXX "Your Feature Test" -->

## Deployment Notes

<!-- Document any steps required after deployment:
- Setup records to create
- Configuration changes
- Data migration scripts
- Permission set assignments
- Any manual steps for the release manager
Leave blank if no post-deployment steps are needed. -->

## Screenshots

<!-- Add screenshots for any UI changes (new pages, page extensions, modified layouts).
Leave blank if there are no UI changes. -->

## Quality Checklist

<!-- Complete this checklist before requesting review. -->

- [ ] Code compiles without errors
- [ ] AL Analyzer passes (no warnings for committed files)
- [ ] `app.json` version bumped (feature → minor, fix → build)
- [ ] No hardcoded text — all user-visible strings are Label variables
- [ ] No hardcoded IDs — enums, setup tables, or named constants used
- [ ] No base table modifications — extension tables used for new fields
- [ ] Permission sets updated for all new or modified objects
- [ ] Test codeunit added for new business logic
- [ ] Spec folder referenced in this PR description
- [ ] ADO work item linked (`AB#ID` format above)
- [ ] Deployment notes completed (or confirmed not needed)
