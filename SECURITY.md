# Security policy

## Supported versions

Only the latest release receives security fixes:

- the BC ALM VS Code extension (`AlexanderErdelyi.bc-alm`);
- the template on `main`.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report it privately through
[GitHub private vulnerability reporting](https://github.com/AlexanderErdelyi/bc-alm-template/security/advisories/new).
Include:

- what is affected (extension version, script or workflow);
- steps to reproduce;
- the impact you expect.

You can expect an acknowledgement within 7 days. A fix or mitigation plan follows once the
report is confirmed. Reporters are credited in the advisory unless they prefer otherwise.

## Scope notes

- The extension runs `git`, the GitHub CLI and PowerShell locally. When it creates or adds a
  project, it runs the template's setup scripts.
  - Only use template sources you trust.
  - The extension is disabled in untrusted (Restricted Mode) workspaces.
- The extension collects no telemetry.
