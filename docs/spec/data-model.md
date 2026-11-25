# Data model (PostgreSQL via Drizzle)

Conventions:
- `id uuid` is the primary key: UUIDv7, generated on the client.
- `created_at` / `updated_at timestamptz`.
- `version int` goes up on every update (D-006).
- **(sd)** marks soft-delete columns: `deleted_at`, `deleted_by`, `trash_root_id`.
- `position text` is a fractional index (D-008).
- Better Auth owns its tables: `user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`. Extend or map them; never duplicate them.
- Columns marked *(Mx)* can be added in that milestone.

## Identity and workspaces
```
users (Better Auth user)  + first_name, last_name, avatar_file_id, timezone, locale,
                          week_start ('system'|'mon'|'sun'|'sat'), theme, sounds_enabled, auto_capitalize
user_settings             user_id PK, workspace_visibility jsonb ({workspaceId: bool}), hidden_collaborators uuid[],
                          notification_prefs jsonb, daily_planning_time NULL, digest ('off'|'weekly'|'monthly')
workspaces                id, kind ('personal'|'team'), name, emoji NULL, avatar_file_id NULL, owner_id,
                          organization_id NULL (→ Better Auth organization, for kind=team), created_at, deleted_at
```
- Team membership and invitations use Better Auth `member` (roles `owner` | `member`) and `invitation` (status, expiry). Map them through `workspaces.organization_id`.
- Personal workspaces have no organization; their only member is the owner.
- Better Auth tables use `uuid` ids (default `uuidv7()`) and snake_case columns; Better Auth runs with `generateId: false` (D-022). `member.role` is limited to `owner | member`.
- A team workspace must have `organization_id` and a personal one must not (CHECK); each user has exactly one personal workspace (partial unique index).

## Lists, sharing, sidebar
```
lists               id, workspace_id, root_list_id (= id for roots), parent_list_id NULL, parent_block_id NULL,
                    title, emoji, cover_file_id NULL, cover_builtin NULL, created_by,
                    link_access ('none'|'view'|'edit') default 'none', share_token unique,
                    version, (sd), created_at, updated_at
list_collaborators  id, list_id (root only), user_id NULL, team_workspace_id NULL, invited_email NULL,
                    role ('collaborator'|'viewer'), added_by, status ('pending'|'active'), created_at
                    CHECK exactly one of user_id / team_workspace_id / invited_email
list_view_prefs     user_id, list_id, sort, hide_completed, tasks_only
sections            id, user_id, title, position, collapsed, is_default
sidebar_entries     user_id, list_id, section_id, position            PK(user_id,list_id)
```
- The creator is `lists.created_by` and needs no collaborator row.
- Moving a list between workspaces updates `workspace_id` on the root list and all of its sublists, and records an activity entry.

## Blocks and tasks
```
blocks              id, container_type ('list'|'task'), container_id, root_list_id, position,
                    type ('task'|'sublist'|'paragraph'|'heading1'|'heading2'|'heading3'|'bullet'|'numbered'|'quote'|'divider'|'image'|'attachment'),
                    indent smallint default 0, content jsonb (Tiptap inline JSON / divider colour / caption),
                    task_id NULL unique, sublist_id NULL unique, file_id NULL,
                    created_by, version, (sd), created_at, updated_at
                    INDEX(container_type, container_id, position)
tasks               id, workspace_id, root_list_id NULL (NULL = Inbox-only task), list_id NULL, parent_task_id NULL,
                    title, completed_at NULL, completed_by NULL,
                    due_date date NULL, due_time time NULL, due_tz text NULL,
                    recurrence_rule text NULL, recurrence_anchor ('due'|'completion') default 'due',
                    priority smallint default 0 (0 none,1 low,2 medium,3 high), assignee_id NULL,
                    source ('manual'|'email'|'gmail'|'github'|'slack'|'linear'|'gcal'|'api') default 'manual', source_url NULL, source_ref NULL,
                    created_by, version, (sd), created_at, updated_at
                    INDEX(assignee_id, completed_at, due_date), INDEX(root_list_id), INDEX(parent_task_id)
                    title_tsv tsvector GENERATED + GIN (plus pg_trgm on title)
task_completions    id, task_id, completed_by, completed_at, due_date_at_completion      -- recurrence history + heatmap
task_access         task_id, user_id, reason ('assigned'|'mentioned')                     -- access without list access
inbox_items         user_id, task_id, position, added_at, reason ('assigned'|'manual'|'quick'|'integration')  PK(user_id,task_id)
today_order         user_id, date, task_id, position                                      -- manual order in Today [assumption]
labels              id, workspace_id, name, color NULL, UNIQUE(workspace_id, lower(name))
task_labels         task_id, label_id
reminders           id, task_id, user_id, offset_minutes NULL, remind_at timestamptz, snoozed_until NULL, sent_at NULL, job_id
```

## Communication and activity
```
messages            id, task_id, root_list_id, author_id, body jsonb (rich text + mentions), edited_at, deleted_at, created_at
message_files       message_id, file_id
task_followers      task_id, user_id, muted
activity_events     id, workspace_id, root_list_id NULL, entity_type, entity_id, actor_id, action, field NULL, old jsonb, new jsonb, created_at
notifications       id, user_id, type, actor_id, workspace_id, task_id NULL, list_id NULL, message_id NULL, payload jsonb, read_at NULL, created_at
devices             id, user_id, platform ('web'|'macos'|'windows'|'android'|'ios'), push_kind ('webpush'|'fcm'|'apns'), endpoint_or_token, keys jsonb NULL, name, last_seen_at
outbox              id, channels text[], event jsonb, created_at, dispatched_at      -- WebSocket fan-out after commit
applied_mutations   user_id, client_mutation_id, result jsonb, created_at          PK(user_id, client_mutation_id)  -- idempotency, 24 h TTL
```

## Files and integrations
```
files               id, workspace_id, storage_key, filename, mime, size_bytes, width NULL, height NULL, uploaded_by, created_at
integration_accounts id, user_id, provider, external_account_id, display_name, tokens_enc bytea, settings jsonb, status, created_at   (M9)
inbound_addresses   id, user_id, list_id NULL, local_part unique, created_at                                                         (M9)
api_tokens          id, user_id, name, token_hash, scopes text[], last_used_at, created_at                                           (M9)
webhooks            id, user_id, url, secret, events text[], active                                                                  (M9)
```

## Access resolution (`authorize()`, D-016)
```
canSeeList(u, L)   with R = root(L):
                     R.created_by = u
                  OR ∃ list_collaborators(R, user_id=u, status=active)
                  OR ∃ list_collaborators(R, team_workspace_id=T) AND u is a member of T
                  (opening a share link with link_access edit|view adds u as collaborator|viewer)
canEditList(u, L)  = canSeeList AND role ≠ viewer
canManageList(u,L) (move workspace, delete) = R.created_by = u
                  OR (R.workspace is a team AND u is its owner AND that team is a collaborator on R)
canSeeTask(u, t)   = (t.root_list_id NOT NULL AND canSeeList(u, t.root_list)) OR task_access(t, u)
                  OR (t.root_list_id IS NULL AND (t.created_by = u OR t.assignee_id = u))
Team rules         owner/member capabilities in collaboration.md §2
```
- WebSocket channels a user may join: `user:<self>`, `workspace:<w>` for each membership, `list:<R>` for each R where canSeeList holds, and `task:<id>` for task-level grants.
- `packages/shared/permissions/permissions.fixtures.ts` lists `(setup, action, resource) → allowed` cases. API integration tests and UI-gating tests both iterate over all of them.

## Seed data (`pnpm db:seed`)
- Users: a demo user plus 2 teammates.
- Workspaces: a Personal workspace, and the team "Acme" (the demo user is owner, the teammates are members).
- Lists:
  - "Getting started": every block type
  - "Groceries": personal, shared with one user
  - "Website relaunch": team-owned and shared with the team; has sublists, labels, assignees, and recurring and overdue tasks
  - "Private notes": team-owned, not shared
- Plus Inbox items and notifications.
- The seed is deterministic so e2e tests can rely on it.
