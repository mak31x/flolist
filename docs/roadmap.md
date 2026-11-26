# Flolist roadmap

Each phase is one Claude Code chat. Start it with `/start-phase <id>` and end it with `/wrap-phase`.
Status: `[ ]` todo · `[~]` in progress · `[x]` done.

## Handoff (rewritten at the end of every phase; ≤15 lines)
- **Last phase:** M3.1 Task blocks + details panel (done; PR from `phase/M3.1-task-blocks`). D-056–D-062.
- **State:** migration 0006 adds `tasks`, `activity_events`, `blocks.task_id` (unique; CHECK: set exactly on `task` blocks) and `user_settings.getting_started_seeded_at`. A task block's content is the title (`tasks.title_inline` + plain `title` mirror it); the block DTO carries `taskId` + `task: {completedAt, completedBy}`. Subtasks are task blocks in a task's body (`container_type='task'`); `GET /lists/:id/blocks` returns the list's blocks **plus its tasks' bodies**, and the one batch route edits them all (`task: {id, completed}`, `container` on upsert/move; depth ≤ 4). Deleting a task block trashes its subtree (trash root = block); turning it into text trashes the task, undo restores it. New routes: `GET|PATCH /tasks/:id`, `GET /tasks/:id/activity`; `task` live events. `/me` seeds "Getting started" once (backfill for old accounts) and exposes `soundsEnabled`.
- **Web:** `editor/tree.ts` (`visibleTree`, `placeNear`, `subtaskProgress`, `ancestorIn`, `withDescendants`) — editors render the visible tree, never the raw cache. Store fields `taskId`/`completed`/`container`; one shared store per list page (`use-block-store.ts`, ref-counted). Task rows reuse the text-row layout (`TaskRow.tsx` marker/trailing) so Turn into keeps the editor mounted. `features/tasks/` (TaskDetails panel = BlockEditor rooted at `{type:"task"}`, ActivityLog). `lists/list-view.ts` filters/sorts with depth; `editor/reopen.ts` (Mark all incomplete); `platform.playCompleteSound`.
- **Run / verify:** `pnpm infra:up`, `pnpm db:migrate`, `pnpm dev`; in a list type `[] ` + text, Enter, Tab / Shift+Tab, click checkboxes, ⌘/Ctrl+D, ⌘/Ctrl+Enter or the row arrow (details), funnel → Hide completed / sorts, ⋮ → Mark all incomplete. `pnpm check`; `pnpm test:e2e` (tasks.spec.ts).
- **Gotchas:** new blocks need same-container positions (`placeNear`/`ctx.all()`), not neighbours of visible rows. Live upserts of body blocks find their page by the parent task's block (`pageOf` in store.ts). New accounts start with "Getting started" in Favorites — e2e list assertions filter it out (`SEEDED`). The built-in browser pane's `type`/key actions don't fire real keydowns: verify typing with Playwright. Stop preview dev servers before `pnpm test:e2e` (a reused API keeps the 10/min sign-up limit).
- **Next:** M3.2 Dates, priority, labels, natural language (add the due/priority/label columns + chips; the panel's chip row and the row's edit icon row are waiting for them).
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
### M2.2 Block editor core `[x]`
Specs: spec/lists-and-blocks.md (Block types, Editor behaviour), decisions D-007
- [x] Blocks API (batch upsert/move/delete with versions); paragraph, H1–H3, bullet, numbered, quote, divider
- [x] Per-block Tiptap, keyboard controller, markdown shortcuts, slash menu, block drag, undo/redo, copy/paste as Markdown
Done when: you can write a structured doc quickly using only the keyboard, and it survives a reload.
### M2.3 Media blocks, covers, sublists, list menu `[x]`
Specs: spec/lists-and-blocks.md
- [x] Image + attachment blocks, list cover in the right panel, sublists + breadcrumb, list ⋮ menu (Print, Duplicate, Go to <team>, Delete), filter menu
- Mark all incomplete moved to M3.1: it has nothing to reset until tasks exist (owner's call).

## M3 — Tasks
### M3.1 Task blocks + details panel `[x]`
Specs: spec/tasks.md (properties, creating, subtasks), spec/ui-design.md (§4 task row, §5 details panel)
- [x] Task block, completion animation + sound, hover affordances; details panel (chips, body editor, subtasks with Tab indent, progress ring); activity log
- [x] ⋮ Mark all incomplete (moved from M2.3); make "Show tasks only"/"Hide completed" and the task-field sorts work in `viewBlocks`; open-task count on sublist rows
- [x] Seed a "Getting started" list on sign-up (moved from M1.1; spec/settings-and-account.md → Authentication screens), with a backfill for users who signed up before it existed
- Left for later phases: the other property chips (M3.2, M7.3), the details ⋮ actions beyond Delete and Copy-as-Markdown with nested subtasks (M3.3), the message composer (M7.3). Mod+D (complete) was pulled in from M3.3 so the checkbox is keyboard-reachable.
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
- Server-side image resizing/thumbnails in the worker for uploads (architecture.md → Uploads); M2.3 downscales covers in the browser only, image blocks keep originals (D-052)
- Block handle on phones (long-press menu / drag) — hidden below 768px in M2.2 (D-047)
- Shift+click to extend a block selection with the mouse (D-048)
- Lazy Tiptap (static HTML until focus) together with virtualization in M8.2, keeping iOS keyboard focus working (D-047)
- Indenting a list item could carry its deeper children along (outline behaviour); M2.2 moves only the block
- Keyboard reordering for sidebar sections (lists already reorder by keyboard; sections are mouse/touch only, D-044)
- Fix `pnpm --filter api` bundled build crashing under dev NODE_ENV (pino-pretty transport resolves `__dirname`)
- Undo for moving blocks to another list (D-054), and dropping blocks into a sidebar list by keyboard
- In a sorted list view, make ↑/↓ follow the shown order instead of the stored one (D-055)
- Show list covers on phones/tablets (a header image), since the right panel only exists on desktop (D-027)
- Copy files on Duplicate list instead of sharing them, if per-list file deletion ever needs it (D-053)
- Paste of a copied sublist could re-create the sublist (today it pastes its title, D-051)
- Shift+Tab on a subtask could carry its later siblings along as its own subtasks (outline behaviour); M3.1 moves only the task (D-059)
- Paste nested Markdown checklists as subtasks (they paste flat in M3.1, D-061)
- Trash tasks together with their deleted list, so Today/Inbox (M4) never surface them; M3.1 hides them only through the list's access (D-056)
- Live-update an open details panel when its task moves to another list (the old page gets block deletes only, D-056)
- Remember collapsed subtasks per user (M3.1 keeps it in component state)
- Sublists inside a task's details (lists-and-blocks.md allows it; M3.1 task bodies refuse sublist blocks, D-056)
