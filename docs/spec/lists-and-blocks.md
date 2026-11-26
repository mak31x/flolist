# Lists, sections, favorites and the block editor

## Lists
- A list is a **rich document**: a title, an emoji/icon, an optional cover image, and an ordered sequence of blocks (tasks, text, headings, images, files, sublists…). It can be a plain checklist or a structured doc with headers.
- Create one with "+ New list" in the sidebar, the Lists page, the Quick create menu, or a section's hover "New list". The cursor lands in the title, and Enter moves into the first block.
- **Private by default.** The header shows a lock "Private" state until the list is shared. Sharing is covered in collaboration.md.
- Each list belongs to exactly one **workspace** (Personal or a team; see collaboration.md). Lists created from the sidebar, Lists page or Quick create go to **Personal** by default; lists created from a team page belong to that team. Ownership can be changed later in the Share popover. New lists are auto-starred into the creator's Favorites (observed).
- **Header actions** (top-right of the main card, as pills): **Share** · filter/sort (funnel) · **★ star** (pin to sidebar) · **⋮** menu.
- **Filter/sort menu:** toggles **Show tasks only** (hides text, headings and media) and **Hide completed tasks**; sort options *(manual default)*: Creator · Assignee · Alphabetical · Priority · Creation date · Due date · Source · Label · Completed. A sort is a view setting (per user, per list) and does not rewrite stored positions. While sorted, drag reorder is disabled and a "Sorted by X · Reset" chip appears [assumption].
- **⋮ menu:** Print list (print stylesheet + `window.print()`; system print dialog in Tauri) · Duplicate list · Mark all incomplete · *(separator)* · **Go to <Team> ↗** (team-owned lists only) · *(separator)* · Delete list (red, with confirm: "Delete '<title>', including all of its tasks and attachments?" Cancel / Delete). The footer shows "Created by <avatar> <name>" and the creation date.
- **Customize** (gear on the cover/right panel): emoji (presets plus a full picker), cover image (6 built-ins plus upload ≤25 MB), and remove cover.
- **Delete** sends the list, its blocks, tasks, subtasks and sublists to Trash (one trash root). Only the creator or an owner/admin can delete a list; collaborators cannot.
- **Duplicate** makes an exact copy of the content. Tasks come back incomplete, without assignees or due dates. Sharing is not copied (the duplicate is private and placed directly under the original in the sidebar if the original was pinned) [assumption]. The title becomes "<title> (copy)".
- **Mark all incomplete** resets every task in the list, including subtasks. It's useful for reusable checklists and templates.

## Sections and favorites (per user)
- Sections are the user's own groupings in the sidebar ("Favorites" is the default section and cannot be deleted [assumption]).
- Starring a list adds it to Favorites. Unstarring removes it from the sidebar only (the list is still in All lists).
- Drag lists between sections and drag sections to reorder them. Deleting a section never deletes its lists. They are unpinned from the sidebar but stay available in All lists [assumption].
- Sidebar state is per user: `sidebar_entries(user, list, section, position)` and `sections(user, title, position, collapsed)`.
- Favorites can be renamed; a user has at most 200 sections; sections reorder by mouse/touch only for now (D-044) [assumption].

## Sublists
- The slash menu's "Sublist" block creates a child list inside the current list (or inside a task's details). It shows in the parent as a row with a list icon, its title, and a count of open tasks. Clicking it opens the sublist as a page with a breadcrumb `Parent › Sublist`.
- A sublist inherits the parent's workspace and **access** (members of the parent can see it). There are no separate member lists in v1 [assumption].
- Nesting depth is unlimited in the data, but the UI shows breadcrumbs up to 3 levels with "…".
- Sublists can be starred into the sidebar on their own.

## Block types
| Type | Created by | Notes |
|---|---|---|
| `task` | slash "Task", `[]` + space, Enter after a task, Return in task views | points to `tasks` row; shows checkbox + meta |
| `sublist` | slash "Sublist" | points to child `lists` row |
| `paragraph` | default / slash "Paragraph" | inline marks: **bold** ⌘B, *italic* ⌘I, ~~strike~~ ⌘⇧X, link ⌘L, `code` ⌘E [assumption] |
| `heading1/2/3` | `#`, `##`, `###` + space, slash | H1/H2/H3 |
| `bullet` | `-` or `*` + space | supports indent levels (Tab) |
| `numbered` | `1.` or `1)` + space | auto-numbering per contiguous run |
| `quote` | `>` + space, slash "Blockquote" | |
| `divider` | `---`, slash "Divider" | Superlist dividers are "colourful": pick a colour from the theme palette [assumption: 6 colours] |
| `image` | slash "Image", paste, drag file | ≤25 MB, any image format, inline, click to view full screen; caption optional |
| `attachment` | slash "Attachment", drag file | ≤25 MB any type; shows file icon, name, size, download |
| *(excluded)* | ~~Talk~~, ~~Make with AI~~ | not built |

## Editor behaviour (custom block editor + per-block Tiptap; see D-007)
- **Placeholder** on an empty list or task body: "Start typing, or type '/' to choose a different content type".
- **Slash menu** (`/` at the start of a block, or the block-type button): a filterable list in this order: Task, Sublist, Paragraph, Heading 1, Heading 2, Heading 3, Divider, Bullet list, Numbered list, Blockquote, Image, Attachment. Use arrow keys plus Enter; Esc closes it and leaves the `/`.
- **Block handle** (hover, left): ⋮⋮ drags; the circular block-type button opens Turn into (convert between text types and task) · Duplicate · Copy link (tasks) · Delete.
- **Enter** at the end of a block makes a new block of the same type (task → task, bullet → bullet). Enter on an empty bullet/task/numbered block turns it into a paragraph. In the middle of text, Enter splits the block.
- **Backspace** at the start of a block: a non-paragraph block becomes a paragraph; a paragraph merges into the previous text block. On an empty task, it deletes the task (it goes to Trash, with an undo toast).
- **Tab / Shift+Tab** on a task block indents or outdents it, making it a **subtask** of the task above (it moves into that task's body) or promoting it back. On bullets, Tab changes the indent level.
- **↑/↓** at the edge of a block moves to the previous or next block, keeping the caret column where possible.
- **Mod+A** first selects the block's text, then all blocks. Shift+↑/↓ extends a block selection. Mod+C / Mod+X / Mod+V copy, cut and paste blocks as Markdown + HTML + an internal JSON format. Pasting Markdown checklists (`- [ ] foo`) creates tasks.
- **Undo/redo** (Mod+Z / Mod+Shift+Z) works across block operations within the session (a client-side command stack that issues inverse mutations).
- **Drag and drop** blocks within a list or task body, into a sublist row, into the sidebar (move to another list), or onto Week day columns. Dropping files creates image/attachment blocks.
- **Tasks in lists** show subtasks nested under them (collapsible chevron) with a progress indicator "2/5" (a small ring plus count) when they have subtasks.
- **Typing a date** in a task title triggers the natural-language suggestion popover (see tasks.md).

## Performance
- Virtualize long lists (> 200 blocks) with @tanstack/react-virtual. Keep editors lazy: render static HTML until a block is focused. Test with 2,000 blocks: scrolling stays smooth (60fps) in Chrome and the Tauri webview, and a cached list opens in under 300ms.
