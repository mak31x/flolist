---
description: Finish the current Flolist phase, update docs for the next session, and commit
---
Wrap up the current phase:

1. Run `pnpm check`. If the phase touched UI flows, also run `pnpm test:e2e`. Fix any failures before continuing.
2. In `docs/roadmap.md`, tick the completed checkboxes and set the phase to `[x]`. If work remains, keep it at `[~]` and list what's left. Move any extra ideas to **Backlog**.
3. Rewrite the **Handoff** block (≤15 lines): the last phase, the current state, how to run and verify it, gotchas, and the exact id of the next phase.
4. Append every new decision from this session to `docs/decisions.md` (next D-number, ADR-lite format), including any libraries and versions you added. Mark open questions that are now resolved.
5. If a spec turned out wrong or incomplete, fix the spec file. Keep `[assumption]` tags honest.
6. If any scripts changed, update the Commands section of `CLAUDE.md`. Keep CLAUDE.md under ~150 lines.
7. Commit with a Conventional Commit message that summarises the phase. Then print the kickoff line for the next session: `/start-phase <next id>`.
