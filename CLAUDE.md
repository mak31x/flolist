# Flolist — project brief for Claude Code

Flolist is a task + notes app that copies **Superlist** (superlist.com) feature for feature, **without** any AI, voice or meeting features.
It is one **React + TypeScript** codebase. The web app is self-hosted on an Oracle Cloud Always-Free Ampere (arm64) VM. Native apps wrap the same web build: **Tauri** for macOS and Windows, **Capacitor** for Android and iOS.
It starts as a single-user app and later grows into company-wide use, so workspaces (Personal + Teams) exist from day one.
There is no logo yet; use the wordmark "Flolist".

> This file is loaded into every session, so keep it short. Details live in `docs/`; read only what the current phase needs.

## Session protocol (one Claude Code chat = one phase)
1. Start with `/start-phase <id>`, e.g. `/start-phase M2.1`. Without the command:
   - read `docs/roadmap.md` → the **Handoff** block + the current phase section
   - read `docs/decisions.md`. It is binding; don't re-decide anything already settled there.
   - read **only** the spec files listed under the phase's `Specs:`
2. Write a short plan. Ask if the scope is unclear.
3. Build in small, tested steps. Run `pnpm check` before claiming anything is done.
4. End with `/wrap-phase`: tick the roadmap, rewrite the Handoff (≤15 lines), append new decisions (ADR-lite), commit (Conventional Commits).
5. Don't pull work forward from later phases. Put ideas in `docs/roadmap.md → Backlog`.

Never `@import` the spec files into this file. That would load them in every session and defeat the split.

## Stack (summary; the reasons are in docs/decisions.md, the details in docs/architecture.md)
- **Monorepo:** pnpm workspaces + Turborepo, TypeScript strict everywhere.
- **Web app** `apps/web`: React + Vite + TanStack Router + TanStack Query, Zustand (UI state), Tailwind CSS v4 with CSS-variable tokens, Radix UI primitives, dnd-kit, Tiptap (inline rich text inside blocks), chrono-node (natural-language dates), rrule (recurrence), vite-plugin-pwa.
- **API** `apps/api`: Node + Hono, REST + WebSocket for live sync, zod schemas shared via `packages/shared`.
- **Auth:** Better Auth (email/password + Google OAuth, sessions in Postgres, organization plugin = teams; bearer tokens for native apps).
- **DB:** PostgreSQL + Drizzle ORM/migrations. **Jobs:** pg-boss in `apps/worker` (reminders, push, email, digests).
- **Files:** S3-compatible storage (RustFS in dev per D-018, OCI Object Storage in prod).
- **Native shells:** `apps/desktop` (Tauri 2: macOS, Windows) and `apps/mobile` (Capacitor: Android, iOS) load the same web build. Platform APIs go through `apps/web/src/platform/` adapters.
- **Deploy:** Docker Compose on Oracle Ampere A1. **All images must be linux/arm64.** Caddy handles TLS and the reverse proxy. Nightly `pg_dump`.
- Pin the latest stable versions at scaffold time and record them in decisions.md. Never guess an API: check the library docs when unsure.

## Repo layout
```
apps/web        React SPA (also the UI for every native shell)
apps/api        Hono HTTP + WebSocket server
apps/worker     pg-boss job runner
apps/desktop    Tauri 2 shell (macOS, Windows)            — from M10
apps/mobile     Capacitor shell (Android, iOS)            — from M11
packages/shared zod schemas, types, permissions matrix, dates/recurrence/positions helpers
packages/db     Drizzle schema, migrations, seed
packages/ui     tokens, themes, base components
infra/          docker-compose.{dev,prod}.yml, Caddyfile, backup scripts
docs/           roadmap, decisions, architecture, deploy, spec/*
```

## Commands (keep these up to date)
- `pnpm dev`: web (:5174) + api (:3000) + worker, after starting `infra/docker-compose.dev.yml` (postgres, rustfs, mailpit). Copy `.env.example` to `.env` first
- `pnpm infra:up` / `pnpm infra:down`: only the Docker services · `pnpm format`: Prettier write
- `pnpm check`: prettier check + lint + typecheck + unit/integration tests (CI runs it on PRs; API tests start a Postgres container, so Docker must be running) · `pnpm test:e2e`: Playwright (added in M1.1)
- `pnpm db:generate` (drizzle-kit SQL migration from the schema) / `pnpm db:migrate` / `pnpm db:seed` (deterministic, rerunnable)
- Deploy: every merge to `main` runs `.github/workflows/deploy.yml` (arm64 image → VM, with auto-rollback). Runbook: docs/deploy-oracle.md
- Later: `pnpm desktop:dev` (Tauri), `pnpm mobile:android` (Capacitor)

## Non-negotiable rules
- **Out of scope; never build:** Talk/voice capture, "Make with AI", AI chat, AI summaries or title suggestions, meeting recording/notes/transcription (and the Meetings sidebar item), paid plans, billing and upgrade prompts. Leave no stubs and no "coming soon" items.
- **Parity first:** when behaviour is unspecified, copy Superlist. If Superlist's behaviour is unknown, choose the simplest option, mark it `[assumption]` in the spec and log it in decisions.md.
- **The server authorizes everything.** All data is workspace-scoped, and every handler calls `authorize()` (permission matrix in `packages/shared/permissions`). Never trust client-sent IDs for access.
- **Ordering** uses fractional-index strings (`position`); never integer reindexing.
- **Soft delete** (`deleted_at`, `deleted_by`, `trash_root_id`) for lists, blocks and tasks. Hard delete only from Trash.
- **Dates:** store `due_date` + optional `due_time` + IANA `due_tz`. Reminders are absolute UTC `remind_at`.
- **Live sync:** every mutation emits a change event to its channels over WebSocket, and clients patch the TanStack Query cache.
- **Optimistic UI** for all common actions (create, complete, reorder, edit), with rollback and a toast on error.
- **Keyboard-first:** every shortcut in docs/spec/keyboard-shortcuts.md must work. `Mod` = ⌘ on macOS, Ctrl elsewhere.
- **Wrapper-safe code:** no browser API that Tauri or Capacitor can't provide unless it goes through a `platform/` adapter.
- **Themes** come from CSS variables only. Components never hard-code colours.
- **Accessibility:** Radix primitives, visible focus rings, full keyboard navigation, respect `prefers-reduced-motion`.
- **No secrets in the repo.** Keep `.env.example` documented and `.env` gitignored.
- **Tests:** an integration test for every API route (permissions included), unit tests for shared logic, and Playwright e2e for critical flows.
- **Responsive** from 360px wide, because the same build becomes the phone app.

## Where things are
| Need | File |
|---|---|
| Milestones, phases, handoff, backlog | docs/roadmap.md |
| Decisions log (binding) | docs/decisions.md |
| Stack, sync, auth, storage, conventions | docs/architecture.md |
| Oracle VM + deploy runbook | docs/deploy-oracle.md |
| Look and feel, layout, themes, components, motion | docs/spec/ui-design.md |
| Sidebar, Inbox, Today, Week, All tasks, Lists, Updates, search, workspace filter | docs/spec/views.md |
| Lists, sections, favorites, block editor, sublists | docs/spec/lists-and-blocks.md |
| Tasks, subtasks, dates, repeat, reminders, labels, priority, activity | docs/spec/tasks.md |
| Workspaces, teams, sharing, assigning, messages, notifications | docs/spec/collaboration.md |
| Settings, themes list, Trash, export, account | docs/spec/settings-and-account.md |
| Keyboard shortcuts | docs/spec/keyboard-shortcuts.md |
| Integrations (email forwarding, GCal, Gmail, GitHub, Slack, Linear) | docs/spec/integrations.md |
| Tables and relations | docs/spec/data-model.md |
| Tauri (macOS, Windows) and Capacitor (Android, iOS) plan | docs/spec/platforms.md |
