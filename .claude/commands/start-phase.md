---
description: Start a Flolist roadmap phase in a fresh session (loads only the needed docs)
argument-hint: <phase id, e.g. M2.1>
---
We are starting Flolist phase **$ARGUMENTS**.

**Pre-flight (do this before anything else, in order):**

A. Run `git status --porcelain`. If it prints anything (uncommitted or untracked changes), **stop**: show me the list and ask what to do. Don't stash, commit, or discard on your own.
B. Run `git switch main && git pull --ff-only origin main`. If the pull fails (diverged history, conflicts, no network), stop and tell me.
C. Find the previous phase's PR: `gh pr list --state all --search "head:phase/" --limit 5 --json number,title,headRefName,state,url`, and take the most recent one that isn't for $ARGUMENTS. If its state is `OPEN` (not merged), **warn me** (number, title, link) and ask whether to continue before going further. If it's `CLOSED` without merging, mention it too. If it's `MERGED`, carry on.

**Then:**

1. Read `docs/roadmap.md`: the **Handoff** block and the section for phase $ARGUMENTS only.
2. Read `docs/decisions.md` in full. It is binding.
3. Read only the files listed under `Specs:` for $ARGUMENTS (paths are relative to `docs/`). Don't open other spec files unless you're blocked, and if you do, say which one and why.
4. Check the current repo state (`git log --oneline -10` and the relevant folders).
5. Mark the phase `[~]` in the roadmap, create the branch `phase/$ARGUMENTS-<slug>` from the freshly pulled `main`, then reply with:
   - a numbered implementation plan (≤12 steps) mapped to the phase checkboxes
   - any open questions or `[assumption]`s you need me to confirm. If there are none, say so and start step 1.
