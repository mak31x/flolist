# Flolist — Decisions log

These decisions are binding for every session. Append new entries at the bottom, numbered in sequence. Never edit an accepted decision. To change one, add a new entry that says `Supersedes D-xxx` and set the old one's status to `Superseded by D-yyy`.

> History: on 2026-11-24 the stack briefly changed to Flutter + Rust. On 2026-11-25, still before any code existed, the owner reverted to the original React/Node + wrappers stack. Because nothing had been built, this file was rewritten cleanly instead of carrying superseded entries. The collaboration findings from hands-on Superlist testing (D-016) were kept.

Format:
```
## D-xxx — Title  (YYYY-MM-DD · Accepted | Proposed | Superseded by D-yyy)
Context · Decision · Alternatives · Consequences   (short)
```

---

## D-001 — Product scope: Superlist parity minus AI/voice/meetings  (2026-11-24 · Accepted)
Context: The owner wants a personal task manager that can later be used company-wide. Superlist is the reference for UI and features.
Decision: Copy Superlist's information architecture, UI, collaboration model and non-AI features. Exclude Talk (voice capture), Make with AI, AI chat, AI summaries/title suggestions, meeting recording/notes/transcription (and the Meetings sidebar item), and plans/billing. Voice *messages* on tasks are not AI, but they're parked in the backlog.
Consequences: The specs describe only the included features. Superlist's plan limits are not copied (D-013).

## D-002 — Name and branding  (2026-11-24 · Accepted)
Decision: The product is called **Flolist**. There's no logo yet: use a text wordmark "Flolist" in the accent colour, and a rounded-square "F" for the favicon and app icon. Keep the brand constants in `packages/ui/brand.ts`.

## D-003 — Client: one React/TypeScript web app, wrapped for native  (2026-11-25 · Accepted)
Context: The web app comes first (self-hosted). Native apps follow: macOS and Android first, then iOS and Windows.
Decision: A single React SPA in `apps/web` that ships as a web app/PWA. Native apps load the same build: **Tauri 2** (`apps/desktop`) for macOS and Windows, and **Capacitor** (`apps/mobile`) for Android and iOS. Native-only features (global hotkey, menu bar, widgets, share sheet) are thin plugins behind `apps/web/src/platform/` adapters.
Alternatives: Flutter (closest to Superlist natively, but web rendering is weaker and it means a second ecosystem; tried and reverted). React Native + web (two UI stacks). Separate native apps (multiplies work).
Consequences: The UI must feel desktop-class on macOS inside Tauri: native menu bar, hidden title bar, context menus and drag and drop. Responsive and touch-friendly from the start. Avoid browser APIs the wrappers lack, or wrap them in adapters.

## D-004 — Backend: Node + Hono + PostgreSQL + Drizzle  (2026-11-24 · Accepted)
Context: Hosted on an Oracle Always-Free Ampere A1 VM (arm64). Needs relational data, permissions, live sync and background jobs.
Decision: A Hono API on Node (`apps/api`), PostgreSQL with Drizzle ORM + SQL migrations (`packages/db`), a WebSocket server in the API process, and pg-boss for jobs in a separate `apps/worker` process.
Alternatives: Supabase self-hosted (heavy, many containers). PocketBase (SQLite and its permission DSL are weaker for multi-tenant company use). Rust/Axum (lean, but slower to iterate; tried and reverted).
Consequences: Permission checks are ours to write: a central `authorize()` plus integration tests. Backups are ours to run.

## D-005 — Auth: Better Auth  (2026-11-24 · Accepted)
Decision: Better Auth with email/password (with email verification and reset), Google OAuth, sessions in Postgres, and the **organization plugin** to model team workspaces (roles owner/member, invitations). A personal workspace is created at sign-up. Native shells authenticate with Better Auth bearer tokens stored in the OS keychain (Tauri: keyring/stronghold plugin; Capacitor: secure storage plugin). Google sign-in in native shells uses the system browser plus a deep link (`flolist://auth/callback`).
Alternatives: Lucia (deprecated as a library), Auth.js (weaker organization support), Keycloak (heavy).
Consequences: Check the current Better Auth docs when implementing, especially the organization plugin, bearer plugin and Expo/native guidance. Map Better Auth organizations to our `workspaces` table (data-model.md).

## D-006 — Sync: server-authoritative, optimistic client, WebSocket push; offline added in M8  (2026-11-24 · Accepted)
Context: A full local-first sync engine is a lot of work, but Superlist syncs instantly across devices and works offline on mobile.
Decision:
- **M0–M7:** REST mutations with optimistic updates via TanStack Query. The server broadcasts change events over one WebSocket per client on channels `user:<id>`, `list:<rootId>` and `workspace:<id>`, and clients patch the cache or refetch.
- Every row has a `version`; conflicts resolve as last-write-wins **per field**.
- Mutations are idempotent: the client generates a UUIDv7 `id` plus a `clientMutationId`.
- **M8:** the TanStack Query cache is persisted to IndexedDB and a durable mutation queue is added, so the app works offline before the native apps ship.
Alternatives: Zero (Rocicorp), PowerSync, ElectricSQL, Replicache. Re-evaluate them at M8 if the home-grown queue gets painful. Yjs/CRDT is overkill without real-time co-editing of the same paragraph.
Consequences: Two people editing the same text block at once means last write wins, which is accepted for v1. Access changes (list shared or unshared, team joined or left) emit `access_changed` events so clients refetch their list index.

## D-007 — Content model: blocks as rows  (2026-11-24 · Accepted)
Decision: A `blocks` table holds an ordered (fractional `position`) list of typed blocks per container (`list` or `task`). Text blocks store Tiptap/ProseMirror inline JSON in `content`. A `task` block references `tasks`; a `sublist` block references a child row in `lists`. Each text block is edited by a small inline Tiptap editor, and our own block editor handles movement between blocks (Enter, Backspace, arrows, Tab, drag).
Alternatives: One Tiptap document per list (makes per-task permissions, cross-list queries and sync hard). Lexical (needs the same custom work).
Consequences: Today/Inbox/Week are plain SQL. The block editor's keyboard handling needs careful tests. Copy/paste across blocks goes through our own serializer (Markdown + HTML + internal JSON).

## D-008 — Ordering with fractional indexing  (2026-11-24 · Accepted)
Decision: Everything the user can reorder (blocks, sidebar entries, sections, Inbox/Today manual order) uses string `position` keys from the `fractional-indexing` package. The client generates them; the server validates them.

## D-009 — Recurrence with RFC 5545 RRULE  (2026-11-24 · Accepted)
Decision: Store `recurrence_rule` (an RRULE string) and `recurrence_anchor` ('due' | 'completion'; default 'due', matching Superlist). Completing a recurring task logs a row in `task_completions` and moves the same task to its next due date. Its details are kept and its subtasks are reset to incomplete `[assumption]`. Helpers live in `packages/shared/recurrence` (using `rrule`) and are used by both web and api.

## D-010 — Hosting: Oracle Always-Free Ampere A1, Docker Compose, Caddy  (2026-11-24 · Accepted)
Decision: One VM (Ampere A1, arm64, Ubuntu LTS). Compose services:
- `caddy` (TLS, serves the static web build, proxies `/api` and `/ws`)
- `api`
- `worker`
- `postgres`
- optionally `minio`

All images are built for `linux/arm64` (multi-arch buildx in GitHub Actions, pushed to GHCR). Deploys run over SSH from Actions, with migrations before restart.
Alternatives: k3s (overkill). A Cloudflare Tunnel variant is documented in deploy-oracle.md.
Consequences: Nightly `pg_dump` to object storage. Keep the Flolist RAM budget around 2–4 GB so the VM can also run the owner's n8n.

## D-011 — UI system: Tailwind v4 + CSS variables + Radix  (2026-11-24 · Accepted)
Decision:
- Design tokens are CSS custom properties per theme (`[data-theme="ocean"]` etc.) in `packages/ui/themes.css`. Tailwind maps to those variables.
- Radix primitives provide menus, popovers, dialogs, tooltips and toggles.
- Icons come from Lucide.
- The UI font is Inter Variable and big titles use Plus Jakarta Sans `[assumption]`, both self-hosted via Fontsource.
- Motion uses Motion (formerly Framer Motion) for layout/collapse animations, with constants in `packages/ui/motion.ts`.

Consequences: All 14 themes (plus "System preference") are token sets only.

## D-012 — Notifications, email, files  (2026-11-24 · Accepted)
Decision:
- **Push:** Web Push (VAPID) for the web/PWA. FCM for Android (and iOS via APNs) through the Capacitor push plugin. Native notifications in Tauri via its notification plugin. The worker picks the channel per device.
- **Email:** SMTP via Nodemailer, with the provider set by env (Mailpit in dev).
- **Files:** S3-compatible storage with presigned upload/download URLs (MinIO in dev, OCI Object Storage in prod). Default limit 25 MB per file, configurable.

## D-013 — No billing; configurable limits  (2026-11-24 · Accepted)
Decision: No plans, prices or upgrade UI. Limits are server env settings: `MAX_UPLOAD_MB=25`, `MAX_WORKSPACE_STORAGE_GB`, `MAX_LIST_MEMBERS=25`, `MAX_TEAM_MEMBERS=` (empty = unlimited).

## D-014 — Testing and quality gates  (2026-11-24 · Accepted)
Decision: Vitest for unit tests (shared, web logic) and API integration tests (against a Postgres test container). Playwright for e2e. ESLint + Prettier. GitHub Actions runs `pnpm check` + e2e on PRs. A merge to `main` builds arm64 images + the web bundle and deploys. Native shell builds are added in M10/M11.

## D-015 — Native platform order: macOS before Android  (2026-11-25 · Accepted)
Context: The owner listed "Android and Mac first" and later said they prefer a native Mac app over the web version.
Decision: After the web app is stable and offline-capable (M8), build **macOS (Tauri) in M10**, then **Android (Capacitor) in M11**, then iOS and Windows in M12. Integrations (M9) can be re-ordered after M10 if the owner wants the Mac app sooner.

## D-016 — Collaboration model (based on observed Superlist behaviour)  (2026-11-24 · Accepted)
Decision:
- Every list is owned by exactly **one workspace**: Personal or a Team.
- Lists are **private to their creator until shared**, team-owned lists included. Even the team owner can't see a member's private team list.
- Sharing adds **collaborators**: individual users (anyone registered, inside or outside the team) and/or **whole teams**. A team-owned list has a "Shared with the team" toggle that adds or removes its own team as a collaborator.
- A list can be moved between workspaces instantly from the Share popover (by its creator, or by the owning team's owner). Existing collaborators, including other teams, are kept.
- The per-user **workspace visibility toggles** filter by the list's *owner workspace* only.

Full details, including member-side rules we decided ourselves, are in spec/collaboration.md.

---

## Open questions (resolve, then turn into decisions)
- Q-1: Production domain, e.g. `app.flolist.<tld>` or a subdomain of an existing domain? → needed in M0.4.
- Q-2: SMTP provider (Brevo, Resend, Zoho, Amazon SES…)? → needed in M1.1.
- Q-3: Share the Oracle VM with n8n, or use a separate Always-Free VM? → needed in M0.4.
- Q-4: Should the MCP-server equivalent (which lets AI assistants use Flolist) be built? It's AI-adjacent, so it's parked in the backlog unless approved.
- Q-5: An Apple Developer account ($99/yr) is needed to sign and notarize the macOS Tauri app (and later iOS) → needed in M10. Local unsigned builds work until then.
- Q-6: A Firebase project for FCM (Android/iOS push) → needed in M11.
