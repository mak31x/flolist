# UI design spec (based on the Superlist web app, observed Nov 2026, v1.59)

Goal: calm, airy, premium. Lots of whitespace, big bold page titles, soft rounded surfaces, pill-shaped controls, and a single warm accent colour. Flolist should feel the same at first glance while using its own wordmark.

## 1. App shell (desktop ≥ 1024px)
Three columns on a tinted canvas:
```
┌──────────┬───────────────────────────────┬────────────────────┐
│ Sidebar  │ Main card (page)              │ Right panel        │
│ ~260px   │ flexible, ~720–820px reading  │ ~400–440px         │
│ no card  │ rounded card, off-white       │ cover image OR     │
│          │                               │ task details card  │
└──────────┴───────────────────────────────┴────────────────────┘
```
- **Canvas** (behind the cards): a cool light grey-lavender (light theme ≈ `#E4E4EC`). The sidebar sits directly on a lighter off-white (`#FAFAFC`) with no card.
- **Main card:** ~12–16px radius, ~8px gap from the edges and from the other columns, background ≈ `#FAFAFC`. The page title sits at the top-left with generous padding (~48px left, ~56px top).
- **Right panel**, one of two modes:
  1. **Cover mode** (default on Inbox, Today, Updates and lists that have a cover): a full-height rounded card showing a photo (Superlist uses calm nature/abstract "dreamscapes"; a different image per view). Hovering shows two small icon buttons at the top-right: cover settings (gear) and collapse panel.
  2. **Task details mode:** replaces the cover when a task is opened (see §5).
  - Lists without a cover show no right panel, so the main card stretches. Week view also hides the panel and uses the full width.
- **Sidebar collapse** toggle (panel icon) and **search** (magnifier) sit at the sidebar's top-right.
- Mobile (< 768px): one column. The sidebar becomes the home screen or drawer, task details become a full-screen sheet, Quick Create is a bottom "+" FAB, and Updates sits in the bottom-right.
- Tablet (768–1023px): sidebar collapsible, no cover panel, details as an overlay sheet on the right.

## 2. Typography
- UI font: Inter (or a similar geometric grotesk). Body text 14px/20px; secondary text 12px; tiny meta text 11px.
- **Page titles:** ~40px, weight 700–800, tight letter-spacing (-0.02em), near-black (`#1F1F2E`). Today shows a secondary date beside the title in a lighter grey and smaller size ("Today **24 Nov**").
- **Task details title:** ~22px, weight 700.
- **Week column headers:** ~20px bold, day name dark and date number lighter ("Tue 24"); today's column is emphasised.
- Sidebar items: 13–14px, weight 500.

## 3. Colour and tokens (light theme defaults)
| Token | Approx. value | Use |
|---|---|---|
| `--canvas` | `#E4E4EC` | app background behind cards |
| `--surface` | `#FAFAFC` | main card, sidebar |
| `--surface-raised` | `#FFFFFF` / `#F0F0F5` | popovers, settings cards (`#EEEEF3`) |
| `--text` | `#1F1F2E` | primary text |
| `--text-muted` | `#6B6B80` | secondary text, placeholders |
| `--border` | `#E2E2EA` | dividers, input borders |
| `--accent` | coral red ≈ `#E5533D` | sidebar icons, active-item bar, today ring, destructive hover |
| `--accent-soft` | `#FBE7E3` | selected backgrounds |
| `--brand-violet` | ≈ `#6E5BD8` | upsell/"new" highlights (Flolist: use for info banners only) |
| `--success` | ≈ `#3E8E5E` | toggles on, "connected" text |
| `--chip` | `#ECECF2` | pill buttons and filter chips |
- **Active sidebar item:** a light grey row background plus a **3px accent bar on the right edge** of the sidebar.
- Sidebar nav icons are small (16px) line icons in the accent colour, each in a rounded-square glyph style.
- Shadows are minimal: popovers get a soft large blur shadow (`0 8px 32px rgba(20,20,40,.12)`) and a 12px radius.

## 4. Components
- **Pill button / chip:** height 28px, radius full, `--chip` background, 12–13px text. Used for "Share", "Due date ▾", "Creation date", "+ New task", "+ List" and "Sign out". Icon-only variants are 28px circles (filter, star, ⋮, arrows).
- **Segmented filter tabs:** a row of pills; the active one is filled darker grey and the rest are outlined or transparent. Examples: `Open | Completed`, `Tasks for me | Others | Upcoming | Done`, `All | Shared | Private`, `All | Tasks | Messages | Lists`.
- **Keyboard hint badge:** a small rounded grey box with the shortcut ("^N") shown right after "New task". Show it on desktop only.
- **New task row:** a circle-plus icon, then "New task", then the shortcut hint, placed at the top of task views.
- **Task row:** 32–36px tall.
  - Default: rounded-square checkbox (16px, 1.5px border, radius 4px) followed by the title.
  - Beneath the title, a meta line (11px, muted): list breadcrumb with a list icon (in cross-list views), due date, label chips, subtask progress "2/5", a message count, a source icon.
  - **On hover:** a drag handle (⋮⋮) appears at the far left, then a dark circular **block-type button** (for changing the block type or opening a menu), then the checkbox. On the right sit a small assignee avatar button and a dark circular **"open details" arrow button**.
  - **While editing the title:** an icon row under the title for quickly setting due date (calendar), priority (bars) and label (tag).
  - **Selected:** grey row background plus an accent bar at the right edge of the main card.
  - Completing a task: the checkbox fills with a check animation, an optional sound plays (Settings → Sounds), the title gets a strikethrough and muted colour, and the task stays in place unless "Hide completed" is on.
- **Empty states:** a hand-drawn line illustration (grey) with one helpful sentence. For empty task lists, show three faint "squiggle" skeleton rows: a checkbox plus a wavy line.
- **Banners/tips:** a rounded tinted (violet-grey) box with an icon, text, an open-arrow button and a close X (e.g. on All lists: "Easily access all your lists and mark important ones with a star…").
- **Toasts (snackbar):** bottom-left, dark, with an Undo action where relevant ("Task moved to 1 Dec · Undo").
- **Popover menus:** 12px radius, 6px padding, 30px rows with an icon and label, separators, and a destructive item in red ("Delete list").
- **Settings cards:** rounded 16px tinted cards, each with a bold title, a muted description and controls on the right (toggle, dropdown, pill button).
- **Toggles:** iOS-style; green when on.
- **Avatars:** circular, 20–24px; collaborator stacks overlap.

## 5. Task details panel (right panel, desktop)
Top to bottom:
1. Header row: close **X** (circle) on the left; on the right the collaborator avatar(s) and a **⋮** menu (Duplicate, Copy link, Copy as text/Markdown, Add to/Remove from Inbox, Move to…, Delete).
2. Large checkbox and **title** (editable inline).
3. **Property chips row** (wraps): `[emoji List name]` (click to move), `[📅 Due date]`, `[👤 Assignee]`, `[▮ Priority]`, `[🏷 Label]`. Empty chips show their placeholder label; set chips show the value ("Tomorrow 5:00 pm ↻").
4. **Body:** a block editor (same as lists) with the placeholder "Start typing, or type '/' to choose a different content type". It holds subtasks, text, images and attachments.
5. Divider.
6. **Activity log:** a centred date separator ("Tuesday 24 November") followed by small muted lines ("1:49 pm: Karan created this task", "… changed the due date to 1 Dec"). Messages are interleaved as chat bubbles with avatar, name and time.
7. **Composer**, pinned at the bottom: a pill input "Leave a message…" that supports @mentions and attachments (and voice later, maybe).
- URL updates to `/lists/:listId/tasks/:taskId`. Esc closes the panel. ⌘↩ opens it from a selected row.

## 6. Date picker popover (anchored to the Due date chip or the row icon)
- Quick picks: **Today**, **Tomorrow**, **Next week**, each with a calendar icon. When a date is set, a "No due date" item clears it.
- A month calendar with a month label and ‹ › arrows. Weekend columns have a shaded background, today is circled, and the selected date is filled with the accent. The week starts according to the user's setting.
- Rows below: **⏱ Time** (optional due time), **🔔 Remind me** (disabled until a time is set; then offers presets), **↻ Repeat**.
- Repeat submenu: Daily · Weekly *on Tuesday* · Every 2 weeks *on Tuesday* · Every weekday *Monday to Friday* · Monthly *on the 24th* · Yearly *on Nov 24* · **Repeat every…**, which expands an interval number, a unit dropdown (Day/Week/Month/Year) and weekday toggles **M T W T F S S** (for weeks), with **Clear** and **Done** buttons. The suffixes in italics are computed from the selected date and shown in muted text.

## 7. Motion
- 150–200ms ease-out for popovers and panel slides. Checkbox completion is a ~250ms spring.
- Drag and drop: the lifted row casts a shadow, a placeholder gap animates open, and dropping on a sidebar list highlights it.
- **Workspace filter** (avatar-menu toggles; the owner calls this out as a highlight): rows owned by a workspace that was just hidden collapse (height + opacity, ~220ms ease-in-out, 20ms stagger top-down), and newly shown rows expand the same way. The avatar button's stack cross-fades and re-orders with a slight scale (~180ms). The toggle thumb uses a spring, and empty states fade in. See collaboration.md §3.
- **Panel transitions:** opening task details cross-fades the cover image into the details card while sliding it 12px from the right (~200ms).
- **Sidebar list badge:** a workspace move updates the small team badge (top-left of the list) with a quick scale-pop.
- Respect `prefers-reduced-motion`: fall back to instant changes or plain fades.
- Implement every duration and curve as constants in `packages/ui/motion.ts` (Motion library for layout and collapse animations; D-011). Never inline magic numbers.

## 8. Cover images ("dreamscapes")
- Ship 6–10 built-in calm photos (royalty-free, e.g. Unsplash-licence images placed in `apps/web/public/covers/`, with credits in `docs/credits.md`). Each system view gets a default image; users can upload their own list cover (≤ 25 MB, resized server-side to ~1600px WebP).

## 9. Wordmark
- No logo. Show the text "Flolist" (display font, 18px, bold, accent colour) at the top of the sidebar on the login screen and in the mobile header only. Superlist itself shows no wordmark in the desktop sidebar; Flolist does the same.

## 10. Workspace indicators (observed)
- A list owned by a team shows the **team avatar badge (16px)** at the top-left of the main card, above the title. Personal lists show no badge.
- Once a list has collaborators, the **Share** pill shows an avatar stack before the word "Share".
- The **avatar button** (bottom of the sidebar) shows an overlapping stack of the enabled workspaces' avatars, with the first in front and the others as small badges.

## 11. Do / don't
- Do: keep chrome minimal, put actions in hover states and menus, and show shortcuts in tooltips (`Due date ^D`).
- Don't: use heavy borders, saturated backgrounds, or more than one accent colour on a screen; don't show upsell UI.
