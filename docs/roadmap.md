# Flolist roadmap

Each phase is one Claude Code chat. Start it with `/start-phase <id>` and end it with `/wrap-phase`.
Status: `[ ]` todo · `[~]` in progress · `[x]` done.

## Handoff (rewritten at the end of every phase; ≤15 lines)
- **Last phase:** M4.1 Inbox + Today (done; branch `phase/M4.1-inbox-today`). D-075–D-080.
- **State:** migration 0008 (`inbox_items`, `today_order`, `blocks.root_list_id` nullable for task bodies only). Tasks in no list resolve through their top-level task's creator (`task.view/edit`, `workspace.createTask`). Task and body-block events also go to `user:<id>` of everyone who sees the task (`tasks/audience.ts`).
- **API:** `GET /inbox`, `POST /inbox/tasks`, `PUT|DELETE /inbox/items/:taskId`; `GET /today?date=`, `PUT /today/order`, `POST /today/reschedule`; `GET /tasks/:id/page` + `POST /tasks/:id/blocks/batch` (Inbox-only task bodies; same `applyBlockBatch` as lists, `blocks/batch.ts`); `DELETE /tasks/:id`, `POST /tasks/:id/restore`, `POST /tasks/:id/move {listId|null}` (Remove from list / into a list).
- **Web:** `features/task-views/` (InboxView, TodayView, TaskViewRow over `Task` DTOs shaped as blocks, TaskPanel, mutations, view-actions + ViewActionUi, selection, inbox-actions, view-prefs). `shell/panel-task.ts` routes details for `/inbox/tasks/:id` and `/today/tasks/:id`. BlockStore/BlockEditor take `pageKind: "task"`. `editor/drop-targets.ts`; sidebar Inbox has `data-drop-inbox`.
- **Run / verify:** `pnpm infra:up`, `pnpm dev`; Inbox New task / Enter / details body; Today overdue → Reschedule all, Completed tab, ‹ ›; right-click → Add to Inbox / Remove from list / Move to list; Quick create → New task; C and ^N (Alt+N). `pnpm check`; `pnpm test:e2e` (inbox-today.spec.ts).
- **Gotchas:** e2e flakes under full local parallelism on a busy machine; use `--workers=2` to confirm. Hooks keyed on the shell's `PanelTask` object must use its fields (a new `close` each render looped navigation). Live block deletes apply only up to their version. New Inbox rows are seeded into the cache before `mutate` so typing lands; New task waits for the view to load. Inbox actions flush the editor store first.
- **Next:** M4.2 Week view (its columns' New task rows reuse `useCreateInboxTask` with a due date; Today's drag-reorder is Backlog).

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
### M3.2 Dates, priority, labels, natural language `[x]`
Specs: spec/tasks.md (NL dates, due dates, labels, priority), spec/ui-design.md §6
- [x] Date picker popover; chrono-node wrapper + fixtures; suggestion popover; priority + labels + Settings → Labels
- [x] Priority / Due date / Label sorts in the funnel menu; ^T ^D ^⇧D ^L shortcuts; activity entries for the new fields
Done when: typing "pay rent tomorrow at 5pm" sets the date and strips that text from the title. ✔ (dates.spec.ts)
- Left for later phases: Remind me (M5.2) and Repeat (M5.1) rows in the date picker; repeat phrases are parsed but not offered until M5.1. `#label` in the quick command comes with M4.3.
### M3.3 Task actions + multiselect `[x]`
Specs: spec/tasks.md (actions), spec/views.md (Multiselect)
- [x] Task actions in a row context menu and the details ⋮ (one shared registry)
- [x] Multiselect in lists (Shift-click range, Mod-click toggle, long-press) with a floating action bar; dragging carries the selection
- [x] Duplicate, Move to list…, Copy link / as text / as Markdown; "moved" activity entries; ⌘⇧D and ⌘⌫ on a selection
- Deferred: Add to / Remove from Inbox and Remove from list (M4.1, needs the Inbox view), Assign (M7.3). The multiselect bar is used in lists only until M4's task views exist.
- Fixed in passing: M3.2's meta line always showed the empty priority/label icons on dated tasks (`inline-flex` beat `hidden`).

## M4 — Views, search, keyboard
### M4.1 Inbox + Today `[x]`
Specs: spec/views.md (Inbox, Today)
- [x] Inbox: `inbox_items`, tasks in no list (their own body page), New task row, nested subtasks, Hide completed + sorts, drag to reorder, details panel
- [x] Today: open tasks due that day or earlier from lists and the Inbox, Overdue group + Reschedule all, Open | Completed, ‹ › and calendar days, per-day manual order (stored), new tasks due that day into the Inbox
- [x] Add to / Remove from Inbox, Remove from list (⌘⇧R), Move to list for tasks in no list; row menus and multiselect in both views; drag Inbox rows onto sidebar lists and list tasks onto the sidebar Inbox
- [x] New task enabled: Quick create → Inbox, ^N / Alt+N and C in Inbox and Today
- Deferred: drag to reorder Today (order is stored and Enter places new tasks; no drag yet), due/label pickers in the view selection bar, date suggestions in view rows (Backlog). Week columns' New task rows are M4.2; All tasks' pill and ⌘K are M4.3.
- Fixed in passing: a move's live block deletes could wipe the moved rows from the target list's cache (deletes now carry the source copy's version, D-079); slash menu offered Sublist inside task bodies (server refused it).
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
- Lazy Tiptap (static HTML until focus) together with virtualization in M8.2, keeping iOS keyboard focus working (D-047)
- Indenting a list item could carry its deeper children along (outline behaviour); M2.2 moves only the block
- Keyboard reordering for sidebar sections (lists already reorder by keyboard; sections are mouse/touch only, D-044)
- Fix `pnpm --filter api` bundled build crashing under dev NODE_ENV (pino-pretty transport resolves `__dirname`)
- Undo for moving blocks to another list (D-054), and dropping blocks into a sidebar list by keyboard
- In a sorted list view, make ↑/↓ follow the shown order instead of the stored one (D-055)
- Show list covers on phones/tablets (a header image), since the right panel only exists on desktop (D-027)
- Copy files on Duplicate list instead of sharing them, if per-list file deletion ever needs it (D-053)
- Paste of a copied sublist could re-create the sublist (today it pastes its title, D-051)
- Resolve the ^P "Set priority" row in keyboard-shortcuts.md against D-068 (which ships no priority shortcut); decide and log it, then build or drop it
- Show the whole dragged selection moving (a drag overlay with a count); M3.3 moves only the grabbed row visually (D-073)
- One undo step for Move to list (today it clears the undo stack, D-054/D-071)
- E2e flake: lists.spec "sync live between two windows" sometimes fails under parallel load (seen in M3.3, unrelated to its changes)
- Shift+Tab on a subtask could carry its later siblings along as its own subtasks (outline behaviour); M3.1 moves only the task (D-059)
- Paste nested Markdown checklists as subtasks (they paste flat in M3.1, D-061)
- Trash tasks together with their deleted list, so Today/Inbox (M4) never surface them; M3.1 hides them only through the list's access (D-056)
- Live-update an open details panel when its task moves to another list (the old page gets block deletes only, D-056)
- Remember collapsed subtasks per user (M3.1 keeps it in component state)
- Sublists inside a task's details (lists-and-blocks.md allows it; M3.1 task bodies refuse sublist blocks, D-056)
- Accepting a date suggestion takes two undo steps (due date, then text); make it one (D-066)
- Label colours in the label picker/chips beyond the dot; a colour picker inside the task's label popover (D-067)
- A priority shortcut and a priority NL phrase ("!high") if Superlist has them (D-068)
- Show the due time in the task's own zone when it differs from the viewer's (today the wall-clock time is shown as stored, D-063)
- Drag to reorder rows in Today (per-day order is stored and used, M4.1 has no drag there, D-077)
- Due date / label pickers in the Inbox/Today selection bar (M4.1 bar: move, Inbox, Remove from list, complete, delete)
- Date suggestions (natural-language phrases) while typing a title in an Inbox/Today row (D-066 runs in list rows and the details panel only)
- Sync Inbox/Today filter and sort settings per user instead of per device (D-077)
- E2e: several older specs (lists two-window sync, task-actions multiselect, tasks) fail under full local parallelism on a loaded machine; all pass with `--workers=2` and alone (seen in M4.1)
- Let a subtask of an Inbox-only task move to a list on its own (M4.1 moves top-level tasks only, D-078)
