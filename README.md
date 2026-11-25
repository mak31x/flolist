# Flolist

A self-hosted task and notes app modelled on Superlist, without the AI features. One React + TypeScript codebase runs as a web app (hosted on Oracle Cloud) and is wrapped with Tauri for macOS and Windows and with Capacitor for Android and iOS.

## Prerequisites (on your Mac)

- Node 26 LTS (see `.nvmrc`) and pnpm 12 (the exact version is pinned in `package.json` → `packageManager`; pnpm switches to it automatically)
- Docker Desktop or OrbStack (for local Postgres, RustFS (S3) and Mailpit)
- Claude Code
- Later: Rust and Xcode for Tauri (M10), Android Studio for Capacitor (M11)

## Quickstart

```bash
pnpm install
cp .env.example .env
pnpm dev
```

`pnpm dev` starts the Docker services (`infra/docker-compose.dev.yml`), then the web app, API and worker in watch mode.

| What                | URL                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------- |
| Web app             | http://localhost:5174                                                               |
| API health          | http://localhost:3000/api/health (also proxied at http://localhost:5174/api/health) |
| Mailpit (dev inbox) | http://localhost:8026                                                               |
| RustFS console (S3) | http://localhost:9011 (keys from `.env`)                                            |
| Postgres            | `localhost:5433` (see `DATABASE_URL` in `.env`)                                     |

The host ports are offset from the usual defaults so Flolist can run next to other local stacks. Change them in `.env`.

Other commands:

- `pnpm check`: Prettier check, ESLint, typecheck and Vitest across the workspace (CI runs this on every PR)
- `pnpm format`: apply Prettier
- `pnpm infra:up` / `pnpm infra:down`: start or stop only the Docker services (data is kept in named volumes)

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
