# Workspaces, teams, sharing and communication

Source: Superlist web app, tested hands-on on 24 Nov 2026 (creating, sharing, moving and hiding team lists). Member-side rules marked **[decided]** are Flolist decisions made without observing Superlist (owner approved deciding these ourselves). See D-016.

## 1. Concepts
- **Workspace** = the owner of lists. There are two kinds:
  - **Personal**: exactly one per user, created at sign-up, can't be deleted.
  - **Team**: a name plus an avatar (emoji or image), with members. A user can belong to any number of teams.
- **List ownership:** every list belongs to exactly one workspace. Sublists always belong to their root list's workspace.
- **Visibility ≠ ownership.** A list is visible only to its **creator** and its **collaborators**. A collaborator can be an individual user or a whole team (all of its current members).
  - Team-owned lists are **private until shared**. Superlist's team-page empty state says "Lists are always private until you share them".
  - **[decided]** Even the team owner can't see a member's private team list.

## 2. Teams
- **Create:** avatar menu → "+ New team" (or Settings → Workspaces → New team). The dialog asks for a name and avatar (emoji picker or upload). The creator becomes the **owner**.
- **Team page** `/team/:teamId`, opened from the **›** chevron that appears when hovering a team row in the avatar menu, or from the list menu item "Go to <team> ↗":
  - Header: team avatar + big name title. Header pills: ⋮ (owner: Rename/Change avatar, Delete team; member: Leave team). *(Superlist's "Upgrade" pill is excluded.)*
  - Tabs: a search icon, then **Lists (n)** · **Tasks (n)** · **Members (n)**.
    - **Lists:** team-owned lists that *I can see*, each with emoji, title, a Private/Shared label and a ★ toggle. The header has a "+ New list" pill. The empty state shows an illustration and "This is the place for your Team's lists. Lists are always private until you share them." with a "+ New list" button.
    - **Tasks:** open tasks from team lists I can see (same rows as All tasks). Empty state: "Tasks from your Team's lists will appear here".
    - **Members:** a "+ Invite members" row, then members with avatar, name, email and role (Owner / Member). Owner-only hover action: Remove.
- **Roles [decided]:**
  | Capability | Owner | Member |
  |---|---|---|
  | Rename team, change avatar, delete team | ✓ | – |
  | Invite members | ✓ | ✓ |
  | Remove other members | ✓ | – |
  | Transfer ownership | ✓ | – |
  | Leave team | ✓ (after transferring ownership, or if they're the last member) | ✓ |
  | Create team-owned lists | ✓ | ✓ |
  | See team-owned lists | only those shared with them (like everyone) | same |
  | Move or delete a team-owned list | creator; owner too if the list is shared with the team | creator only |
- **Invites [decided]:** invite by email. A registered user gets an in-app invitation (Updates + a badge on the avatar) plus an email. An unregistered email gets a sign-up link that joins the team after registration. Invitations can be Accepted or Declined, expire after 14 days, and can be revoked from Members ("Pending" label).
- **Member leaves or is removed [decided]:**
  - Lists they **created and never shared** move to that user's Personal workspace, so private data stays with its creator.
  - Lists they created that are **shared** stay in the team, and the creator role transfers to the team owner.
  - They lose access to anything they could see only through the team. Their tasks assigned in team lists become unassigned, and the activity log records it.
- **Delete team (owner) [decided]:** a confirm dialog where the team name must be typed. All team-owned lists go to the owner's Trash as one trash root. Members get an Updates entry, and any list they could see is removed from their client (`access_changed` event).
- **Member experience when a list is shared with their team [decided]:** each member gets an Updates entry ("Karan shared 'Q1 plan' with TPT"). The list appears in All lists → Shared and on the team page, but is **not** auto-starred into their sidebar (they can star it). The creator's own new lists are auto-starred (observed).

## 3. Workspace filter (avatar menu toggles)
- The avatar menu lists **Personal**, then each team (avatar + name), each with an iOS-style toggle (green when on), then "+ New team", then the rest of the menu.
- Each toggle is a **per-user, per-device-synced view filter** that hides everything **owned by** that workspace from: the sidebar Favorites/sections, All lists, the team's Tasks, Inbox, Today, Week, All tasks and Search.
  - It filters by **owner workspace only**. A list owned by LL but shared with TPT is hidden when LL is off, even if TPT is on (observed).
  - **[decided]** Updates still shows everything, so assignments and mentions are never missed. Items from hidden workspaces get a small "hidden workspace" chip.
- **At least one workspace stays visible.** Turning off the last enabled one switches back to "Personal only" (observed).
- **The avatar button reflects the filter:** it shows the avatars of the enabled workspaces as an overlapping stack, with the first one in front and the others as small badges. With only Personal enabled it shows the user's photo (observed).
- **Opening a hidden list** by link or URL shows a centred state: a warning icon, "This list is hidden", "Toggle <Workspace> on to see list content", plus a [Show <Workspace>] button (Flolist addition).
- **Animation** (the owner calls it out as a highlight; the exact curves weren't observable): rows of hidden lists collapse (height + opacity, ~220ms, 20ms stagger) and shown rows expand the same way. The avatar stack cross-fades and re-orders with a slight scale (~180ms). The toggle thumb uses a spring. Empty states fade in. See ui-design.md §7. `[assumption]`: tune it against a screen recording from the owner if one is provided.

## 4. Sharing a list (Share popover)
Open it from the "Share" pill in the list header. Once a list has collaborators, the pill shows their avatar stack.
1. **Header row:**
   - Left: the **workspace selector** pill (`[avatar] TPT ▾`). Its dropdown lists Personal and each team; choosing one **moves the list instantly** (no confirmation) and updates the badge at the top-left of the list. Allowed for the creator, or the team owner for team-shared lists. Existing collaborators, including other teams, are kept (observed).
   - Right (team-owned lists only): the **"Shared with the team"** toggle. Turning it on adds the owning team as a collaborator, and a toast says "'<list>' has been shared with <team>". Turning it off removes the team.
2. **Invite field:** "Invite collaborators by name or email". Suggestions include past collaborators, **teams** ("TPT · 1 members") and email matches. An unregistered email offers "Invite to Flolist" (an email with a sign-up link that joins the list on registration).
3. **People list:** the creator row ("Creator"), then a "Collaborators" section with users and teams (name, "n members" for teams, hover action **Remove**).
4. **Footer:**
   - **Link access** dropdown, each option with an icon, title and one-line description:
     - *Anyone with the link can edit*: "Everyone with this link can edit the list and will be added as a collaborator."
     - *Anyone with the link can view the list*: "Everyone with this link can view the list, but they won't be able to edit it."
     - *Only collaborators have access*: "Only people explicitly added as collaborators can open the list."
   - **Copy link** pill and a share icon (native share sheet on macOS and mobile).
   - **[decided]** The default for new lists is *Only collaborators have access*. Superlist defaulted to "can edit", but private-by-default is safer for company use.
- Personal lists can be shared with individuals **and** with teams (via the invite field). There is no "Shared with the team" toggle because there's no owning team.
- **Collaborator permissions (Superlist parity):** view, add, edit and remove content; change title, emoji and cover; add and remove collaborators. Collaborators **cannot** remove the creator, delete the list, or move it to another workspace. View-only link users can open and comment **[decided: they can post messages, but can't edit]**.
- **Invitation flow for individuals:** the invitee sees a dot badge on All lists and the invitation at the top of the Lists page (title, creator, who added them) with Accept / Decline, plus an Updates entry. Team shares need no acceptance (members simply gain access).
- **Leave shared list:** from the ⋮ beside Share, or by right-clicking the list in the sidebar or Lists page. This isn't possible when access comes only through a team; the menu then says "Shared via <team>".
- **List member limit** is configurable (default 25; a team counts as its members).

## 5. Assigning and task-level access
- A task has one assignee (tasks.md). Assigning a user who can't see the list creates a `task_access` grant: they see that task (its body and messages) in their Inbox, but not the list.
- @mentioning someone in a message grants the same task-level access.
- **[decided]** Assignee suggestions are list collaborators first, then members of the owning team, then recent collaborators. People hidden in Settings → Collaborators are excluded.

## 6. Messages (task discussion)
- The thread sits at the bottom of task details and supports text, @mentions (anyone with access), links, emoji and file attachments (≤25 MB). Authors can edit or delete their own messages ("edited" label).
- Followers are the creator, the assignee, participants and mentioned people (minus the author). They get notifications.
- **Updates → Messages tab** lists recent messages on tasks I created, am assigned to, or was mentioned in.
- Voice messages and reactions are in the backlog.

## 7. Notifications
| Event | Updates | Push | Email |
|---|---|---|---|
| Reminder | ✓ | ✓ (+ local) | – |
| Task assigned to me | ✓ quick reply "On it" | ✓ | optional |
| Task I created or am assigned to completed by someone else | ✓ quick reply "Good job" | – | – |
| New message on a followed task | ✓ | ✓ | optional |
| @mention | ✓ | ✓ | optional |
| List shared with me / with my team | ✓ | ✓ | ✓ if not registered |
| Team invitation / removed from team / team deleted | ✓ | ✓ | ✓ invitation only |
| Activity summary (weekly or monthly) | – | – | ✓ if enabled |
- Quick replies post a message on the task. Settings → Notifications controls the push categories, the activity summary and the daily planning reminder. The summary content is rule-based (created and completed counts plus 3 suggested tasks: overdue first, then due soon).

## 8. Realtime expectations
- Others' changes appear within ~1s (WS poke → pull).
- Optional presence: an avatar stack in the list header shows who is viewing (M7.3 stretch).
- If two people edit the same text block, the last write wins (D-006), and the changed block flashes subtly.
