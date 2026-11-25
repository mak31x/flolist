---
description: Start a Flolist roadmap phase in a fresh session (loads only the needed docs)
argument-hint: <phase id, e.g. M2.1>
---
We are starting Flolist phase **$ARGUMENTS**.

1. Read `docs/roadmap.md`: the **Handoff** block and the section for phase $ARGUMENTS only.
2. Read `docs/decisions.md` in full. It is binding.
3. Read only the files listed under `Specs:` for $ARGUMENTS (paths are relative to `docs/`). Don't open other spec files unless you're blocked, and if you do, say which one and why.
4. Check the current repo state (`git status`, `git log --oneline -10`, and the relevant folders).
5. Mark the phase `[~]` in the roadmap, create the branch `phase/$ARGUMENTS-<slug>`, then reply with:
   - a numbered implementation plan (≤12 steps) mapped to the phase checkboxes
   - any open questions or `[assumption]`s you need me to confirm. If there are none, say so and start step 1.
