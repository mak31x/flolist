# Views and navigation spec

## Sidebar (top to bottom)
1. Top-right icons: **Search** (⌘F) and **Collapse sidebar**.
2. System views, each with an accent icon:
   - **Inbox** `/inbox` (⌘1)
   - **Today** `/today` (⌘2)
   - **Week** `/my-week`
   - **All tasks** `/all-tasks` (⌘4)
   - **Updates** `/updates` (⌘3), with an unread badge
   - **All lists** `/all-lists` (⌘5); a dot badge appears when there are pending list invitations
   - *(Superlist's "Meetings" item is excluded.)*
3. **Favorites** (the default section) and user-created **Sections**. Each section header has a collapse chevron. On hover it shows two icon buttons: "New list in section" and "New section". Right-click a section → Rename · Delete (lists are kept) · New section below.
   - Entries are starred lists, each with an emoji or icon and a title. Drag to reorder within a section, or move between sections.
   - Lists without a section that are still pinned show under "All lists" [assumption: they show in a final unnamed group].
   - Right-click a list → Open · Rename · Change emoji · Duplicate · Unstar (remove from sidebar) · Leave shared list (if shared) · Delete.
   - Clicking the emoji opens the emoji picker straight away.
4. Spacer.
5. Bottom: a **"+" Quick create** button (menu: New task → Inbox, New list, New section) and the **user avatar**. The Superlist "Upgrade" pill is excluded.
   - The avatar menu lists workspaces (Personal plus each team), each with an **on/off visibility toggle**. Hovering a team row shows a **›** that opens the team page. See "Workspace filter" below and collaboration.md §3. Then: **+ New team** · **Settings** · **Trash** · **Integrations** · **Keyboard shortcuts** (⌘/ or ⌘?) · **What's new** (changelog) · **Get support** (mailto/configurable link) · Sign out.

## Inbox `/inbox`
- Holds open tasks that are in the user's `inbox_items`. Items arrive there automatically when the task is assigned to the user by someone else (or by themself from another view), created by an integration or email forwarding, or created with Quick Create (⌘K, Shift+Alt+Space) without a list. Users can also create a task directly in the Inbox, or add any task with right-click → "Add to Inbox" (⌘⇧I) or by dragging it in.
- A task leaves the Inbox when it is completed, when the user chooses right-click → "Remove from Inbox", or when it is dragged onto a list (which moves it there).
- Header: title "Inbox", filter/sort button (pill), ⋮ menu (Hide completed, sort options). New task row with the ^N hint. Manual ordering is allowed (drag).
- Subtasks show nested under their parent (from Superlist 1.59).
- Empty: skeleton squiggles. The right panel shows a cover.

## Today `/today`
- Title "Today" plus the date ("24 Nov"). Header pills: sort (default "Due date"), ⋮. Right side: ‹ previous day · calendar (jump to a date) · next day ›. Off today, the title shows the weekday and date.
- Tabs **Open | Completed** (Completed = tasks completed that day).
- Content: every open task due on that day or earlier (overdue) that the user can access, whether it is in the Inbox or a list, **assigned to me or unassigned** [assumption: tasks assigned to others are excluded, unless I created them and they are unassigned]. Overdue tasks sit in a collapsible "Overdue" group at the top, with a "Reschedule all → Today" action [assumption].
- New tasks created here are due on the displayed day and go to the Inbox.
- Optional "Daily planning" reminder (mobile): a notification at a chosen time.
- Manual ordering inside Today is stored per user per day [assumption].

## Week `/my-week` (title "My Week")
- Horizontal columns, each ~260px, scrolling horizontally. The **first column** is the "unscheduled" source: by default **Inbox ▾**, and the dropdown can switch it to any list. It shows only tasks *without* a due date.
- The next 7 columns are days ("Mon 23", "Tue 24"…), starting on the user's "First day of week". Today's column is emphasised (bold, darker).
- Each column has a "New task" row (today's column shows the ^N hint); a new task gets that day as its due date.
- Drag a task between columns to change the due date, keeping the time and recurrence. Dragging out of the Inbox column removes the task from the Inbox; dragging out of a list column leaves its list unchanged. Multiselect lets several tasks be dragged across columns at once.
- Completed tasks, overdue tasks from previous weeks, and undated tasks (other than in the first column) are hidden. A recurring task appears on its next due date if that date falls within the week.
- Header: ‹ week · calendar (back to the current week) · week › · filter (hide/show assigned-to-others, labels).
- Remembers the chosen list and week until the app reloads.
- Mobile: one day at a time, swipe between days and roll into the next week. To move a task to another day, drag it to the screen edge and hold.

## All tasks `/all-tasks` (title "Tasks")
- Header pills: sort (default "Creation date") and "+ New task".
- A search icon followed by tabs: **Tasks for me** (assigned to me, or unassigned tasks in my lists) · **Others** (assigned to someone else) · **Upcoming** (assigned to me with a future due date, grouped by date) · **Done** (completed, newest first).
- Rows show the title and, beneath it, a breadcrumb with the list icon and name.
- Sort options: Creator · Assignee · Alphabetical · Creation date · Due date · Source · List · Label · Team(workspace). Choosing a sort option also groups the rows under collapsible headers (Space toggles a group when its header is selected).
- Done tab filters: assignee, due date, creation date, source, list.
- Search matches titles only (with an inline search field).

## All lists `/all-lists` (title "Lists")
- Header pills: sort (Creation date / Alphabetical / Last opened) and "+ List".
- A dismissible tip banner.
- Tabs **All | Shared | Private**.
- Rows: emoji, title, creator (if not me), a shared or private icon, and a ★ toggle (star = pinned in the sidebar). Hovering shows ⋮.
- Includes pending invitations at the top, with Accept / Decline.
- Search field filters by title.

## Updates `/updates`
- Tabs **All | Tasks | Messages | Lists**.
- Feed items: reminders firing; list invitations ("X shared 'Groceries' with you" → Add to sidebar); tasks I created or that are assigned to me being completed by someone else (quick reply **"Good job 👏"**); new messages on tasks I created, am assigned to or follow; @mentions; assignments to me (quick reply **"On it 👍"**).
- Each item shows the actor avatar, a sentence, the task or list link, a relative time and an unread dot. Clicking opens the task details or list.
- Right-click / long-press → Mark as read/unread · Remove. Header ⋮ → Mark all as read [assumption].
- Empty state: an illustration and "Tasks assigned to you, comments, completed tasks and everything else will appear here."

## Search (⌘F)
- A modal overlay with a single input. Results are grouped as Lists · Tasks · (Messages later) and match titles plus the text content of blocks. Search uses Postgres full-text (`title_tsv`) plus trigram matching on the server, with debounced queries. Once the offline cache exists (M8), cached lists are searched locally first [assumption]. Arrow keys plus Enter open a result. Recent searches are shown when the input is empty.

## Quick command (⌘K, also Shift+Alt+Space on desktop apps)
- A centred dialog for creating a task fast. The title field supports natural-language dates, `#label` [assumption], `@person` to assign [assumption] and `/list` to pick a list [assumption].
- With no list chosen, the task goes to the Inbox.
- Also works as a command palette: typing `>` switches to commands (Go to Today, New list, Toggle theme, Open settings…) [assumption; a Flolist addition, still keyboard-first].

## Multiselect (all task views and lists)
- Shift-click selects a range and Mod-click toggles a row (long-press on mobile). A floating action bar appears with: Move to list · Add to/Remove from Inbox · Set due date · Assign · Label · Duplicate · Copy as text / Markdown / links · Mark complete · Delete.
- Dragging carries the whole selection.

## Navigation history
- ⌘[ goes back and ⌘] goes forward; browser history works too. Esc clears the selection, then closes the details panel, then closes menus.

## Workspace filter (avatar-menu toggles; full rules in collaboration.md §3)
- Each enabled or disabled workspace filters, **by list owner**, the sidebar, All lists, Inbox, Today, Week, All tasks, team pages and Search. Updates is not filtered [decided].
- At least one workspace stays enabled (turning off the last one falls back to Personal only).
- The avatar button shows the stack of enabled workspace avatars.
- Opening a list from a hidden workspace shows "This list is hidden" with "Toggle <Workspace> on to see list content" and a [Show <Workspace>] button.
- Animations: see ui-design.md §7.

## Team page `/team/:teamId`
- See collaboration.md §2: header with team avatar + name, then tabs Lists (n) / Tasks (n) / Members (n) with search, ⋮ (Rename, Delete team / Leave team), and "+ New list" (creates a team-owned private list).
