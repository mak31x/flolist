# Tasks spec

## Task properties
| Property | Notes |
|---|---|
| title | plain text with inline links; editable inline and in the details panel |
| completed / completed_at / completed_by | checkbox; completed tasks stay in place in lists |
| home list | the list (or parent task) the task block lives in; tasks created in Inbox/Today/Week with no list have `list_id = null` and live only in the Inbox |
| due date + optional due time | timezone-aware (see CLAUDE.md rules) |
| recurrence | RRULE + anchor (D-009) |
| reminders | 0..n per user per task; the UI exposes one "Remind me" (Superlist parity) |
| assignee | **single assignee** (Superlist parity) or none |
| priority | none · low · medium · high, shown as signal bars (High in the accent) [assumption: Superlist shows a "bars" icon with levels; confirm visually and adjust] (D-067) |
| labels | 0..n workspace-scoped labels; rename/merge/delete in Settings → Labels |
| body | block content (subtasks, text, images, attachments), like a small list |
| messages | discussion thread at the bottom of the details panel |
| source | `manual` · `email` · `gmail` · `github` · `slack` · `linear` · `gcal` · `api`, with `source_url` (icon links back) |
| activity | an auto log of changes to title, status, due date, assignee, list, priority and labels, with actor and time |
| created_by / created_at | |

## Creating tasks
- In a list: press Enter after a task, type `[]` + space, or choose slash → Task.
- In Inbox/Today/Week: click "New task" or press **C** or **Mod+N** (Alt+N on Windows/Linux). In Today the due date is today; in a Week column it's that day.
- Quick command **Mod+K** (desktop app also uses **Shift+Alt+Space**) → Inbox.
- From integrations, email forwarding, and the API (M9).
- **Mod+Enter** creates a new task and opens its details straight away.

## Natural-language dates (own parser, English only)
- Typing date phrases in a title shows a **suggestion popover** under the caret (e.g. "📅 Tomorrow 5:00 pm"). Return, a click or a tap accepts it: the phrase is **removed from the title** and the due date/time is set. Esc, or simply continuing to type, ignores it.
- Supported: today, tomorrow, weekdays ("thursday"), "this/next <weekday|week|month>", "end of <week|month>", "January 5th", "Jan 2027", times ("at 5pm", "17:00"), and repeats ("daily", "every week", "every monday", "every 2 weeks", "monthly", "yearly", "every weekday").
- Not supported (parity): complex rules such as "every second Wednesday of the month" (use the custom repeat UI instead).
- Phrase meanings ("this week", "next friday", time-only phrases, ranges, false positives such as "sun" or "march on") are listed in D-065 [assumption]. Repeat phrases are parsed now but only offered once recurring tasks exist (M5.1).
- Wrap chrono-node (plus our own recurrence-phrase rules) in `packages/shared/src/dates/parseNaturalDate.ts`, which both the web app (instant suggestions) and the API (email forwarding, Slack, public API) use. Cover it with fixture tests: input, reference "now", timezone and week start → expected date/time/rrule and the consumed text span. Honour the first-day-of-week setting for "next week".

## Due dates
- Set via the chip or date picker (see ui-design.md §6) or with the shortcuts ^T (today), ^D (pick), ^⇧D (clear). Off Apple platforms these use Alt instead of Ctrl, since Ctrl is Mod there [assumption] (D-068).
- A due date without an explicit zone takes the setter's profile time zone; the stored wall-clock date/time is shown as is [assumption] (D-063).
- Display: "Today", "Tomorrow", a weekday name within the next 6 days, otherwise "24 Nov" (with the year if it isn't the current year). Add the time if set ("Tomorrow 5:00 pm"). Overdue dates show in the accent colour.
- A task with a due time and Google Calendar connected syncs as a 30-minute event; all-day otherwise (M9).

## Recurring tasks
- Presets: Daily · Weekly on <weekday> · Every 2 weeks on <weekday> · Every weekday (Mon–Fri) · Monthly on the <nth> · Yearly on <date>.
- Custom: "Repeat every [n] [day|week|month|year]", plus specific weekdays when the unit is week (e.g. Mon + Thu, or weekdays except Friday).
- **On completion:** log a `task_completions` row, set the next due date (next occurrence after the *current due date*, skipping past occurrences so it lands on or after today [assumption]), uncheck the task and its subtasks, keep every other detail, and show a toast "Repeats · next due Tue 1 Dec · Undo".
- Ending a repeat: choose Repeat → Clear. An optional end date or count (`UNTIL`/`COUNT`) can be set in custom mode [assumption: Flolist extra, hidden behind "Ends…"].
- The recurrence icon ↻ shows in the meta line and in the due chip.

## Reminders
- A reminder needs a due date **and** a time. Presets in the "Remind me" row: At time of due · 5 min before · 15 min before · 30 min before · 1 hour before · 1 day before (9:00) · Custom date/time [assumption: Superlist's exact list is unknown].
- At fire time the worker sends a push notification to every device of the user (FCM to macOS, web, Android and iOS), adds an Updates entry, and plays an in-app toast if the app is open.
- Notification actions: **Complete** and **Snooze** (10 min · 1 hour · Tomorrow 9:00), matching Superlist 1.58.
- A recurring task's reminder re-arms relative to the new due date.
- Reminders belong to the user who set them [assumption].
- Native shells (M10+) also schedule reminders locally (Tauri notification plugin, Capacitor local-notifications) so they fire offline. The server push is deduplicated per device by `reminders.sent_at` [assumption].

## Subtasks
- Subtasks are task blocks inside a parent task's body. Create them in the details panel, by pressing Tab on a task in a list (it becomes the last subtask of the task directly above; Shift+Tab, or Enter/Backspace on an empty subtask, moves it back out below its parent) [assumption], or on mobile by swiping a task left and choosing "add subtasks". Subtasks nest at most 4 levels deep [assumption].
- In lists and views, the parent shows a progress ring with a "done/total" count of its direct subtasks [assumption]. Subtasks render nested under the parent in Inbox, Today and lists (collapsible).
- Subtasks have the same properties as tasks (dates, assignee and so on) and can appear in Today/Week on their own merits, with a "↳ Parent title" breadcrumb.
- Completing a parent does **not** auto-complete its subtasks (Superlist parity) [assumption]. Deleting a parent sends its subtasks to Trash with it.

## Labels
- Free-text labels, unique per workspace (case-insensitive), with a colour from the theme palette [assumption: Superlist shows grey label chips; colour is optional]. Grey chips with an optional colour dot; names ≤ 50 characters, leading `#` dropped [assumption] (D-064).
- Add through the chip, ^L, the editing-row tag icon, or `#label` in the quick command [assumption].
- Integration-created tasks get system labels (Gmail, Slack, GitHub + the repo name + issue/PR) that users can rename.

## Assignees
- Assign through the avatar button on hover, the chip, or ^A (clear: ^⇧A). Suggestions come from list collaborators and recent collaborators; you can also type an email.
- Assigning someone who can't see the list gives them access to **that task only** (it shows in their Inbox; the list stays hidden from them).
- Only registered users can be assigned. For an unknown email, offer to "Invite to list" instead.
- The assignee gets a notification plus an Inbox entry.

## Task actions (context menu / ⋮ / multiselect)
Open details · Complete/Uncomplete (⌘D) · Set due date · Assign · Label · Priority · Add to / Remove from Inbox (⌘⇧I) · Move to list… · Remove from list (⌘⇧R; moves it back to Inbox only) · Duplicate · Copy link · Copy as text · Copy as Markdown · Delete.

## Duplicate
An exact copy of the task with its body and subtasks: incomplete, no assignee, no due date. It is inserted directly below the original.

## Activity log
Recorded for: created, title changed, completed/reopened (with the new due date for recurrences), due date set/changed/cleared, assignee changed, moved between lists, priority changed, labels changed, restored from trash. Each entry is shown as "1:49 pm: Karan changed the due date to 1 Dec", grouped under day separators and interleaved with messages. Title edits by the same person within 10 minutes merge into one entry [assumption].

## Printing / export
A task (or list) prints with a clean stylesheet. Copy-as-Markdown preserves subtasks as nested `- [ ]` items.
