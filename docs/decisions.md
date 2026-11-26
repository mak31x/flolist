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

## D-010 — Hosting: Oracle Always-Free Ampere A1, Docker Compose, Caddy  (2026-11-24 · Accepted; TLS/front proxy superseded by D-029)
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

## D-012 — Notifications, email, files  (2026-11-24 · Accepted; dev object storage superseded by D-018)
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

## D-017 — Toolchain and pinned versions (M0.1)  (2026-11-25 · Accepted)
Context: M0.1 pins the latest stable version of every tool at scaffold time, checked against the npm registry, Docker Hub and the GitHub releases.
Decision: Exact versions, no ranges:
- Runtime and package manager: Node 26 LTS (`.nvmrc`, `engines >=26 <27`), pnpm 12.23.0 (`packageManager`), Turborepo 2.11.13.
- **TypeScript 6.0.3**, not 7.0.2. typescript-eslint 8.74.0 supports only `typescript <6.1.0`; TS 7 (native) works only with the 7.1 dev builds through `@typescript/native`. Move to TS 7 once typescript-eslint supports a stable release (Backlog).
- Lint, format, test: ESLint 10.15.0 (flat config, `typescript-eslint` strictTypeChecked, react-hooks 7.1.1, react-refresh 0.5.8), Prettier 3.10.1, Vitest 5.1.1, jsdom 31.0.1, Testing Library (react 16.3.3, dom 10.4.2, jest-dom 8.0.0).
- Web: React 19.3.1, Vite 8.3.8, @vitejs/plugin-react 6.3.0.
- API and worker: Hono 4.13.21, @hono/node-server 2.1.11, zod 4.6.7, tsx 4.23.15 (dev runner).
- Types: @types/node 26.6.6, @types/react 19.3.0, @types/react-dom 19.3.0.
- Docker images: postgres:19.0-alpine, rustfs/rustfs:1.0.6, amazon/aws-cli:2.42.3 (bucket init), axllent/mailpit:v1.34.0. All are multi-arch with arm64.
- CI actions: actions/checkout@v7, pnpm/action-setup@v6, actions/setup-node@v7.
- pnpm's default `minimumReleaseAge` (24 h) stays on. hono, @types/node and @types/react were pinned to the newest release older than that window instead of being excluded. `allowBuilds: { esbuild: true }` in pnpm-workspace.yaml (for tsx).
Consequences: Libraries the roadmap names for later phases (TanStack, Tailwind, Radix, Drizzle, Better Auth, pg-boss…) get pinned in the phase that adds them, in the same way.

## D-018 — Dev object storage: RustFS instead of MinIO  (2026-11-25 · Accepted · Supersedes D-012 for dev object storage only)
Context: MinIO no longer publishes official images (`minio/minio` is gone from Docker Hub and Quay), and the Bitnami image is gone too.
Decision: Dev S3 is **RustFS** (`rustfs/rustfs`, Apache-2.0, S3-compatible, with a web console), set through `S3_*` env vars. A one-shot `rustfs-init` service (aws-cli, compose profile `init`) creates the bucket. Prod is unchanged (OCI Object Storage), and `minio` in D-010's optional prod service list now means "any S3-compatible server".
Alternatives: the pgsty/minio community rebuild (third-party, may go stale), and Garage (needs a layout/key setup, no console).
Consequences: App code must stay S3-generic (AWS SDK v3 with a custom endpoint and path-style addressing) and never use MinIO-specific APIs.

## D-019 — Local dev ports and env  (2026-11-25 · Accepted)
Decision: One `.env` at the repo root, read by every app (Vite via `loadEnv(envDir)`, Node apps via `--env-file-if-exists`) and by compose (`--project-directory .`). Default host ports are offset so Flolist can run next to other local stacks: web 5174, api 3000, Postgres 5433, S3 9010 (console 9011), SMTP 1026, Mailpit UI 8026. In dev, Vite proxies `/api` and `/ws` to the API, so the browser stays same-origin as it will be behind Caddy in prod.

## D-020 — Workspace conventions (M0.1)  (2026-11-25 · Accepted)
Decision:
- Internal packages (`@flolist/*`) are consumed as TypeScript source through `exports` (with no build step), and imports use explicit `.ts` extensions (`allowImportingTsExtensions`, `verbatimModuleSyntax`). Production bundling is settled in M0.4.
- One shared `tsconfig.base.json` is strict, with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`, and one root `eslint.config.js`.
- Each package has its own `lint`/`typecheck`/`test` scripts, run by Turborepo.
- `pnpm check` = `prettier --check .` + `turbo run lint typecheck test`. CI runs it on PRs and on pushes to main.
- Playwright e2e is added to CI with the first critical flow (M1.1).

## D-021 — API error codes and HTTP statuses (M0.2)  (2026-11-25 · Accepted; `UNAVAILABLE` 503 added by D-037)
Context: architecture.md listed six error codes but no 500 or 429 shape, and no status per code.
Decision: Two codes are added: `RATE_LIMITED` (429) and `INTERNAL` (500). Statuses live in `errorStatus` in `packages/shared/errors.ts`: UNAUTHENTICATED 401, FORBIDDEN 403, NOT_FOUND 404, VALIDATION 400, CONFLICT 409, LIMIT 403 `[assumption]`. Every error body may carry `requestId` (the `X-Request-Id` header). VALIDATION `details` is a list of `{ source, path, message }`. Unexpected errors return INTERNAL with a generic message; the real message and stack are included only in development. A body that isn't valid JSON is VALIDATION.
Consequences: Handlers throw `ApiException` (or `unauthenticated()`, `forbidden()`, `notFound()`); one `onError` formats everything.

## D-022 — Better Auth tables are hand-written in Drizzle, with UUIDv7 ids (M0.2)  (2026-11-25 · Accepted)
Context: Better Auth owns its tables but is wired in M1.1, while M0.2 already needs users, teams and memberships.
Decision: M0.2 defines only `user`, `organization` and `member`, matching better-auth 1.7.28's own field lists (read from the package source; the docs pages don't render them). TS keys are Better Auth's camelCase field names so the Drizzle adapter maps them as-is; DB columns are snake_case. `session`, `account`, `verification` and `invitation` come in M1.1. All ids are `uuid` with default `uuidv7()` (native in Postgres 18+), so M1.1 must set `advanced.database.generateId: false`. Member roles are limited to `owner | member` by a CHECK. Flolist profile columns on `user` default to timezone `UTC`, locale `en`, week_start `system`, theme `system`, sounds and auto-capitalize on `[assumption]`.
Consequences: M1.1 checks the schema against `npx auth@latest generate` and adds any missing column in a migration. The organization plugin's invitation rule applies: with `generateId: false`, accepting an invite needs a verified email unless `requireEmailVerificationOnInvitation: false`.

## D-023 — API plumbing: logging, rate limiting, user resolution (M0.2)  (2026-11-25 · Accepted)
Decision:
- `createApp(deps)` takes `db`, `resolveUser(req)`, `logger`, `rateLimit` and `clientKey`, so tests build the app without globals.
- Logs: **pino 10.4.0**, JSON to stdout, pretty-printed in dev by **pino-pretty 13.2.0**; one line per request with `reqId`, status, ms and user id; `authorization`, `cookie` and `set-cookie` are redacted.
- Rate limit: an in-memory fixed window on `/api/*`, keyed by user id or else client IP (`X-Forwarded-For` only when `TRUST_PROXY=true`). Env `RATE_LIMIT_MAX=300`, `RATE_LIMIT_WINDOW_MS=60000`. IETF `RateLimit-*` headers, `Retry-After` on 429. Stricter per-route limits (auth, invitations, uploads) are added with those routes.
- Until M1.1, `resolveUser` returns null (every `/api/v1/*` route answers 401).
Alternatives: hono-rate-limiter (an extra dependency for 40 lines), Hono's built-in logger (no JSON or levels).
Consequences: A multi-node deployment would need a shared store (Backlog).

## D-024 — Permissions matrix, fixtures and `authorize()` (M0.2)  (2026-11-25 · Accepted)
Decision: `packages/shared/permissions` exports a pure matrix (`can`, `canSee`, `decide`) and `permissionFixtures`: data cases `{ name, setup, action, resource, expected: allow | forbidden | not_found }`. `setup` describes the world from the actor's view (workspace kind, deleted?, actor role or `none`); test harnesses turn it into rows. The API's `authorize(db, user, action, resource)` loads the caller's relationship from the database (soft-deleted rows count as missing) and answers UNAUTHENTICATED, NOT_FOUND (can't see it, so ids don't leak) or FORBIDDEN (can see it, action not allowed). Collection routes scope their query to the caller instead of calling `authorize()` per row. Workspace rules for now: personal = owner can view and rename, not delete; team members can view only, the team owner can do everything `[assumption]` (collaboration.md §2 refines this in M7.1).
Consequences: A shared test requires every kind × role × action to have a fixture. API tests run every fixture through `authorize()` against a real database, and through the HTTP route where one exists.

## D-025 — Database tooling and the integration test harness (M0.2)  (2026-11-25 · Accepted)
Decision:
- Pinned: **drizzle-orm 0.45.4**, **drizzle-kit 0.31.11**, **pg 8.23.1** (+ @types/pg 8.23.1; the same driver pg-boss uses), **@testcontainers/postgresql 12.2.2**.
- Migrations are SQL files generated by drizzle-kit into `packages/db/migrations` and applied with Drizzle's migrator (`pnpm db:migrate`). Column names are written explicitly (no `casing` option).
- API integration tests: a Vitest `globalSetup` starts one `postgres:19.0-alpine` container per run and migrates a template database; each test file clones it (`createTestDb()`), so files are isolated and run in parallel. `TEST_DATABASE_URL` (an admin URL) uses an existing server instead. CI relies on Docker in `ubuntu-latest`.
- testcontainers' transitive install scripts (`cpu-features`, `protobufjs`, `ssh2`) are set to `false` in `allowBuilds`.
Consequences: `pnpm check` needs Docker running locally.

## D-026 — UI libraries and pinned versions (M0.3)  (2026-11-25 · Accepted)
Context: M0.3 adds the UI stack named in D-011 and the client libraries from architecture.md, pinned the same way as D-017 (latest stable, older than pnpm's 24 h window).
Decision: Exact versions:
- Styling: **tailwindcss 4.3.5** + **@tailwindcss/vite 4.3.5**, **clsx 2.1.1**.
- Primitives and icons: **radix-ui 1.8.1** (the unified package, imported as `import { Popover } from "radix-ui"`), **lucide-react 1.79.0** (1.80.0 was inside the 24 h window).
- Motion: **motion 14.14.0** (`motion/react`).
- Fonts: **@fontsource-variable/inter 5.3.0**, **@fontsource-variable/plus-jakarta-sans 5.3.0** (the `wght.css` axis files).
- Client state: **@tanstack/react-router 1.170.46**, **@tanstack/react-query 5.108.4**, **zustand 5.1.0**.
- Tests: **@testing-library/user-event 14.6.13**.
Consequences: `packages/ui` declares React as a peer dependency, so components there use the app's React.

## D-027 — UI system conventions (M0.3)  (2026-11-25 · Accepted)
Decision:
- **Tokens:** `packages/ui/src/themes.css` defines every token per `[data-theme]`; `tailwind.css` maps them into Tailwind with `@theme inline` and resets the default palette (`--color-*: initial`), so a component can only use token colours. A test requires Dark to define exactly Light's tokens and every colour token to be mapped. Light follows ui-design §3; Dark is derived from it `[assumption]` until Superlist's dark palette is measured (Backlog).
- **Motion:** durations, curves and springs live in `motion.ts`; CSS uses matching `--motion-*` variables (zeroed under `prefers-reduced-motion`), and a test keeps the two in sync. Motion runs under `<MotionConfig reducedMotion="user">`.
- **Theme:** the preference is cached in localStorage under `flolist.theme` (try/catch) and applied before first paint by an inline script that a small Vite plugin injects from `themeBootScript`. "System preference" follows `prefers-color-scheme` live. It moves onto the user record in M1.1.
- **Components** live in `packages/ui/src/components` and are consumed as source (D-020); apps add `@source` for that folder. Mount `<UiProvider>` once (tooltips, toasts, motion config). Toasts use an imperative `toast(message, { action })`.
- **Routing:** TanStack Router with code-based routes (no file-based codegen) `[assumption]`. Each route declares its right panel in `staticData.panel` (`cover` + image id, or none); an open task is detected from the `taskId` param. Unknown settings tabs redirect to Profile.
- **Breakpoints:** phone < 768px, tablet 768–1023px, desktop ≥ 1024px (Tailwind `md`/`lg`). The cover panel is `clamp(300px, 30vw, 440px)` wide. On phones, the Quick create FAB sits bottom-centre and Updates bottom-right `[assumption]`. Shortcut badges show only on fine pointers.
- **Week view** starts on Monday until the first-day-of-week setting exists `[assumption]`.
Consequences: New themes (M6) are token blocks only. Components never take colour props.

## D-028 — Built-in cover images (M0.3)  (2026-11-25 · Accepted)
Decision: Eight Unsplash photos (Unsplash License, free tier only, no Unsplash+) ship in `apps/web/public/covers/` as 1600px WebP (124–872 KB), with credits in `docs/credits.md`. Defaults: Inbox = misty-mountains, Today = pastel-ocean, Updates = misty-marsh; the rest are for list covers later. Ids live in `apps/web/src/shell/covers.ts`.
Consequences: Any new built-in cover needs a credits row. Server-side resizing of uploads is still the list-covers phase's job.

## D-029 — Production host, domain and front proxy (M0.4)  (2026-11-25 · Accepted · Supersedes D-010 for TLS and the front proxy only)
Context: Q-1 and Q-3. The owner's existing Ampere VM (2 OCPU, 11 GB) already runs n8n and app.leadfest.in behind the n8n stack's Caddy, which owns 80/443.
Decision:
- Production is **https://flolist.levitatinglabs.com** on that shared VM. If the owner buys flolist.com, `app.flolist.com` replaces it: a DNS record, a front-proxy site block and `APP_URL`.
- DNS: a plain A record, DNS-only. No Cloudflare Tunnel.
- The **n8n stack's Caddy is the single front proxy** and terminates TLS. Flolist's own Caddy (it serves the SPA and routes `/api` and `/ws`) has no public port. It joins the external `n8n-docker_default` network as `flolist-web`, the same way leadfest is wired. Its loopback port 127.0.0.1:8088 is only for the deploy health check.
- A `deploy` user (CI key only, `restrict`ed, in the `docker` group) owns `/opt/flolist`. The `ubuntu` user does the one-time setup.
Alternatives: Flolist's Caddy taking over 80/443 (it would have to absorb the other sites' config); a Cloudflare Tunnel (not needed since the ports are already open).
Consequences: Front-proxy edits touch n8n and leadfest, so they are rare, made in place (single-file bind mount) and reloaded gracefully. The docker group makes `deploy` root-equivalent on the host, which is accepted for a CI-only key. The real setup is in deploy-oracle.md → Current production setup.

## D-030 — Production build and image (M0.4)  (2026-11-25 · Accepted)
Context: D-020 left production bundling to M0.4. Internal packages are TypeScript source, and Node refuses to strip types inside `node_modules`.
Decision:
- `scripts/bundle-node.mjs` (**esbuild 0.28.2**, a root dev dependency) bundles the api (`api.js`, `migrate.js`) and the worker (`worker.js`) into self-contained ESM files, npm dependencies included, with a `createRequire` banner. `pg-native` and `pino-pretty` stay external.
- **One image** `ghcr.io/mak31x/flolist-api:<sha>` (plus `latest`) on **node:26.13.1-slim** runs all three with different commands. It has no `node_modules`; migrations are copied to `/app/migrations`, where the bundled `@flolist/db` looks for them. It is built natively on GitHub's `ubuntu-24.04-arm` runner (free for public repos), with no QEMU.
- Pinned prod images: **caddy:2.11.9-alpine** and postgres:19.0-alpine (the same as dev). The GHCR package is public, so the VM pulls without a token.
- New CI actions: docker/setup-buildx-action@v4, docker/login-action@v4, docker/build-push-action@v7, actions/upload-artifact@v7, actions/download-artifact@v8.
Alternatives: `pnpm deploy --prod` + tsx at runtime (a larger image, and the TS compiler in prod); a separate worker image (it would duplicate an identical build).

## D-031 — Deploy pipeline and backups (M0.4)  (2026-11-25 · Accepted)
Decision:
- `check.yml` runs on PRs and is a reusable workflow. `deploy.yml` (push to main, or manual) runs check → image + web bundle → deploy in the GitHub environment `production`. The secrets are `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` and `DEPLOY_KNOWN_HOSTS` (a pinned host key), plus the variable `APP_URL`. Deploys never overlap or get cancelled.
- The deploy job rsyncs the web build to `web-releases/<sha>`, plus the compose file, Caddyfile and scripts, then runs `scripts/deploy.sh <sha>` on the VM. That script pulls, runs `migrate`, switches the `current` symlink atomically, runs `up -d --wait` and `caddy reload`, and checks `/api/health` and `/` through Caddy. On failure it restores the previous image tag and web release. The job ends with a public health check. Five web releases are kept.
- **Migrations are forward-only**: each one must work with the previous release (expand/contract). They are never rolled back automatically.
- Backups: `pg_dump -Fc -Z 6` (no extra gzip) nightly at 02:30 UTC to `/opt/flolist/backups`, 14 daily + 8 weekly (hard links). `restore-test.sh` runs monthly against a throwaway database. They stay on the VM until M8.3 moves them offsite.
Consequences: A broken migration needs a manual fix-forward. The VM's disk holds the only backup copy until M8.3 (Backlog risk).

## D-032 — Production email: Hostinger SMTP  (2026-11-25 · Accepted)
Context: Q-2. The owner already has Hostinger mail (startrips.in, and levitatinglabs.com).
Decision: Production mail goes through **Hostinger SMTP**: `smtp.hostinger.com:465` with implicit TLS (Nodemailer `secure: true`), authenticated as an existing Hostinger mailbox on **startrips.in**, used temporarily as both login and `MAIL_FROM` (the address lives only in `/opt/flolist/.env`, not in this public repo) `[assumption: temporary]`. A dedicated Flolist sender (e.g. on levitatinglabs.com or flolist.com) replaces it later. The provider stays env-only (`SMTP_HOST/PORT/USER/PASS`, `MAIL_FROM`), per D-012, so a switch is a config change. Dev keeps Mailpit.
Alternatives: transactional APIs (Resend, Brevo, SES): better deliverability and analytics, but a new account and DNS setup for little volume today.
Consequences: Hostinger mailboxes have daily sending caps, which is fine for single-user/small-team volume; revisit (Backlog) before company-wide use or digest emails at scale. startrips.in already has Hostinger MX, SPF (`include:_spf.mail.hostinger.com`), DKIM (hostingermail-a/b/c) and DMARC `p=none` (checked 2026-11-25); the future sender domain needs the same records, copied over if its DNS moves to Cloudflare. The owner puts the mailbox password into `/opt/flolist/.env` on the VM themselves. Port 465 is not blocked by OCI (only 25 is).

## D-033 — Auth and email libraries, pinned versions (M1.1)  (2026-11-25 · Accepted)
Decision: Exact versions, same rules as D-017 (latest stable, older than pnpm's 24 h window):
- **better-auth 1.7.28** (with `@better-auth/core` and `@better-auth/drizzle-adapter` 1.7.28). It was 23 h old at the start of M1.1, so the install waited for the window instead of pinning 1.7.27.
- **nodemailer 10.6.1** + **@types/nodemailer 8.0.2**; **@playwright/test 1.65.1** (root dev dependency).
- **kysely 0.29.9** in `packages/db`. better-auth pulls kysely in, and kysely is an optional peer of drizzle-orm, so without it pnpm made a second drizzle-orm instance for `apps/api` whose types don't match `packages/db`'s. Every importer of drizzle-orm must have the same peer set.
Consequences: Upgrading better-auth means bumping all `@better-auth/*` packages together and keeping kysely within its peer range.

## D-034 — Better Auth wiring (M1.1)  (2026-11-25 · Accepted)
Decision:
- Auth lives at `/api/auth/*` with `baseURL = APP_URL` (same origin as the SPA, D-019/D-029). `BETTER_AUTH_SECRET` is required in production; the API refuses to start with the dev default.
- Email/password requires verification: sign-up and unverified sign-in both send the link, and the link signs the user in and redirects to `callbackURL` (Inbox). Password reset revokes the account's other sessions. Emails go out in the background (failures logged) so response times don't reveal whether an account exists.
- Google sign-in is on only when `GOOGLE_CLIENT_ID`/`SECRET` are set; prod keys wait for the owner (Backlog).
- Plugins: `bearer()` (token returned in `set-auth-token`) and `organization()` with roles owner/member only and **no user-created organizations until Teams (M7.1)** `[assumption]`, because a team needs its `workspaces` row.
- Rate limiting: Better Auth's own limiter is off. The API's limiter applies a stricter per-IP limit (`AUTH_RATE_LIMIT_MAX=10` per `AUTH_RATE_LIMIT_WINDOW_MS=60000`) to sign-in, sign-up, password reset, reset requests, verification emails and password changes `[assumption]`. The API overwrites `x-flolist-client-ip` with its proxy-aware client IP and Better Auth reads only that header.
- CSRF: Better Auth guards `/api/auth`; an Origin check on `/api/v1` rejects cookie-authenticated mutations whose `Origin` isn't APP_URL's. Bearer requests skip it.
- The personal workspace and `user_settings` row are created in `user.create.after`. Better Auth runs that hook only after its transaction commits, so it can't be atomic with the user insert; the helper is idempotent and `GET /api/v1/me` re-runs it to repair a missed one.
- The theme preference moves onto the user record via `GET`/`PATCH /api/v1/me`; the server accepts only `themePreferenceSchema` (packages/shared), which a test keeps equal to the UI's theme list.
Consequences: A multi-node deployment would need shared rate-limit storage (Backlog, D-023). Native shells use the bearer token from M10/M11.

## D-035 — Playwright e2e setup (M1.1)  (2026-11-25 · Accepted)
Decision:
- The suite lives in its own workspace package `apps/e2e` (**@playwright/test 1.65.1**, moved there from the root), so it gets lint and typecheck but stays out of `turbo test`. `pnpm test:e2e` = migrate the dev database, then `playwright test`.
- Playwright starts the real API (tsx) and web (Vite) dev servers and reuses running ones locally. They talk to the dev Postgres and Mailpit on the D-019 ports; tests read emails through Mailpit's HTTP API. Each run signs up throwaway `e2e-*@flolist.localhost` accounts, so no cleanup or seed is needed.
- CI: a second job `e2e` in `check.yml` with Postgres and Mailpit service containers (same images as dev) and Chromium only `[assumption]` until the native shells make WebKit matter. Deploys wait for it too, since `deploy.yml` calls `check.yml`. The HTML report is uploaded on failure.
Consequences: CI pays for one Chromium install per run (~1 min). Local runs need `pnpm infra:up` first.

## D-036 — Web auth flow and screens (M1.1)  (2026-11-25 · Accepted)
Decision:
- **Routes:** `/login`, `/signup`, `/verify-email`, `/forgot-password`, `/reset-password` sit outside the shell; every app view is a child of the pathless `_app` layout, whose `beforeLoad` requires a session. Signed-out visitors go to `/login?redirect=<path>`; only same-app paths are accepted (`safeRedirect`), never `//…`, absolute URLs, `/api/*` or the auth screens. A failed verification link (Better Auth appends `?error=` to its callback) goes to `/verify-email`. Signed-in users skip `/login` and `/signup`. After verification users land in Inbox; `/` still redirects to Today.
- **Session source:** `meQuery` (`GET /api/v1/me`, `null` on 401) in TanStack Query, not Better Auth's session store. The router reads it with `queryClient.query({ …, staleTime: "static" })`. The shell redirects to log in only when `me` is `null` (not while it refetches or fails) and never from `/login`, which prevents a redirect loop. Sign-out sets `me` to `null` and drops other cached queries.
- **Client:** `better-auth/client` (vanilla, not `better-auth/react`) at `/api/auth` on the same origin, with `customFetchImpl` resolving `fetch` per call. Native shells switch to bearer tokens via `platform/` in M10/M11.
- **Google button:** shown only when public `GET /api/config` reports `googleSignIn: true`; the "G" is drawn in `currentColor` (no hard-coded colours, D-027) `[assumption]` instead of Google's coloured logo.
- **Theme:** the user record wins; localStorage stays as the pre-paint cache. Changing it is optimistic with rollback and a toast.
- **Copy:** "Log in to Flolist", "Create your account", "Sign out" (Superlist's exact wording unchecked) `[assumption]`. Error messages are mapped from Better Auth codes in `authErrorMessage`.
- **Base components:** `Button` (primary/secondary/outline, 40px, `loading`) and `TextField` (label, hint/error via `aria-describedby`) in packages/ui.
- **Getting started list:** not seeded in M1.1 because lists, blocks and tasks don't exist yet; moved to M3.1 with a backfill for earlier accounts (owner's call).
Consequences: Other `/api/v1` 401s don't sign the user out yet (Backlog). The Google button can't be checked end to end until an OAuth client exists.

## D-037 — Files service and object storage (M1.2)  (2026-11-26 · Accepted)
Context: D-012 asked for presigned upload/download URLs. OCI Object Storage's S3 Compatibility API doesn't list `PutBucketCors` (checked 2026-11-26), so browsers can't PUT to presigned OCI URLs from the app's origin.
Decision:
- Pinned: **@aws-sdk/client-s3 3.1176.0**, **@aws-sdk/s3-request-presigner 3.1176.0** (3.1177.0 was inside pnpm's 24 h window), **testcontainers 12.2.2** (API dev dependency, for RustFS in tests). The client is S3-generic: path-style, `requestChecksumCalculation`/`responseChecksumValidation: "WHEN_REQUIRED"` (the default CRC32 checksums break presigned browser PUTs and some S3 servers).
- A `files` row (data-model columns + `status` pending/ready, `ready_at`; `uploaded_by` set null when the account goes) per object, key `ws/<workspaceId>/<fileId>`, never derived from the filename. `user.avatar_file_id` and `workspaces.avatar_file_id` reference it (set null on delete).
- Flow: `POST /api/v1/uploads` (client UUIDv7 id, idempotent while pending) → PUT the bytes → `POST /api/v1/uploads/:id/complete`, which HEADs the object, rejects it over `MAX_UPLOAD_MB` and checks the magic bytes against the declared image type (a mismatch deletes object and row). Only the uploader can PUT or complete.
- **Two upload modes** (`S3_DIRECT_UPLOAD`): direct = presigned PUT to the bucket (needs bucket CORS; dev RustFS gets it from `infra/scripts/rustfs-init.sh`); relay (default, prod) = the browser PUTs to `/api/v1/uploads/:id/content` and the API stores the bytes (Hono `bodyLimit`). The ticket's `upload.url` is either, so clients don't care. `S3_PUBLIC_ENDPOINT` signs URLs for a browser-reachable host when the API reaches storage on another one.
- Downloads: `GET /api/v1/files/:id` checks access and 302s to a 10-minute presigned GET (redirect cached privately for 5 min; objects are immutable per id). Access = `workspace.view` on the file's workspace, or the file is someone's (or a workspace's) avatar, which any signed-in user may see `[assumption]`. New matrix action `workspace.uploadFile` (personal owner, team owner and member).
- Uploads accept images only (JPEG/PNG/WebP/GIF; SVG never) until attachment phases widen `uploadMimes`. Limits: `MAX_UPLOAD_MB`, optional `MAX_WORKSPACE_STORAGE_GB` (counts every file row), `UPLOAD_RATE_LIMIT_MAX` per user per minute on reservations.
- No storage configured → uploads and downloads answer the new error code **`UNAVAILABLE` (503)**, added to D-021's list; the API logs a warning at start instead of refusing to boot.
- API tests start a RustFS container next to Postgres (`TEST_S3_ENDPOINT` reuses a running server); CI's e2e job runs RustFS as a service.
Alternatives: always relaying (simpler, but the API carries every byte even where CORS works); a Caddy path proxy to OCI (breaks SigV4 host/path signing); configuring CORS on OCI through its native API (undocumented for Object Storage, couldn't confirm).
Consequences: prod uploads pass through the API (fine at 25 MB per file on one VM). Presigned GETs against OCI are unverified until the first prod upload (runbook step). Stale pending rows and replaced avatars stay until a worker job cleans them (Backlog).

## D-038 — Profile fields on the user record (M1.2)  (2026-11-26 · Accepted)
Decision:
- `GET/PATCH /api/v1/me` carry `firstName`, `lastName`, `avatarUrl`, `avatarFileId`, `timezone`, `weekStart`, `locale`; `image` is gone from the DTO (`avatarUrl` = uploaded photo, else the OAuth picture). Every PATCH field is optional (field-level LWW, D-006); an empty first name is refused, an empty last name allowed.
- Accounts without first/last name (sign-up sends one `name`) get them by splitting the display name at its first space until saved. Saving either keeps Better Auth's `name` = "first last".
- A photo must be a ready image the caller uploaded into their own personal workspace. The web crops it client-side (react-easy-crop **6.2.5**) to one 512×512 image, WebP where the engine encodes it, else JPEG (WebKit) `[assumption]`.
- Time zones: any IANA name the runtime accepts. The web lists `Intl.supportedValuesOf("timeZone")` with legacy CLDR names mapped to current IANA ones (`Asia/Calcutta` → `Asia/Kolkata`, `platform/modernZone`), and offers "Use it" when the device's zone differs from the saved one; it never changes the zone silently `[assumption]`.
- First day of the week: "System default" resolves through `Intl.Locale#getWeekInfo` (Monday where the engine lacks it) and is shown with the resolved day. My Week uses it, replacing D-027's Monday default.
- `locale` is `system | en`, default now `system` (migration 0002 changes the column default).
- Copy: "Personal info", "Upload photo / Change photo / Remove", "Crop your photo", "The email you sign in with", "Time zone" (Superlist's exact strings unchecked) `[assumption]`. The email stays read-only; changing it is Backlog.

## D-039 — Client conventions added in M1.2  (2026-11-26 · Accepted)
Decision:
- `uuidv7()` in packages/shared (RFC 9562, `crypto.getRandomValues`) is the client id generator for new rows and `clientMutationId` (D-006).
- `apps/web/src/platform/` holds wrapper-safe adapters: `pickFile` (hidden `<input type=file>`, works in Tauri/Capacitor webviews), `systemTimeZone`, `timeZones`, `systemLocale`, `systemFirstDay`. Native shells may swap implementations in M10/M11.
- i18n scaffolding: `t(key, vars)` over one English catalog (`apps/web/src/i18n/en.ts`, dotted keys, `{name}` placeholders). New strings use it from M1.2; older screens move over later (Backlog). No i18n library until a second language exists.
- `useUpdateMe(errorMessage)` is the one optimistic profile mutation (cache patch → PATCH → rollback + toast); `useSaveTheme` stays for the theme store. `workspacesQuery` is the client's workspace list.
- `SettingsCard` lives in `apps/web/src/views/SettingsCard.tsx`; Avatar gains a 72px size.

## D-040 — Libraries pinned in M2.1  (2026-11-26 · Accepted)
Decision: **fractional-indexing 4.0.0** (packages/shared positions), **@hono/node-ws 1.3.2** (API WebSocket), **ws 8.23.0** + **@types/ws 8.18.2** (API dev, test client), **@dnd-kit/core 6.3.1**, **@dnd-kit/sortable 10.0.0**, **@dnd-kit/utilities 3.2.2**, **frimousse 0.4.0** (emoji picker), **emojibase-data 18.0.0** (web dev dependency, self-hosted picker data), **zod 4.6.7** in apps/web (same as shared).
Consequences: frimousse fetches its data from `/emojibase/en/{data,messages}.json`, served by a small Vite plugin in dev and emitted into the build, so there's no jsDelivr request and the picker works offline inside Tauri/Capacitor.

## D-041 — Positions are fractional-indexing keys  (2026-11-26 · Accepted)
Decision: `position` values are fractional-indexing base-62 keys (`a0`, `a0V`…), validated by `positionSchema` (alphanumeric, ≤128 chars, must parse). They compare byte-wise: SQL orders with `collate "C"`, JS with `compareKeys`. Helpers in packages/shared: `positionBetween` (tolerates equal neighbours), `positionAfter/Before`, `positionsBetween`, `positionAt(siblings, index)`, `byPosition`. Clients compute positions; the server only validates them.
Consequences: no reindexing ever (CLAUDE.md rule). Two clients inserting at the same gap can produce equal keys; ties break by id and the next move separates them.

## D-042 — Mutations, idempotency and the outbox  (2026-11-26 · Accepted)
Decision:
- Every mutating route runs inside `runMutation(c, clientMutationId, fn)`: one transaction inserts `applied_mutations(user_id, client_mutation_id)` first, runs the change, stores `{status, body}`, and commits. A retry with the same id replays the stored response (even for DELETE); a concurrent duplicate waits on the PK and then replays. A failed mutation rolls back its row, so the id can be reused.
- `emit(channels, change)` writes an `outbox` row in the same transaction (transactional outbox). After commit `afterMutation` kicks an in-process drainer that publishes pending rows in id order (`for update skip locked`, batches of 500) and marks them dispatched; a 5 s sweep catches anything a crash left. Delivery is at-least-once; clients apply by version.
- Pruning (hourly): dispatched outbox rows after 1 h, applied mutations after 24 h.
- Change events carry `clientMutationId`, so a client can tell its own echoes. List events go to `user:<creator>` + `list:<rootId>`; section and sidebar-entry events to `user:<id>` only.
- `/api/v1/*` rejects signed-out requests with 401 before body validation.
Alternatives: LISTEN/NOTIFY (only needed for multiple nodes, architecture.md); publishing straight from handlers (loses events when a commit fails or the process dies).

## D-043 — WebSocket protocol v1  (2026-11-26 · Accepted)
Decision:
- `/ws` authenticates like REST (`resolveUser`), refuses an Origin other than `APP_URL` (403), caps client messages at 4 KB and pings every 30 s (a socket that misses one pong is dropped).
- On open the server joins `user:<id>` and every `workspace:<id>` the user belongs to, then sends `{type:"ready", channels}`. Clients send `subscribe`/`unsubscribe` for `list:<id>` (checked with `authorize(list.view)`, answered `subscribed` or `error`) and `ping`. At most 500 channels per socket.
- Client (`features/sync`): one `LiveSocket` with backoff reconnect; list channels are ref-counted via `useListChannel`; on reconnect it rejoins and refetches active queries. `applyChange` patches the TanStack cache with a version guard and skips events for a query key that has a pending mutation; the mutation's `onSettled` invalidates once the last one finishes.
- Field-level LWW: PATCH applies only the fields sent; `baseVersion` is accepted but not enforced yet.

## D-044 — Lists and sidebar behaviour chosen in M2.1  (2026-11-26 · Accepted)
Decision:
- Until sharing (M7) a list is visible only to its creator and lives in the Personal workspace; the All lists "Shared" tab stays empty. List roles: `creator` only. New matrix actions `workspace.createList`, `list.view/edit/manage`, `section.view/update/delete` (the default section can't be deleted).
- Each user has one default section "Favorites", created with the personal workspace (and lazily by `GET /sidebar`). It can be renamed `[assumption]`. A new list is starred at the end of Favorites (or the section it was created from). Deleting a section unpins its lists (they stay in All lists). Max 200 sections per user `[assumption]`.
- Sidebar entries of soft-deleted lists are kept so a Trash restore brings them back; reads hide them. Deleting a list from its own page lands on All lists `[assumption]`.
- "Last opened" (All lists sort) is `list_view_prefs.last_opened_at`, set by `POST /lists/:id/open`.
- Context menus: section = Rename / New section below / Delete; entry = Open / Rename / Change emoji / Unstar / Delete. Duplicate (M2.3) and Leave (M7.2) come later. Quick create (sidebar "+" and the phone FAB) offers New list and New section; New task stays disabled until M3.
- Drag: lists reorder by mouse, touch and keyboard, within and across sections; sections by mouse/touch only `[assumption]`, keyboard reorder is Backlog.
- `activity_events` is deferred to the tasks/activity phases.


## D-045 — Blocks storage and the batch API (M2.2)  (2026-11-26 · Accepted)
Decision:
- `blocks` (migration 0004) has data-model.md's columns except `task_id`, `sublist_id` and `file_id`, which arrive with those block types (M2.3/M3.1). `position` is `text collate "C"`, so the partial index `(container_type, container_id, position) where deleted_at is null` serves the byte-wise order (D-041) directly. The type/indent CHECKs come from `blockTypes`/`blockMaxIndent` in packages/db; a type-level check in the API keeps them equal to packages/shared.
- Content is Tiptap's own inline JSON: text blocks `{ inline: [...] }` (text with bold/italic/strike/code/link marks, hard breaks; ≤ 20 000 characters), dividers `{ color }`. Links must be http(s) or mailto. Block types so far: paragraph, heading1–3, bullet, numbered, quote, divider.
- `GET /lists/:id/blocks` (`list.view`) and `POST /lists/:id/blocks/batch` (`list.edit`; ≤ 500 ops, one per block): one transaction through `runMutation`. `upsert` creates (type + position required) or changes only the sent fields (field-level LWW); an upsert of a soft-deleted block of the same list restores it (undo). `move` = position (+ indent). `delete` soft-deletes (`trash_root_id` = the block) and is a no-op when the block is already gone. Using another container's block id fails (409 upsert, 404 move/delete).
- `resolveBlockShape` (packages/shared) is the one rule for type changes, on server and client: content that still fits is kept, otherwise reset; non-list types flatten to indent 0.
- Blocks have no matrix actions: access is the list's (resolved through the root). Events go to `list:<rootId>` only.

## D-046 — Editor sync on the client (M2.2)  (2026-11-26 · Accepted)
Decision:
- One `BlockStore` per open list owns the write side: `apply()` patches the query cache at once and queues ops per block (repeat edits merge; a merged type change sends its resolved content and indent). Typing flushes after a 500 ms pause, commands at once, and pending edits flush when the list closes, the tab hides and on `pagehide` (`keepalive`). One batch in flight; transient failures (network, 5xx, 429) retry with the same `clientMutationId`; anything else drops the queue, refetches the list, clears undo and toasts.
- Block events skip D-043's "wait for the pending mutation" rule: rows from batch answers, live events and refetches are applied by version, with queued and in-flight local changes laid on top (`receive`, `mergeFetched`), so remote changes and refetches never undo unsent typing.
- A just-created list is seeded with an empty block cache, and the store waits for its pending create mutation before sending (`ready()`).
- TanStack Query delivers cache notifications in a microtask (`notifyManager.setScheduler(queueMicrotask)` in main.tsx) instead of a `setTimeout`, so a command (Enter) renders its new block and moves focus there before the next key event. Caret placement is synchronous (`view.focus()`), not Tiptap's next-frame `focus()`; focus requested for a block that hasn't mounted waits and is applied in a microtask after the commit (StrictMode replays mount effects).

## D-047 — Editor behaviour chosen in M2.2  (2026-11-26 · Accepted)
Decision (all `[assumption]` where Superlist's behaviour is unknown):
- Every text block mounts its own Tiptap editor (a one-paragraph document; Tiptap history off). architecture.md's "static HTML until focus" is deferred to M8.2 with virtualization: mounting an editor on tap loses iOS's focus-in-gesture for the keyboard.
- Text styles: H1 26/32 bold, H2 21/28 semibold, H3 17/24 semibold (display font for H1/H2). Numbered levels count 1. / a. / i.; bullets •, ◦, ▪. Indent max 4, and at most one deeper than the list item above. Dividers come in six colours (theme tokens `--divider-gray|red|orange|green|blue|purple`).
- Enter: lists and quotes continue, everything else continues as a paragraph at the end of a block (a mid-block split keeps the type); an empty list item or quote becomes a paragraph; at the very start of a non-empty block it opens an empty block above. Backspace at the start: non-paragraph → paragraph, paragraph → merge into the previous text block, right after a divider → delete the divider. Delete at the end merges the next block in. Shift+Enter is a hard break.
- A remote change to the block being edited shows once it loses focus. Links: ⌘L opens a small prompt (selection → link it; caret → insert the URL as a link; empty → remove), Mod+click opens a link via the `openExternal` platform adapter.
- Enter or ↓ in the list title moves into the first block; ↑ from the first block goes back to the title. The empty-list placeholder is an unsaved paragraph that's created on first input.
- Markdown shortcuts (`#`/`##`/`###`, `-`/`*`, `1.`/`1)`, `>` + space) apply to paragraphs only; `---` becomes a divider on the third dash and moves the caret to a new paragraph. Mark input rules (`**`, `*`, `~~`, `` ` ``) come from Tiptap.
- Slash menu: only the built types, in spec order (Task, Sublist, Image, Attachment join in M2.3/M3.1), filtered by label or alias. Divider on an empty block turns it into the divider (+ a paragraph below); on a block with text it inserts the divider below.
- Block handle (desktop/tablet only; phones use "/" and the keyboard): ⋮⋮ drags by mouse, touch or keyboard (dnd-kit), within the list only (sidebar, sublists and Week drops come with M2.3/M3/M4); the block-type button opens a flat menu: Turn into, Colour (dividers), Duplicate, Delete.

## D-048 — Block selection, clipboard and undo (M2.2)  (2026-11-26 · Accepted)
Decision:
- Block selection starts with Esc (that block), Mod+A on already-selected or empty text (all blocks), or Shift+↑/↓ at a block's first/last line. The editor container then has focus: Shift+↑/↓ extend, ↑/↓ move, Enter/Esc return to text, Backspace/Delete delete, Tab/Shift+Tab indent list items, Mod+A selects all. A live region announces the count.
- Copy/cut write Markdown (`text/plain`), HTML and the internal JSON (`application/x-flolist-blocks`, also embedded in the HTML as `data-flolist-blocks` because some webviews drop custom types). Paste reads JSON, else HTML (headings, nested lists, quotes, rules, code, marks, safe links; Google Docs' fake bold ignored), else the text as Markdown; checklist markers become bullets until tasks exist. One pasted block goes to Tiptap inline; several split the current block: the first joins the text before the caret (or an empty block takes its type), the text after the caret ends up after the paste. Pasting into a block selection inserts below it and selects the pasted blocks.
- Undo/redo (Mod+Z, Mod+Shift+Z, Ctrl+Y off Apple, and `historyUndo/Redo` input events) is one stack per open list: every command records the inverse ops `BlockStore.apply` returns; typing in one block groups into one step until a 1 s pause or another command; 200 steps; cleared on rollback. Undo/redo are ordinary batches to the server.

## D-049 — Libraries pinned in M2.2  (2026-11-26 · Accepted)
Decision: Tiptap **3.35.0** in apps/web: `@tiptap/core`, `@tiptap/react`, `@tiptap/pm`, `@tiptap/extensions` and the extensions `document`, `paragraph`, `text`, `hard-break`, `bold`, `italic`, `strike`, `code`, `link` (no StarterKit). `apps/e2e` gets the DOM lib for `page.evaluate` callbacks.

## D-050 — Media blocks and attachment files (M2.3)  (2026-11-26 · Accepted · widens D-037's upload types)
Decision:
- Block types `image` and `attachment` (migration 0005: `blocks.file_id`, FK set null, indexed; a CHECK allows `file_id` only on them). Content is `{ file: {name, mime, sizeBytes, width, height} | null, caption }` (strict objects, caption ≤ 2000); the server always fills `file` from the `files` row, never from the client. A block needs a **ready** file in the root list's workspace; `image` needs an inline type (JPEG/PNG/WebP/GIF), anything else is an attachment `[assumption]`.
- Media blocks are created only after the upload completes; meanwhile the editor shows a local progress row (XHR upload progress in `uploadFile`). Slash on an empty paragraph replaces it; paste and drop add blocks below.
- `uploadMimes` → any `type/subtype` (`uploadMimeSchema`); images are still checked by magic bytes. Downloads of non-images are signed with `Content-Type: application/octet-stream` and `Content-Disposition: attachment`, so uploaded HTML/SVG never renders from the bucket. New platform adapter `downloadFile`.
- Reference types (`image`, `attachment`, `sublist`) never change type (`resolveBlockShape` refuses), and Turn into hides them. Dividers, media and sublists are "atomic": focused as a whole via `[data-atomic]`; Backspace after one selects it (dividers are still deleted at once).
Alternatives: creating the block at once with a pending file (other clients would see broken images).

## D-051 — Sublists (M2.3)  (2026-11-26 · Accepted)
Decision:
- `blocks.sublist_id` (unique, FK cascade) and `lists.parent_block_id` (FK set null). An upsert creating a `sublist` block carries `sublist: {id, title}`; the server inserts the list (same workspace and root, `parent_list_id` = the list), then the block, then links `parent_block_id`. Resending the same `sublist` on an existing block is allowed (restores).
- Deleting a sublist block soft-deletes the child tree with `trash_root_id` = the block; restoring the block (undo) restores it. Deleting a sublist from its own page also soft-deletes its parent block (trash root = the list) and lands on the parent `[assumption]`. `subtreeIds` (recursive CTE on `parent_list_id`) is the one tree walk.
- `GET /lists` returns sublists too (breadcrumbs, starring); All lists filters roots. Sublist pages subscribe to `list:<rootId>`. Breadcrumb: up to 3 levels, else root › … › last two.
- The row's title edits in place (rename waits for the parent store's flush; optimistic version 0 → `baseVersion` ≥ 1); its arrow or Mod+Enter opens it. No block Duplicate for sublists; a copied sublist pastes as its title `[assumption]`. Open-task count arrives with tasks.

## D-052 — List covers and Customize (M2.3)  (2026-11-26 · Accepted · settles D-028's resizing)
Decision:
- `PATCH /lists/:id` takes `cover`: `{builtin}` (any of the 8 `BUILTIN_COVERS`, now in packages/shared), `{fileId}` (a ready inline image in the list's workspace) or `null`; the DTO exposes `cover` (+ `parentBlockId`).
- Customize (gear on the cover, and in the ⋮ menu so a list without a cover can get one `[assumption]`): emoji via the existing picker, six built-ins (the ones Inbox/Today don't use), upload, remove. Uploaded covers are scaled **in the browser** to a 2400px longer edge (WebP, JPEG on WebKit; `files/resize.ts`); no server image library (owner's call). Image blocks keep their originals.
- List routes declare `panel: {kind: "list"}`; the shell resolves it to a `PanelCover` from the list cache. No cover → no panel.

## D-053 — Duplicate list and the ⋮ menu (M2.3)  (2026-11-26 · Accepted)
Decision:
- `POST /lists/:id/duplicate` (`list.view` + `workspace.createList`; client id for the copy): copies the list and its live sublist tree with new ids, blocks with their positions/content, sublist links remapped; files are referenced, not copied `[assumption]`. Title "<title> (copy)"; starred right after the original in the same section when the original is starred. A duplicated sublist becomes a root list `[assumption]`. Also in the sidebar entry context menu.
- ⋮ menu: Customize · Print list · Duplicate list · Go to <team> (team workspaces only) · Delete. Print = `printPage` adapter (`window.print()`) with Tailwind `print:` variants hiding the chrome. **Mark all incomplete moves to M3.1** (owner's call: nothing to reset before tasks).

## D-054 — Moving blocks to another list (M2.3)  (2026-11-26 · Accepted)
Decision: `POST /lists/:id/blocks/move-to {ids, targetListId}` (`list.edit` on both, same workspace, not into the moved sublist's own tree): blocks keep their order at the end of the target (indent 0); moved sublists take their trees along (`root_list_id` of lists and their blocks updated). Events: block deletes on the source root channel first, then upserts on the target's. Client: drag a block onto a sublist row (middle half of the row's resting rect; rows hold still while hovering) or a sidebar list (pointer hit-test); the source cache drops the rows at once, the move isn't undoable and clears the undo stack `[assumption]`.

## D-055 — Per-user list view settings (M2.3)  (2026-11-26 · Accepted)
Decision: `GET/PATCH /lists/:id/prefs` (`list.view`; `runMutation`) on `list_view_prefs`; a `listPrefs` change event on `user:<id>` with `version` = `updated_at` in ms. The funnel menu offers Show tasks only, Hide completed tasks and the sorts that work so far (`AVAILABLE_LIST_SORTS`: Manual, Alphabetical); M3 adds the task-field sorts. `viewBlocks` renders the view without touching positions; Alphabetical sorts blocks by text until tasks exist, textless last `[assumption]`; a sorted view turns drag off and shows "Sorted by X · Reset"; ↑/↓ still follow stored order (Backlog). No new libraries in M2.3.

## D-056 — Tasks storage, task blocks and the page batch (M3.1)  (2026-11-26 · Accepted)
Decision:
- Migration 0006: `tasks` (data-model columns needed now: workspace, `root_list_id`/`list_id` nullable for M4's Inbox-only tasks, `parent_task_id`, `title` + `title_inline` jsonb, completion, soft delete; dates/priority/assignee/source come with their phases), `activity_events`, `blocks.task_id` (unique, FK cascade; CHECK `(task_id is not null) = (type = 'task')`).
- `task` is a text block type: its block content is the task's title (Tiptap inline, ≤ 2000 chars), mirrored into `tasks.title_inline` and plain `title` in the same transaction. Text ↔ task Turn into is allowed (content kept). The block DTO carries `taskId` and `task: {completedAt, completedBy}`; any task change bumps the block's version.
- Subtasks are task blocks in a task's body (`container_type='task'`, `tasks.parent_task_id`, same home `list_id`), nested at most 4 levels (`MAX_SUBTASK_DEPTH`) `[assumption]`. A list *page* = the list's blocks + the bodies of tasks whose home is that list: `GET /lists/:id/blocks` returns all of them and the one batch route edits them (upsert `task: {id?, completed?}`, `container` on create, upsert and move; no cycles, no sublists inside tasks). No `/tasks/:id/blocks` routes.
- Deleting a task block soft-deletes the task subtree and its body blocks with trash root = the block (restore by upserting the block); turning a task into text trashes the task the same way and turning it back with the same `task.id` restores it. `move-to` and Duplicate list carry tasks and bodies along (a duplicate keeps completion `[assumption]`).
- Access: tasks have no matrix actions yet; `/tasks/:id` resolves through the home list (`list.view` / `list.edit`), missing or foreign = 404. `task` change events go to `list:<rootId>`. Tasks of a deleted list aren't trashed themselves (they're unreachable through the list; Backlog).
Alternatives: title only on `tasks` with the block as a bare pointer (two write paths for the editor); per-task body routes and stores (two undo stacks and sync paths for one page).

## D-057 — Task routes and the activity log (M3.1)  (2026-11-26 · Accepted)
Decision: `GET /tasks/:id`, `PATCH /tasks/:id` (`titleInline`, `completed`; keeps the block content in step, emits block + task events) and `GET /tasks/:id/activity` (oldest first, actor name/avatar). Activity rows are written in the mutation's transaction for created, title_changed, completed, reopened and restored (an undo of a delete counts as restored). A title change by the same actor within 10 minutes of their last title change or the creation updates that entry instead of adding one `[assumption]`. Other actions are logged with their fields (M3.2+).

## D-058 — Client: visible tree, shared store, task fields (M3.1)  (2026-11-26 · Accepted)
Decision:
- Editors render `visibleTree(blocks, root, collapsed)` (`editor/tree.ts`): the root container's blocks, each task followed by its subtasks (only task blocks of a body; text/media in a body show in the details panel `[assumption]`). New blocks take positions among same-container siblings (`placeNear`), never from visible neighbours; media and sublists anchored on a subtask go after its top-level task.
- `BlockFields` gains `taskId` (made by the store when a block becomes a task; undo hands it back), `completed` and `container`; the store sends them as `task`/`container`. One store per list page, ref-counted and shared by the list and the details panel (`use-block-store.ts`); each editor keeps its own undo stack.
- Live upserts of body blocks find their page by the cached block of the parent task (`pageOf`).
- Task rows reuse the text-row layout (checkbox as the marker, progress ring + open arrow trailing), so Turn into keeps the title editor mounted and the caret in place. Collapsed subtasks are component state (Backlog: persist).
- Completion sound: `platform.playCompleteSound()` synthesises two soft notes with Web Audio (no audio file) `[assumption: Superlist's sound not copied]`, played only when `me.soundsEnabled` (now on the `/me` DTO, read-only until M6.2). `ProgressRing` joins packages/ui.

## D-059 — Task editing keys (M3.1)  (2026-11-26 · Accepted)
Decision (`[assumption]` where Superlist is unchecked): `[]`/`[ ]` + space and slash → Task (first in the slash menu) make a task; Enter continues tasks, Enter on an empty top-level task makes it a paragraph. Tab makes a task the last subtask of the task directly above it (same container); Shift+Tab moves a subtask out to just below its parent, later siblings stay. Enter or Backspace at the start of an empty/nested subtask moves it out instead of turning it into text (as text it would vanish from the list). Mod+D completes/reopens (pulled from M3.3 so the checkbox is keyboard-reachable); Mod+Enter or the row's arrow opens details. Arrow keys skip rows hidden by the view's filters.

## D-060 — Task details panel (M3.1)  (2026-11-26 · Accepted)
Decision: `/lists/:listId/tasks/:taskId` (task id, home list) shows in the right panel (a sheet below 1024px): close + ⋮ (only Delete, with an Undo toast, until M3.3), "↳ parent" link for subtasks, large checkbox, title (one line; Enter → body, Esc → close), the list chip (navigates; moving is M3.3), the body (the list's BlockEditor rooted at `{type: "task", id}`), and the activity log with local-day separators and "time: text" lines. Chips for date/priority/labels/assignee and the composer come with their phases; no placeholders. A task that disappears closes the panel.

## D-061 — List view with tasks, Mark all incomplete, checklists on the clipboard (M3.1)  (2026-11-26 · Accepted · extends D-055)
Decision (orders `[assumption]`):
- `viewBlocks(rows, prefs, depth, me)`: Show tasks only keeps task rows; Hide completed drops completed tasks with their subtasks; sorts reorder top-level rows and keep subtasks under them — Creator (yours first, then by creator), Creation date (newest first), Completed (open tasks and other blocks in stored order, then completed tasks, most recent first). `AVAILABLE_LIST_SORTS` adds creator, created, completed; priority/due/label come with M3.2, assignee with M7.3, source with M9.
- Sublist rows show the open tasks of the sublist page (tasks and subtasks), read from its blocks query, which live sync keeps fresh.
- ⋮ → Mark all incomplete reopens every completed task of the page (not sublists) as one ordinary batch, with an Undo toast; no extra route.
- Clipboard: tasks write `- [ ] text` / `- [x] text` Markdown and `☐/☑` HTML paragraphs; Markdown checklists paste as tasks (flat), keeping completion. `BlockDraft.completed` carries it.

## D-062 — "Getting started" list (M3.1)  (2026-11-26 · Accepted · settles D-036's deferral)
Decision: `ensurePersonalWorkspace` (sign-up hook and every `GET /me`) claims `user_settings.getting_started_seeded_at` and, once only, creates "👋 Getting started" with an intro paragraph, a heading and task blocks describing what exists so far (one with a subtask), plus their activity, starred at the end of Favorites. Earlier accounts get it on their next `/me` (the backfill); a deleted copy never returns. Wording is Flolist's own `[assumption]`. No new libraries in M3.1.

---

## Open questions (resolve, then turn into decisions)
- ~~Q-1: Production domain~~ → resolved in D-029.
- ~~Q-2: SMTP provider~~ → resolved in D-032 (Hostinger).
- ~~Q-3: Share the Oracle VM with n8n?~~ → resolved in D-029 (shared).
- Q-4: Should the MCP-server equivalent (which lets AI assistants use Flolist) be built? It's AI-adjacent, so it's parked in the backlog unless approved.
- Q-5: An Apple Developer account ($99/yr) is needed to sign and notarize the macOS Tauri app (and later iOS) → needed in M10. Local unsigned builds work until then.
- Q-6: A Firebase project for FCM (Android/iOS push) → needed in M11.
