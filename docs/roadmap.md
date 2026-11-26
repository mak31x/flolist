# Flolist roadmap

Each phase is one Claude Code chat. Start it with `/start-phase <id>` and end it with `/wrap-phase`.
Status: `[ ]` todo · `[~]` in progress · `[x]` done.

## Handoff (rewritten at the end of every phase; ≤15 lines)
- **Last phase:** M2.1 Lists + sidebar + live sync (done; PR from `phase/M2.1-lists-sidebar-sync`). Lists CRUD, emoji picker, star/unstar, sections, sidebar drag reorder, All lists page, WebSocket live sync (D-040–D-044).
- **State:** migration 0003 adds `lists`, `list_view_prefs` (holds `last_opened_at`), `sections`, `sidebar_entries`, `outbox`, `applied_mutations`. Routes: `/api/v1/lists` (GET, POST, GET/PATCH/DELETE `/:id`, POST `/:id/open`), `/api/v1/sections`, `/api/v1/sidebar` (+ `PUT/DELETE /entries/:listId`). Every mutation goes through `runMutation()` (apps/api/src/sync/mutation.ts): idempotent per `clientMutationId`, `emit()` writes outbox rows in the same tx, `afterMutation` kicks the drainer → `Hub` → `/ws`.
- **Web:** `features/lists` (api, cache helpers, `useOptimistic` mutations, SidebarLists with dnd-kit, ListPage, AllListsPage, QuickCreate), `features/sync` (LiveSocket, `applyChange`, `useListChannel`). Lists are private to their creator; only Personal is used (sharing = M7).
- **Run / verify:** `pnpm infra:up`, `pnpm dev`, open two windows on http://localhost:5174 and create/rename/drag lists. `pnpm check`; `pnpm test:e2e` (lists.spec.ts runs two browser contexts).
- **Gotchas:** positions are fractional-indexing keys compared byte-wise: sort with `collate "C"` in SQL and `compareKeys` in JS, never `localeCompare`. Radix menus must `preventDefault` `onCloseAutoFocus` when an action focuses an input (new list title, inline rename). Client skips socket events while a mutation with the same query key is pending, then invalidates. `/api/v1/*` now 401s before validation. The bundled API crashes in dev on pino-pretty (`__dirname`); prod mode is fine. Sections have no keyboard reorder yet (Backlog). Emoji data is self-hosted at `/emojibase` (Vite plugin).
- **Next:** M2.2 Block editor core (blocks API with versions; per-block Tiptap, keyboard controller, slash menu, block drag, undo/redo). Reuse `runMutation`/`emit`, `list:<rootId>` channels and `applyChange`.
---

## M0 — Foundation and walking skeleton
### M0.1 Monorepo scaffold `[x]`
Specs: architecture.md
- [x] pnpm + Turborepo workspace: apps/web, apps/api, apps/worker, packages/shared|db|ui; TS strict; ESLint + Prettier; Vitest
- [x] `pnpm dev` and `pnpm check` scripts; `.env.example`; `.gitignore`; README quickstart
- [x] infra/docker-compose.dev.yml (postgres, rustfs (S3; replaced minio, D-018), mailpit)
- [x] GitHub Actions: `pnpm check` on PRs; record the pinned versions in decisions.md
Done when: `pnpm dev` serves a hello page, `/api/health` returns ok, and `pnpm check` passes.

### M0.2 DB + API skeleton `[x]`
Specs: architecture.md, spec/data-model.md (identity + workspaces only)
- [x] Drizzle setup, first migrations, seed script
- [x] Hono structure: error format, zod validation, `authorize()` skeleton + `packages/shared/permissions` with its fixtures format, logging, rate limit
- [x] Vitest integration harness against a Postgres test container
Done when: migrations and seed run, and a sample route passes its tests.

### M0.3 App shell + design tokens `[x]`
Specs: spec/ui-design.md, spec/settings-and-account.md (themes list only)
- [x] packages/ui tokens, Light + Dark themes (the rest come in M6), fonts, motion constants
- [x] Three-column shell (sidebar, main card, right cover panel), responsive breakpoints, routes for every view (placeholders)
- [x] Base components (Pill/Chip, IconButton, SegmentedTabs, KbdHint, Popover, Menu, Dialog, Toast, EmptyState, SkeletonSquiggle, Avatar/AvatarStack, Toggle, animated Checkbox)
Done when: the shell matches ui-design §1 at 1440px and 375px.

### M0.4 CI/CD + first deploy to Oracle `[x]`
Specs: deploy-oracle.md
- [x] arm64 image build + GHCR push; docker-compose.prod.yml + Caddyfile; server setup done (document any deviations)
- [x] Deploy job with migrations + health check; nightly backup script
Done when: `https://app.<domain>` serves the shell over HTTPS and every merge redeploys it.

## M1 — Auth and profile
### M1.1 Better Auth `[x]`
Specs: architecture.md (Security), decisions D-005, spec/settings-and-account.md (auth screens)
- [x] Email/password + verification + reset, Google OAuth, sessions, bearer plugin enabled (for native later), organization plugin configured
- [x] Login/sign-up screens; protected routes; personal workspace on sign-up (the "Getting started" list moved to M3.1); SMTP via env (Hostinger in prod, D-032)
Done when: e2e covers sign-up → verify → land in Inbox. Google sign-in is wired and turns on when `GOOGLE_CLIENT_ID/SECRET` are set; it hasn't been exercised against Google yet (no OAuth client exists; Backlog).
### M1.2 Profile settings + files `[x]`
Specs: spec/settings-and-account.md (Profile)
- [x] Settings layout with pill tabs; Profile (name, photo, timezone, first day of week, language placeholder); files service (presigned upload/download; relay upload for OCI, D-037)
Done when: e2e edits the profile, uploads a photo and sees it all after a reload. The activity heatmap, export and account deletion stay in M6.3.

## M2 — Lists and the block editor
### M2.1 Lists + sidebar + live sync `[x]`
Specs: spec/lists-and-blocks.md (Lists, Sections), spec/views.md (Sidebar, All lists), architecture.md (Live sync)
- [x] Lists CRUD, emoji picker, star/unstar, sections CRUD, sidebar drag reorder, All lists page
- [x] WebSocket hub v1 + outbox + client `applyChange`
Done when: lists and sections persist, reorder, and sync live between two browser windows.
### M2.2 Block editor core `[ ]`
Specs: spec/lists-and-blocks.md (Block types, Editor behaviour), decisions D-007
- [ ] Blocks API (batch upsert/move/delete with versions); paragraph, H1–H3, bullet, numbered, quote, divider
- [ ] Per-block Tiptap, keyboard controller, markdown shortcuts, slash menu, block drag, undo/redo, copy/paste as Markdown
Done when: you can write a structured doc quickly using only the keyboard, and it survives a reload.
### M2.3 Media blocks, covers, sublists, list menu `[ ]`
Specs: spec/lists-and-blocks.md
- [ ] Image + attachment blocks, list cover in the right panel, sublists + breadcrumb, list ⋮ menu (Print, Duplicate, Mark all incomplete, Go to <team>, Delete), filter menu

## M3 — Tasks
### M3.1 Task blocks + details panel `[ ]`
Specs: spec/tasks.md (properties, creating, subtasks), spec/ui-design.md (§4 task row, §5 details panel)
- [ ] Task block, completion animation + sound, hover affordances; details panel (chips, body editor, subtasks with Tab indent, progress ring); activity log
- [ ] Seed a "Getting started" list on sign-up (moved from M1.1; spec/settings-and-account.md → Authentication screens), with a backfill for users who signed up before it existed
### M3.2 Dates, priority, labels, natural language `[ ]`
Specs: spec/tasks.md (NL dates, due dates, labels, priority), spec/ui-design.md §6
- [ ] Date picker popover; chrono-node wrapper + fixtures; suggestion popover; priority + labels + Settings → Labels
Done when: typing "pay rent tomorrow at 5pm" sets the date and strips that text from the title.
### M3.3 Task actions + multiselect `[ ]`
Specs: spec/tasks.md (actions), spec/views.md (Multiselect)

## M4 — Views, search, keyboard
### M4.1 Inbox + Today `[ ]`  Specs: spec/views.md (Inbox, Today)
### M4.2 Week view `[ ]`  Specs: spec/views.md (Week)
### M4.3 All tasks, search, quick command, shortcuts `[ ]`  Specs: spec/views.md (All tasks, Search, Quick command), spec/keyboard-shortcuts.md
Done when (M4): a full day of work is possible without the mouse.

## M5 — Recurrence, reminders, notifications
### M5.1 Recurring tasks `[ ]`  Specs: spec/tasks.md (Recurring), D-009
### M5.2 Reminders + Web Push `[ ]`  Specs: spec/tasks.md (Reminders), D-012, architecture.md (Jobs)
### M5.3 Updates feed `[ ]`  Specs: spec/views.md (Updates), spec/collaboration.md (Notifications)

## M6 — Trash, settings, themes
### M6.1 Trash `[ ]`  Specs: spec/settings-and-account.md (Trash)
### M6.2 Themes + Features settings `[ ]`  Specs: spec/settings-and-account.md (Features, Themes), spec/ui-design.md §3
### M6.3 Export, account deletion, activity heatmap, summary emails `[ ]`  Specs: spec/settings-and-account.md (Profile, Notifications)

## M7 — Collaboration and teams
### M7.1 Teams + workspace filter `[ ]`  Specs: spec/collaboration.md (§1–3), spec/views.md (Workspace filter, Team page), spec/ui-design.md §7 + §10
- [ ] Teams (Better Auth organizations ↔ workspaces), team page (Lists/Tasks/Members), invitations, leave/remove/delete rules
- [ ] Avatar-menu toggles + avatar stack + collapse animations; "This list is hidden" state
### M7.2 Sharing `[ ]`  Specs: spec/collaboration.md (§4), spec/data-model.md (Access resolution)
- [ ] Share popover (workspace selector, "Shared with the team", invite users/teams, link access), accept/decline/leave, move list between workspaces, `access_changed` events, exhaustive permission tests from fixtures
### M7.3 Assigning, messages, mentions `[ ]`  Specs: spec/collaboration.md (§5–8), spec/tasks.md (Assignees)

## M8 — Offline, PWA, hardening (the gate before native apps)
### M8.1 Offline cache + mutation queue `[ ]`  Specs: decisions D-006, architecture.md. Re-evaluate Zero/PowerSync first and log the decision.
### M8.2 PWA polish, performance, accessibility audit `[ ]`  (virtualized lists, Lighthouse ≥ 90, axe clean)
### M8.3 Ops hardening `[ ]`  Specs: deploy-oracle.md (backups restore test, monitoring, staging)

## M9 — Integrations and API  (can move after M10 if the Mac app is wanted sooner; D-015)
### M9.1 Personal API tokens + webhooks `[ ]`  Specs: spec/integrations.md §8
### M9.2 Email forwarding `[ ]`  Specs: spec/integrations.md §1
### M9.3 Google Calendar `[ ]`  Specs: spec/integrations.md §2
### M9.4 Gmail `[ ]`  Specs: spec/integrations.md §3
### M9.5 GitHub + Linear `[ ]`  Specs: spec/integrations.md §4, §6
### M9.6 Slack `[ ]`  Specs: spec/integrations.md §5

## M10 — macOS (Tauri 2)  Specs: spec/platforms.md (macOS). Resolve Q-5.
### M10.1 Tauri shell: window chrome, native menu bar, auth via keychain + deep link, notifications `[ ]`
### M10.2 Global quick add, menu bar extra, Dock badge, signing/notarization, auto-update `[ ]`

## M11 — Android (Capacitor)  Specs: spec/platforms.md (Android). Resolve Q-6.
### M11.1 Capacitor shell, auth, FCM push, mobile UX polish (gestures, quick create, share target) `[ ]`
### M11.2 Widgets + Play release `[ ]`

## M12 — iOS and Windows  Specs: spec/platforms.md
### M12.1 iOS (Capacitor, APNs, share extension, WidgetKit, Sign in with Apple) `[ ]`
### M12.2 Windows (Tauri, installer, tray, auto-update) `[ ]`

---

## Backlog (don't build without promoting into a phase)
- Treat a 401 from any `/api/v1` call (not only `/me`) as "signed out": refetch `meQuery` so the shell returns to log in (M1.1 handles it via `/me` only)
- Add a WebKit Playwright project once the Tauri/Capacitor shells exist (D-035)
- Account-existence privacy on sign-up: "user already exists" is shown today (Better Auth default); decide whether to mask it like password reset does
- Google login on prod: the owner creates the Google Cloud OAuth client (redirect URI `https://flolist.levitatinglabs.com/api/auth/callback/google`) and adds `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` to `/opt/flolist/.env` (deferred from M1.1)
- Voice messages on tasks (recording only)
- Message reactions
- Per-list inbound email addresses
- Microsoft To Do sync
- MCP server (Q-4)
- Templates gallery
- Calendar month view
- Multi-window in the desktop app
- Team admin role (beyond owner/member)
- i18n (Hindi/Gujarati)
- Move to TypeScript 7 (native) once typescript-eslint supports it (D-017)
- Move the rate limiter to Postgres/Redis if the API ever runs on more than one node (D-023)
- Code-split the web bundle (route-level lazy imports) — 614 KB after M0.3; M0.4 didn't change it, so settle in M4 or M8.2
- Cover settings (gear button on the cover panel: choose a built-in cover or upload one) — with list covers
- Measure Superlist's real Dark palette and adjust the derived Dark tokens (D-027)
- Worker healthcheck in docker-compose.prod.yml once pg-boss runs jobs (M5); today it only stays alive
- Automate the front-proxy site block (it lives in the n8n stack's Caddyfile, D-029) if more Flolist hostnames appear (staging, app.flolist.com)
- Replace the temporary startrips.in sender with a Flolist address (D-032)
- Move transactional email to a dedicated provider (Resend/Brevo/SES) before company-wide use or high-volume digests (D-032)
- Let the VM pull from GHCR with a read-only token instead of a public package, if the repo ever goes private (D-030)
- Clean up stale `pending` files and orphaned objects (replaced avatars) with a worker job once pg-boss runs (D-037)
- A dedicated OCI IAM user whose Customer Secret Key can reach only the Flolist bucket (D-037)
- If OCI rejects presigned GETs, relay downloads through the API too (D-037)
- Move the older screens' inline English strings to `t()` (D-039)
- Change the primary email with re-verification (settings-and-account.md marks it a Flolist extra)
- Server-side image resizing/thumbnails in the worker for uploads (architecture.md → Uploads), with list covers
- Keyboard reordering for sidebar sections (lists already reorder by keyboard; sections are mouse/touch only, D-044)
- Fix `pnpm --filter api` bundled build crashing under dev NODE_ENV (pino-pretty transport resolves `__dirname`)
