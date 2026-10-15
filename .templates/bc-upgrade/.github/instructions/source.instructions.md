---
description: "Rules for the read-only source exports of your-organization (BC14 (C/AL), on-premises). Use when reading, searching or analysing exported objects."
applyTo: "source/**"
---

# Source exports – read-only

- **Never edit** anything below `source/`. Exports are the evidence for the assessment; they are replaced only by a new export, documented in `docs/project-log.md`.
- `source/customer/` – customer application (BC14 CU14 DE), `source/base/` – standard application of the same version and localization, `source/addons/<vendor>/` – add-on exports, `source/usage/` – record counts.
- Never load a whole export into context. Use the inventory in `.bcupgrade/cache/inventory/` (skill `inventory`) to find objects, then read single objects by line range.

## C/AL text exports

- Object header: `OBJECT <Type> <ID> <Name>`, followed by `OBJECT-PROPERTIES` (`Date`, `Time`, `Modified`, `Version List`) and `PROPERTIES`.
- `Version List` tags (e.g. `NAVW114.00,NAVDE14.00,ABC1.00`) identify standard and add-on modules; customer tags usually mark the customization areas.
- Customizations to standard objects are found by comparing customer and base exports (delta files) – never by looking for `Modified=Yes` alone.
- Typical blockers for the extension model and BC online: `DotNet`, `Automation` and `OCX` variables, `File` operations, `SHELL`/`ENVIRON`, code in standard objects, Codeunit 1 triggers, non-event-based integration.
- Files may be encoded in the codepage of the client (OEM/ANSI); read them as such, do not re-encode.
