# Flolist

A self-hosted task and notes app modelled on Superlist, without the AI features. One React + TypeScript codebase runs as a web app (hosted on Oracle Cloud) and is wrapped with Tauri for macOS and Windows and with Capacitor for Android and iOS.

## Prerequisites (on your Mac)
- Node LTS and pnpm (`corepack enable`)
- Docker Desktop (for local Postgres, MinIO and Mailpit)
- Claude Code
- Later: Rust and Xcode for Tauri (M10), Android Studio for Capacitor (M11)

## How to build it with Claude Code
1. Create an empty git repo, copy this folder into it, and commit.
2. Answer the open questions at the bottom of `docs/decisions.md`. Q-1 to Q-3 are needed early.
3. Open Claude Code in the repo and run `/start-phase M0.1`.
4. When the phase is done, run `/wrap-phase`. It updates the roadmap handoff and the decisions log, then commits.
5. Start a **new** Claude Code chat (or `/clear`) and run `/start-phase <next id>`. Repeat for each phase.

Each new chat loads only `CLAUDE.md`, the roadmap handoff, `decisions.md` and the 1–3 spec files the phase needs, so the context stays small.

## Files
- `CLAUDE.md`: project brief and rules, loaded in every chat
- `docs/roadmap.md`: milestones → phases, handoff notes, backlog
- `docs/decisions.md`: binding decisions (ADR-lite) and open questions
- `docs/architecture.md`, `docs/deploy-oracle.md`: technical design and server runbook
- `docs/spec/*`: feature specs from the Superlist research (ui-design, views, lists-and-blocks, tasks, collaboration, settings-and-account, keyboard-shortcuts, integrations, data-model, platforms)
- `.claude/commands/`: the `/start-phase` and `/wrap-phase` commands
