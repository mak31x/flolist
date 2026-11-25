# Platforms plan: web first, then wrappers (D-003, D-015)

All native apps wrap the same `apps/web` build. Platform specifics go through `apps/web/src/platform/*` adapters, and the build-time constant `VITE_PLATFORM` (`web` | `tauri` | `capacitor`) picks the implementation.

## Prerequisites (end of M8)
- The offline cache and mutation queue work.
- The PWA is installable.
- The bearer-token auth path is tested.
- The adapters exist for `notifications`, `secureStorage`, `share`, `deepLinks`, `hotkeys`, `menu` and `badge`.

## Web / PWA (from M0.4)
- Static build served by Caddy, installable as a PWA, Web Push via VAPID.
- Browser-reserved shortcuts use the web fallbacks in keyboard-shortcuts.md.

## macOS: Tauri 2 (M10)
- **Location:** `apps/desktop`. Tauri loads the built web assets (bundled; it doesn't point at the live URL, so it works offline) and talks to the prod API.
- **Window:** hidden/overlay title bar with native traffic lights. The sidebar draws under the title bar (`titleBarStyle: Overlay`, drag region on the sidebar top). Optional macOS vibrancy. The window frame is remembered (window-state plugin). Minimum size 900×600.
- **Native menu bar** (Tauri menu API), mirroring keyboard-shortcuts.md:
  - Flolist: About, Settings ⌘,, Hide, Quit
  - File: New task ⌘N, New list ⇧⌘N, Quick add ⌘K, Close ⌘W
  - Edit: Undo/Redo, Cut/Copy/Paste, Select all, Find ⌘F
  - View: Inbox ⌘1 … Week ⌘6, Toggle sidebar ⌘\, Theme ▸
  - Task: Complete ⌘D, Due today ^T, Add date ^D, Assign ^A, Label ^L, Add to Inbox ⇧⌘I, Delete ⌘⌫
  - Window
  - Help: Keyboard shortcuts ⌘/
- **Global quick add:** ⇧⌥Space (global-shortcut plugin) opens a small always-on-top quick-add window that creates an Inbox task and closes on Enter/Esc.
- **Menu bar extra** (tray), optional: shows today's count, Quick add and Open Flolist.
- **Dock badge** with the overdue + due-today count.
- **Notifications:** notification plugin for reminders (while the app runs; the server push via Web Push/APNs is still the source of truth). Actions: Complete and Snooze.
- **Auth:** the bearer token is stored in the macOS Keychain (keyring or stronghold plugin). Google sign-in opens the system browser and returns via the deep link `flolist://auth/callback` (deep-link plugin).
- **Deep links:** `flolist://lists/<id>` and `flolist://tasks/<id>`.
- **Native context menus** where the web ones feel off. Drag files in through the Tauri drag-drop events.
- **Release:** Developer ID signing and notarization (Q-5), the updater plugin with signed update manifests on GitHub Releases, and a macOS runner in CI.

## Android: Capacitor (M11)
- **Location:** `apps/mobile`, holding the Capacitor project with the bundled web assets. On launch the app checks the API version and prompts to update if it's incompatible.
- **Mobile UI** (already responsive):
  - the sidebar is the home screen; views open full screen; task details open as a full-screen sheet
  - a bottom **Quick Create "+"** (new task / new list) and an Updates icon at the bottom right
  - swipe a task right→left to open details or add subtasks; long-press for the context menu and multiselect
  - a keyboard toolbar with an "open details" arrow and a block-type switcher
- **Push:** FCM via `@capacitor/push-notifications` (Q-6), with actionable notifications (Complete, Snooze). Local reminders via `@capacitor/local-notifications`.
- **Share target:** text or a URL shared into Flolist creates an Inbox task (send-intent plugin).
- **Widgets:** native Kotlin/Glance widgets for Quick-create (choose a list, optional + button) and an interactive List content widget (Android 12+). They read from `/api/v1/widgets/list/:id`.
- Daily planning notification, haptics on completion, and the system back gesture tied to router history.
- **Release:** Play Console internal track, with signing keys kept outside the repo.

## iOS: Capacitor (M12)
- Same mobile UI as Android, plus APNs (via FCM), a share extension, and WidgetKit widgets: Quick Create, a List view in 3 sizes with interactive checking, and a lock-screen Quick Create.
- Sign in with Apple is required if Google sign-in is offered (check Apple's current guideline). Account deletion in-app already exists in Settings.

## Windows: Tauri 2 (M12)
- Same as macOS minus the macOS-only items: custom title bar, Ctrl-based shortcuts, tray, toast notifications, MSI/NSIS installer, auto-update.

## Parity checklist per platform
Quick capture · Reminders with actions · Offline edit + sync · Share-in · Widgets (mobile) · Deep links · Native menus/shortcuts (desktop) · Theme follows system.
