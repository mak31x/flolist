# Integrations (milestone M9)

AI options that Superlist offers inside integrations (Slack AI title suggestions, "Summarize email", auto-summarization) are **excluded**. Each integration has a Settings → Integrations card with Configure, a list of connected accounts with Disconnect buttons, and per-trigger toggles. Disconnecting always keeps the tasks that were already created.

Shared model: `integration_accounts(user_id, provider, external_account_id, display_name, encrypted_tokens, settings jsonb, status)`. Tokens are encrypted at rest (AES-GCM with a key from env). Tasks carry `source` and `source_url`, and the source icon on a task opens the original item. Every integration task lands in the **Inbox**, unassigned unless noted, with a system label for filtering.

## 1. Email forwarding (build first; simplest)
- Each user gets a unique private address, e.g. `u-<random>@in.flolist.<domain>`, shown in Settings → Integrations → Email forwarding, with copy and regenerate actions.
- Inbound route: Cloudflare Email Routing → Email Worker → POST to `/api/v1/inbound/email` with an HMAC signature. Alternatives are Mailgun or Postmark inbound webhooks; record the choice in decisions.md.
- Mapping: subject → title, body (text, or sanitized HTML converted to Markdown blocks) → task body, attachments → attachment blocks (≤ limit). The task goes to the Inbox with `source=email`.
- [Flolist extra] A per-list address so mail goes straight to a list (in the backlog).

## 2. Google Calendar (two-way)
- OAuth with calendar scope; multiple Google accounts allowed.
- Tasks that **I created or am assigned to** and that have a due date become events. With no time they are all-day; with a time they are 30-minute blocks. Only dates set after connecting are synced.
- Changing the title or date in either place updates the other. Deleting the event clears the task's due date. Completing the task deletes the event by default (setting: keep it, marked ✓).
- **Today** can show today's meetings from connected calendars at the top (read-only event rows with time and title; optional setting "Show meetings at the top of Today"). This is just calendar display; there is no meeting-notes feature.
- Implementation: Google push notifications (watch channels) plus incremental sync tokens, handled in the worker. A dedicated "Flolist" calendar [assumption: Superlist writes to primary; choose one and log it].

## 3. Gmail
- OAuth (read + modify; send only if needed for archiving). Multiple accounts allowed.
- Triggers (each toggle): **starred** emails, emails marked **important**, emails with the label **"Flolist"**.
- Task: subject → title, body → task details, Gmail icon → link to the thread, label "Gmail" (renameable).
- After creating or completing a task: keep / archive / delete the original email (one setting).
- Polling: Gmail push (Pub/Sub) if feasible, otherwise polling every 2 minutes with `historyId`.

## 4. GitHub
- GitHub App or OAuth app plus webhooks. Repo admin rights are needed when webhooks are used. Multiple accounts allowed.
- Triggers (toggles): **review requested** on a PR from me; **issue assigned** to me.
- Task: GitHub title and description, labels `GitHub`, `<repo>`, `Issue|PR`, and a link back.
- Two-way: GitHub comments appear as task messages, and messages written in Flolist post as comments.
- Auto-complete when the PR is reviewed by me, closed, merged or converted to draft, or when the issue is closed or I'm unassigned. Reopen on the reverse event.

## 5. Slack
- A Slack app with OAuth (workspace member).
- Message shortcut **"Create a task"** opens a modal with title, description, assignee, due date and list (default Inbox).
- Slash commands: `/flolist list` (my lists), `/flolist create <title> [on <list>]`. Responses are ephemeral.
- An ephemeral confirmation with a link, plus edit buttons.
- An App Home tab shows tasks due today, with a date picker; each task has a checkbox (completes it in Flolist), "Open in Flolist" and Edit.
- Link unfurls for Flolist task URLs (title, due date, assignee).
- The task carries a Slack icon linking to the message and the label "Slack".

## 6. Linear
- OAuth plus webhooks. Issues assigned to me become tasks, completion syncs both ways, and comments sync both ways [assumption: mirrors GitHub behaviour].

## 7. Microsoft To Do (low priority)
- Microsoft Graph OAuth. Two-way sync of chosen To Do lists with Flolist lists (title, due date, completion).

## 8. Flolist public API + webhooks (Flolist extra, M9)
- Personal access tokens (Settings → Developer), a REST API that reuses `/api/v1` with bearer auth and scoped permissions, and outgoing webhooks on task events.
- This lets the owner's n8n instance automate Flolist (e.g. create tasks from Meta lead forms).

## 9. MCP server (Q-4 in decisions; not planned unless approved)
- Superlist exposes `/mcp` with OAuth so AI assistants can read and change tasks. It's AI-adjacent and excluded by default; if approved, build it on top of the public API.
