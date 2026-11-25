# Keyboard shortcuts (Superlist parity, adapted for the web)

`Mod` = ⌘ on macOS, Ctrl on Windows/Linux. `^` = Control key on macOS. Implement these in one registry (`apps/web/src/features/shortcuts/registry.ts`) so that tooltips, the cheat-sheet dialog (Mod+/), the Tauri native menu accelerators and the handlers all share a single source. In a browser tab, browser-reserved combos (Mod+T, Mod+N, Mod+W) use the listed **web fallback**. The desktop apps (Tauri) use the primary combo.

## General
| Action | macOS | Win/Linux | Web fallback |
|---|---|---|---|
| Go to Inbox | ⌘1 | Ctrl 1 | Alt 1 |
| Go to Today | ⌘2 | Ctrl 2 | Alt 2 |
| Go to Updates | ⌘3 | Ctrl 3 | Alt 3 |
| Go to Tasks (All tasks) | ⌘4 | Ctrl 4 | Alt 4 |
| Go to Lists | ⌘5 | Ctrl 5 | Alt 5 |
| Go to Week *(Flolist add)* | ⌘6 | Ctrl 6 | Alt 6 |
| Open Settings | ⌘, | Ctrl , | — |
| Back / Forward in navigation | ⌘[ / ⌘] | Ctrl [ / Ctrl ] | — |
| Quick command (new task → Inbox) | ⌘K | Ctrl K | — |
| Global quick add (desktop app, system-wide) | ⇧⌥Space | Shift Alt Space | n/a |
| Search | ⌘F | Ctrl F | — (override browser find inside app) |
| Keyboard shortcut cheat-sheet | ⌘/ | Ctrl / | — |
| Deselect / close menu / close latest detail view | Esc | Esc | — |
| Toggle sidebar *(Flolist add)* | ⌘\ | Ctrl \ | — |
| Copy / Cut / Paste / Select all | ⌘C/X/V/A | Ctrl C/X/V/A | — |
| Undo / Redo | ⌘Z / ⇧⌘Z | Ctrl Z / Ctrl Y | — |
*(Superlist's ⌘T Talk and ⌘⇧M New meeting are excluded.)*

## List editing
| Action | Keys |
|---|---|
| Content block menu | `/` |
| Bold / Italic / Link | Mod B / Mod I / Mod L |
| Strikethrough *(Flolist add)* | Mod ⇧ X |
| Bullet list | `-` + space |
| Numbered list | `1.` or `1)` + space |
| Heading 1 / 2 / 3 | `#` / `##` / `###` + space |
| Task | `[]` + space |
| Divider | `---` |
| Blockquote *(Flolist add)* | `>` + space |
| Indent / outdent (subtask) | Tab / ⇧Tab |
| Move block up/down *(Flolist add)* | Mod ⇧ ↑ / ↓ |

## Task views (Inbox, Today, Tasks, lists)
| Action | macOS | Win/Linux |
|---|---|---|
| New task in Inbox/Today | ⌘N (web: ^N) | Alt N |
| New task (single key, when not editing) | C | C |
| Mark selected task complete/incomplete | ⌘D | Ctrl D |
| Toggle selected ↔ editing | Return | Return |
| Open selected task's details (or create + open) | ⌘Return | Ctrl Return |
| Expand/collapse group when heading selected | Space | Space |
| Move selection | ↑ / ↓ | ↑ / ↓ |
| Extend selection | ⇧↑ / ⇧↓, ⇧-click | same |
| Toggle select | ⌘-click | Ctrl-click |
| Set due today | ^T | Alt T |
| Add due date | ^D | Alt D |
| Clear due date | ^⇧D | Alt ⇧D |
| Add assignee | ^A | Alt A |
| Clear assignee | ^⇧A | Alt ⇧A |
| Add label | ^L | Alt L |
| Clear label | ^⇧L | Alt ⇧L |
| Set priority *(Flolist add)* | ^P | Alt P |
| Add to Inbox | ⌘⇧I | Ctrl ⇧I |
| Remove from list | ⌘⇧R | Ctrl ⇧R |
| Delete selected | ⌘⌫ | Ctrl Delete |
| Duplicate *(Flolist add)* | ⌘⇧D | Ctrl ⇧D |

## Rules
- Single-letter shortcuts (C) are active only when focus is not inside an editable field.
- Show the shortcut in tooltips and in the "New task ^N" hint badge, using the platform-correct glyphs.
- The macOS (and later Windows) menu bar mirrors these shortcuts as menu accelerators (see platforms.md).
