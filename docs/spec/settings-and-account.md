# Settings, themes, Trash and account

Settings live at `/settings/:tab` and render in the main card as a title "Settings" plus a row of pill tabs (horizontally scrollable, with a › arrow button). A **Sign out** pill sits at the top-right.

## Tabs
1. **Profile**
   - **Task activity** card: a GitHub-style heatmap of completed tasks per day over the last 12 months, grouped by month, with the accent colour for active days and the caption "N completed tasks in the last 12 months".
   - **Personal info:** photo (upload/crop), first name, last name, primary email (read-only, muted; changing it is a support action) [Flolist: allow a change with re-verification, assumption].
   - **App language:** System default / English (i18n scaffolding only for now; strings go through `t()` from day one) [assumption].
   - **First day of the week:** System default (shows the resolved day) · Monday · Sunday · Saturday. Used by the calendar, My Week and the "Next week" due date.
   - **Export account data:** "Download a .csv file with your account data" (lists, tasks, subtasks, labels, dates, completion; one CSV in a ZIP if there are several files) [Flolist extra: also JSON + Markdown export].
   - **Account deletion:** "This action is permanent and cannot be undone." A red pill opens a confirm dialog where the user types their email. It deletes personal-workspace data and leaves teams (if the user is the sole owner, they must transfer or delete the team first).
2. **Features**
   - **Appearance → Active theme** dropdown; each option shows 3 colour dots and a name (see the themes list below).
   - **Sounds:** "Enable sound effects" (task check-off and some button clicks).
   - **Auto-capitalization:** "Capitalize the first letter of each sentence as you type".
   - *(Talk voice AI and Meeting notes settings are excluded.)*
3. **Workspaces** (replaces Superlist's "Subscriptions" tab, minus billing): one card per workspace (Personal + each team) with avatar, name, role, member count and list count; a "Go to team" link (opens `/team/:id`); and "+ New team". Team management lives on the team page (collaboration.md §2).
4. **Integrations:** cards for Gmail, Google Calendar, Microsoft To Do, Email forwarding, Slack, GitHub and Linear. Each shows an icon, title, one-line description, connection status ("1 account connected" in green) and a Configure button (integrations.md).
5. **Notifications:** Activity Summary Emails (toggle + Frequency Weekly/Monthly), Daily planning notification (mobile; toggle + time), and push categories (Flolist extra).
6. **Labels:** every label across accessible workspaces. Rename (renaming to an existing name merges the two) and Delete (removes it from all tasks).
7. **Collaborators:** people who share lists with you or have task access. You can hide someone from assignee suggestions (without removing their access).
8. **Developer** (M9, Flolist extra): personal API tokens and webhooks.

## Themes (all token sets; D-011)
System preference · Light · Dark · Blackout (true-black OLED) · Ocean · Berry · Forest · Sunset · Blossom · Blue & White · Black & Yellow · Blue & Red · Red & White · High contrast light · High contrast dark.
- "System preference" follows `prefers-color-scheme` and switches between Light and Dark.
- Each theme defines every token in ui-design.md §3. The coloured themes tint the canvas, accent and sidebar (e.g. Ocean = blue-teal canvas with a teal accent, Forest = green, Sunset = orange/peach, Berry = purple-magenta, Blossom = pink). The two-colour themes are bold, high-saturation palettes. High-contrast themes must meet WCAG AAA for text.
- The theme preference is stored on the user (synced across devices) and cached in localStorage (wrapped in try/catch) to avoid a flash on load.

## Trash `/trash` (avatar menu → Trash)
- Holds deleted tasks, lists and sublists. Deleting a list includes its contents under the same trash root, and they are restored together.
- Search by title. Each row shows the type icon, title, original location, who deleted it, when, and the actions **Restore** and **Delete forever**.
- Bulk actions: desktop checkboxes / mobile long-press → Restore or Delete forever (with a confirm dialog; this can't be undone).
- Restore rules: a task goes back to its list. If that list is itself in Trash or gone, the task goes to the Inbox and the list stays in Trash. A list goes back to its original location (parent list or workspace). If that location is gone, it goes to the top level of the personal workspace.
- If the user no longer has access to the source list or team, restoring fails with "You no longer have access to this item."
- No automatic purge (Superlist parity). An admin-configurable `TRASH_RETENTION_DAYS` env exists, defaulting to off.

## Authentication screens
- `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/verify-email`: centred card with the Flolist wordmark, "Continue with Google" (only when the server has Google keys), and an email + password form. Keep the visual style calm and consistent with the app.
- Email must be verified before the first log-in. `/verify-email` says "Check your inbox" after sign-up (with a resend button) and explains expired or used links. The verification link signs the user in and lands them in Inbox. `/reset-password` is where the reset email's link lands (token in the URL). Copy is ours `[assumption]` (D-036).
- After sign-up: create the personal workspace (M1.1) and seed a "Getting started" list that explains features as tasks the user can tick off (M3.1, once task blocks exist; with a backfill for accounts created before then).
