# Error Handling — bc-build-feature

Recovery playbook for the common failure points during AL feature implementation. Each entry has a
**detection**, a **user-facing message**, and a **recommended action**. Keep the developer in
control — when in doubt, stop and ask rather than guessing.

---

## 1 — Work item / ticket not found

**Detection:** the work-item tool returns not-found, or the ticket ID has no matching item.

```
❌ Work item #{ID} not found.

Please check:
- The ID is correct
- You have access to it
- The project / repository is correct
```

**Action:** do not fabricate requirements. Ask for the correct ID, or offer to proceed from a spec
folder (`specs/ABC-{ID}-*/`) if one already exists.

---

## 2 — Branch already exists

**Detection:** `git switch -c` / branch creation fails because the branch name is taken.

```
⚠️ Branch "{branchName}" already exists.

Options:
1. Switch to it and continue (git switch {branchName})
2. Create with a different name
3. Delete and recreate (destructive — only if it is stale)
```

**Action:** present the options; never force-delete a branch without explicit confirmation.

---

## 3 — Git operation fails

**Detection:** any `git` command exits non-zero (push rejected, merge conflict, detached HEAD,
no upstream, etc.).

```
❌ Git operation failed: {errorMessage}

Common causes:
- Uncommitted changes blocking the operation
- Remote not reachable / no push permission
- Branch protection or required reviews
- Diverged history needing a rebase/pull
```

**Action:** surface the exact error. For push rejections, offer `git pull --rebase origin <branch>`.
For conflicts, list the conflicting files and stop — do not auto-resolve AL merge conflicts.

---

## 4 — Build fails / symbols missing

**Detection:** `al_build` returns errors; `al_get_diagnostics` shows unresolved references
(`AL0185`, missing symbols).

**Action:**
- Missing symbols → download them (`al_downloadsymbols`, or the ALTool CLI — see
  [`docs/al-agent-tools.md`](../../../../docs/al-agent-tools.md)) before assuming a code error.
- Real compiler errors → fix and re-run `al_build`; never proceed on a red build.
- Never edit `alc.exe` output or `.alpackages` by hand.

---

## 5 — Object ID collision / range exhausted

**Detection:** Object ID Ninja (`ninjaNextId`) is unavailable, or the next free ID falls outside
the app's assigned range.

**Action:** never hand-pick an ID that might collide. If Ninja is unavailable, propose the next ID
**within the assigned range**, mark it *"verify before commit"*, and ask the user to confirm the
range if it is unknown.

---

## 6 — Implementation uncertainty

**Detection:** the spec is ambiguous, an acceptance criterion is untestable, or two reasonable
designs exist.

```
⚠️ I need clarification before implementing:

{specific question}

Options considered:
- A: …
- B: …
```

**Action:** stop and ask a **focused, single** question. Do not silently pick an interpretation for
anything that materially changes the design.

---

## 7 — Spec missing or stale

**Detection:** no `specs/ABC-{ID}-*/` folder, or the code diverges from `plan.md`.

**Action:** do not implement without a reviewed spec. Hand back to **`bc-spec-author`** (agent:
`bc-spec`) to author or update it first.

---

## General principles

- **Confirmation-first for destructive actions** (branch delete, force push, file delete).
- **Stop on red builds** — a broken build is never "good enough to push".
- **One focused question at a time** when blocked.
- **Never invent** work-item content, object IDs, or requirements.
- **Match the work-item field format** when writing back (ADO description = HTML, comments =
  Markdown; see [`copilot-instructions.md`](../../../copilot-instructions.md)).
