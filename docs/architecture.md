# Architecture

Read this in phases that touch infrastructure, sync, auth or project structure. The binding choices are in decisions.md.

## System overview
```
Browser / PWA ─┐
Tauri (macOS, Windows) ─┼─ same React build ── HTTPS (REST /api/v1) + WSS (/ws)
Capacitor (Android, iOS)┘
                       ▼
Caddy (TLS · static web build · reverse proxy /api and /ws)
   ├── api      Hono on Node: REST, Better Auth, WebSocket hub, presigned file URLs
   ├── worker   pg-boss: reminders, push/email, digests, integrations
   ├── postgres single source of truth (+ pg-boss tables)
   └── object storage (MinIO dev / OCI Object Storage prod)
```

## Packages
- `packages/shared`: zod schemas for every API payload, entity types and enums. Also:
  - `dates/`: chrono-node wrapper and due-date display helpers
  - `recurrence/`: build/parse RRULEs, find the next occurrence, human labels like "Weekly on Tuesday"
  - `positions/`: fractional indexing
  - `permissions/`: a pure role → capability matrix used by the API and for showing/hiding UI. Test cases live in `permissions.fixtures.ts`.
- `packages/db`: Drizzle schema (spec/data-model.md), migrations, and a deterministic seed.
- `packages/ui`: tokens, `themes.css`, `motion.ts`, `brand.ts`, and base components: Button, Pill/Chip, SegmentedTabs, Avatar/AvatarStack, Checkbox, IconButton, Popover, Menu, Dialog, Toast, KbdHint, EmptyState, SkeletonSquiggle and Toggle.

## API conventions
- Base path `/api/v1`. Resources: `/workspaces`, `/teams/:id/members|invitations`, `/lists`, `/lists/:id/blocks`, `/lists/:id/share`, `/lists/:id/move`, `/tasks`, `/tasks/:id/messages`, `/labels`, `/sections`, `/sidebar`, `/inbox`, `/views/today|week|tasks`, `/notifications`, `/trash`, `/search`, `/uploads`, `/me/settings`. Better Auth is mounted at `/api/auth/*`.
- Every mutation body includes a `clientMutationId` (idempotency, unique per user for 24 h), and updates also send a `baseVersion`. The response is the updated entity with its new `version`.
- PATCH is field-level: send only the changed fields. On a version mismatch the server applies the non-conflicting fields, uses last-write-wins for the rest, and returns the merged entity.
- Errors look like `{ error: { code, message, details? } }`, with codes `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION`, `CONFLICT`, `LIMIT`.
- Authorization: every handler calls `authorize(ctx.user, action, resource)`, which resolves access as described in data-model.md "Access resolution".
- Activity and change events: a single `recordActivity()` and `emitChange()` write `activity_events` and an `outbox` row in the same transaction as the mutation. The outbox is drained to WebSocket channels after commit.

## Live sync (WebSocket)
- One socket per client at `/ws`, authenticated by the session cookie (web) or a bearer token (native).
- The client auto-subscribes to `user:<id>`, plus `workspace:<id>` for each workspace it belongs to and `list:<rootId>` for each open list.
- Events:
  - `{ type: "change", entity, id, version, op: "upsert"|"delete", data? }`: small entities include `data`; large ones cause a refetch.
  - `{ type: "access_changed" }`: refetch the list index and sidebar.
- On reconnect, the client refetches its active queries.
- Single node, in-process pub/sub. Postgres LISTEN/NOTIFY only if we ever scale out.
- Presence (who is viewing a list) is optional, in M7.3.

## Client architecture (apps/web)
- TanStack Router (file-based). URLs mirror Superlist: `/inbox`, `/today`, `/my-week`, `/all-tasks`, `/all-lists`, `/updates`, `/lists/:listId`, `/lists/:listId/tasks/:taskId`, `/team/:teamId`, `/settings/:tab`, `/trash`.
- TanStack Query for server state, with normalized patch helpers (`applyChange(event)`). Zustand for UI-only state (selection, multiselect, popovers, editor focus, workspace filter cache).
- Block editor in `features/editor/`:
  - BlockList renderer
  - per-block Tiptap inline editor (marks: bold, italic, strike, link, inline code)
  - keyboard controller (Enter splits, Backspace merges, Tab/Shift-Tab indents a subtask, ↑/↓ moves across blocks)
  - slash menu and markdown shortcuts
  - dnd-kit sortable, multiselect, and an undo stack
- Platform adapters live in `src/platform/` (`notifications`, `share`, `secureStorage`, `openExternal`, `hotkeys`, `menu`, `deepLinks`, `badge`), with implementations for `web`, `tauri` and `capacitor`, selected at build time via `import.meta.env.VITE_PLATFORM`.
- PWA: vite-plugin-pwa (Workbox) for app-shell caching and Web Push. Offline data arrives in M8 (D-006).
- Long lists are virtualized with @tanstack/react-virtual, and Tiptap instances are lazy: static HTML is rendered until a block gets focus.

## Jobs (apps/worker)
| Job | Trigger |
|---|---|
| `reminder.fire` | scheduled at `remind_at`; push to all devices, notification row, respects snooze |
| `push.send` / `email.send` | domain events (invites, mentions, assignments) |
| `digest.activity` | weekly/monthly cron per opted-in user |
| `trash.purge` | only if `TRASH_RETENTION_DAYS` is set (default off; Superlist never auto-purges) |
| `integration.*` | M9: polling/webhooks |

## Security
- Cookies are `HttpOnly`, `Secure` and `SameSite=Lax`, with CSRF protection on mutations (Better Auth defaults plus an Origin check). Native shells send `Authorization: Bearer`.
- Rate limits on auth, invitations and uploads.
- Uploads: size limit, MIME sniffing, and thumbnails generated in the worker.
- Integration tokens are encrypted at rest (AES-256-GCM, key from env).
- Row access is checked in the service layer, not with Postgres RLS. Keep it simple and test it well, using the permission fixtures.

## Environments
- `dev`: `pnpm dev` + `infra/docker-compose.dev.yml` (postgres, minio, mailpit).
- `prod`: `infra/docker-compose.prod.yml` on Oracle (deploy-oracle.md). An optional `staging` compose project on the same VM under `staging.`.

## Conventions
- Conventional Commits. One branch per phase, e.g. `phase/M2.1-sidebar`, squash-merged into `main`.
- Feature folders: `apps/web/src/features/<feature>/{components,hooks,api.ts}`.
- Use Superlist's names: Inbox, Today, Week/My Week, Updates, Lists, Sections, Favorites, Sublist, Label, Assignee, Team.
- IDs are UUIDv7 everywhere (sortable and generated on the client).
