---
description: "Classify one object or customization area: standard, add-on or customization, blockers, and a fit-gap proposal (STANDARD / ISV / CONVERT / REDESIGN / DROP / OPEN (see skill fit-gap))."
argument-hint: "Object (e.g. Table 50000) or Version List tag"
---

Classify `${input:object:Object or area}` for the upgrade BC14 → BC29.

1. Find the object(s) in `.bcupgrade/cache/inventory/objects.csv` and the related rows in `findings.csv`. If the inventory is missing, stop and ask to run it (skill `inventory`).
2. Read only the relevant parts of the object(s) in `source/`.
3. Answer in this format:

```markdown
### <Object or area>
- **Scope:** standard / add-on (<vendor>) / customization
- **Purpose:** one sentence, in business terms
- **Changes to standard:** fields, triggers, functions (with line references)
- **Blockers:** finding – why it matters for BC29 online
- **Standard BC29 coverage:** what exists now (cite Microsoft Learn)
- **Proposal:** STANDARD / ISV / CONVERT / REDESIGN / DROP / OPEN (see skill fit-gap) – reason
- **Effort:** S / M / L – reason
- **Open questions:** for the customer
```

Do not create files; the assessor records the decision.
