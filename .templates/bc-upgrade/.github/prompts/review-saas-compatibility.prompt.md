---
description: "Review an AL app or file for Business Central online compatibility (BC29)."
argument-hint: "App folder or file in al/"
---

Review `${input:path:App folder or file in al/}` for BC29 online compatibility.

Check and report each finding with file and line:

- `app.json`: `"target": "Cloud"`, platform/application versions, ID ranges, dependencies available online (AppSource apps instead of add-on objects).
- Forbidden online: `DotNet`, `Automation`, `File`, `[Scope('OnPrem')]`, OnPrem-only methods and system tables, `SHELL`/`ENVIRON`, direct SQL.
- Files via streams/`TempBlob`; integrations via `HttpClient`/APIs with OAuth; secrets via `SecretText`/isolated storage, never in code.
- Obsolete APIs and warnings for BC29.
- Permission sets, `DataClassification`, `ApplicationArea`, `ToolTip`.
- Behavior that relied on on-premises infrastructure (scheduled tasks, NAS, printers, file shares) and its online replacement.

Output a table `Severity | File:Line | Finding | Fix` and stop – do not change code unless asked.
