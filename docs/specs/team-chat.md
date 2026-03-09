# Team Chat / Messaging

## Overview

A real-time messaging system built on Supabase Realtime. The primary surface is a per-team channel visible to all team members. Users can also message each other directly (1:1 DMs) and create named sub-groups (e.g. "Coaches", "Goalies"). Chat is the main driver of daily active usage between events.

## Cross-Platform Requirement

Chat must work seamlessly across the web app and the planned iOS and Android native apps (see Mobile App Strategy in the roadmap). This is a hard requirement — architectural decisions should be made with all three surfaces in mind from the start.

Implications:
- **Data layer**: `@supabase/supabase-js` works identically in React Native/Expo, so the same database schema, RLS policies, and Realtime subscriptions will work across all clients without modification.
- **Real-time**: Supabase Realtime channels work in React Native — no platform-specific transport needed.
- **Push notifications**: Mobile apps will rely on APNs (iOS) and FCM (Android) rather than the existing web-push (VAPID) system. The notification dispatch layer needs to support both. This likely means a separate `device_tokens` table for mobile and a server-side fan-out that handles both web-push and mobile push from a single trigger point.
- **Shared types**: The `Database` types from `src/types/database.ts` should live in a shared package (aligned with the Turborepo plan) so the mobile app consumes the same type definitions without duplication.
- **Offline / background behaviour**: Mobile users expect chat to work reliably when backgrounded. Message delivery confirmation and unread badge counts must survive app restarts — `last_read_at` in `channel_members` serves this role since it's server-side state, not local.
- **No web-only APIs**: Avoid any chat implementation details that only work in a browser (e.g. `localStorage`, `BroadcastChannel`, `ServiceWorker`-only patterns). All state should be server-authoritative.

---

## Scope

### In scope
- Team channel: one auto-created channel per team, visible to all members
- Direct messages: 1:1 conversations between any two team members
- Group threads: user-created sub-groups with a name and a chosen set of members
- Real-time delivery via Supabase Realtime
- Unread indicators (badge counts on nav and per-channel)
- Basic message actions: send, delete own message, admin can delete any message
- Managed profiles: messages sent on behalf of a managed profile go to the managing account's inbox

### Out of scope (for v1)
- Reactions / emoji responses
- File / image attachments
- Message editing (edit history)
- Threads / replies within a message
- Read receipts per-member
- Per-message email notifications (replaced by daily digest — see Q6)
- Search within messages

---

## Data Model

### `channels` table
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `team_id` | `uuid` FK → teams | Required |
| `name` | `text` | e.g. "Team Chat", "Coaches", "Goalies" |
| `type` | `text` | `'team'` \| `'dm'` \| `'group'` |
| `created_by` | `uuid` FK → profiles | Null for auto-created team channel |
| `created_at` | `timestamptz` | |

- The team channel (`type = 'team'`) is created automatically via a Postgres trigger on `teams INSERT` (decided: Q1).
- DM channels are **not** stored in `channels`. They use a separate `dm_channels` table (decided: Q2 — Option C). See below.

### `channel_members` table
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `channel_id` | `uuid` FK → channels | |
| `profile_id` | `uuid` FK → profiles | |
| `joined_at` | `timestamptz` | |
| `last_read_at` | `timestamptz` | Used to compute unread count |

- Team channel membership is derived from `team_members` (everyone on the team is implicitly a member) rather than stored explicitly. Access is revoked immediately when a member is removed (decided: Q3). New members see full history (decided: Q4).
- DM channels use `dm_channels` table instead (see below).
- Group channels have explicit rows here.

### `dm_channels` table
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `team_id` | `uuid` FK → teams | DMs are team-scoped (decided: Q5) |
| `profile_a` | `uuid` FK → profiles | Always the lesser UUID (`profile_a < profile_b`) |
| `profile_b` | `uuid` FK → profiles | Always the greater UUID |
| `created_at` | `timestamptz` | |

- Unique constraint on `(team_id, profile_a, profile_b)`.
- Check constraint: `profile_a < profile_b` — enforces canonical ordering so there is only ever one row per pair per team. Application always sorts the two profile IDs before querying/inserting, then uses `ON CONFLICT DO NOTHING` and fetches the existing row.
- Messages for DMs reference `dm_channels.id` via a `dm_channel_id` column on `messages` (instead of `channel_id`). **OR** `dm_channels` rows could be given a corresponding `channels` row joined via FK — to be decided at implementation time. Simpler to add a nullable `dm_channel_id` to `messages` alongside `channel_id`.

### `messages` table
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `channel_id` | `uuid` FK → channels | |
| `sender_id` | `uuid` FK → profiles | The profile (own or managed) sending the message |
| `body` | `text` | |
| `created_at` | `timestamptz` | |
| `deleted_at` | `timestamptz` | Soft delete — render as "Message deleted" |
| `dm_channel_id` | `uuid` FK → dm_channels | Nullable — set for DMs, null for group/team channels |

- `channel_id` and `dm_channel_id` are mutually exclusive — exactly one must be non-null.
- Max message length: 4000 characters (enforced via DB check constraint — decided: Q8).

---

## RLS Policies

### channels
- **SELECT**: member of the channel's team, OR explicit `channel_members` row exists for current profile
- **INSERT**: any team member can create a group channel; DMs auto-created on send
- **DELETE**: `created_by = auth.uid()` or team admin

### channel_members
- **SELECT**: profile_id = auth.uid() OR team admin
- **INSERT**: channel creator or team admin
- **DELETE**: self-removal or team admin

### messages
- **SELECT**: user is a member of the channel (team member for team channel; `channel_members` row for DM/group)
- **INSERT**: same membership check; `sender_id` must be auth.uid() or a managed profile of auth.uid()
- **UPDATE**: not allowed (no editing in v1)
- **DELETE**: `sender_id = auth.uid()` or team admin (soft delete via `deleted_at`)

---

## UI

### Navigation
- "Chat" added to the dashboard sidebar nav
- Badge showing total unread count across all channels

### Chat page layout (`/dashboard/chat`)
- Left panel: channel list
  - "Team Chat" pinned at top
  - "Direct Messages" section below, listing existing DM conversations
  - "Groups" section below that
  - "New Message" / "New Group" buttons at the bottom of each section
- Right panel: message thread for the selected channel
  - Scrollable message list, newest at bottom
  - Sender avatar + name + timestamp on each message
  - Own messages right-aligned, others left-aligned
  - Soft-deleted messages rendered as "Message deleted" in muted text
  - Text input + send button at the bottom
  - Admin "Delete" option accessible via `...` menu on any message; own messages also get Delete

### New DM flow
1. Click "New Message"
2. Search/select a team member by name
3. Opens (or navigates to existing) DM channel

### New Group flow
1. Click "New Group"
2. Enter a group name
3. Search/select members to add
4. Creates channel + member rows, navigates to new channel

### Mobile layout
- Single-panel: channel list view → tap to open thread → back navigates to list

---

## Notifications

### Push notifications
- Sent per message to channel members (decided: Q6).
- Uses APNs (iOS) and FCM (Android) for mobile; existing web-push (VAPID) for web.
- Requires a `device_tokens` table for mobile device registration (separate from `push_subscriptions`).
- Controlled by a new `chat_push_enabled` column on `notification_preferences` (separate from `push_enabled` which is for events).

### Daily digest email
- If a user has any unread chat messages at digest time, send a summary email listing the channels with unread counts.
- Runs via the existing cron infrastructure (`/api/cron/` pattern), daily — timing TBD (likely same 12:00 UTC slot or a separate job).
- Controlled by a new `chat_digest_enabled` column on `notification_preferences`.
- No per-message email is sent.

### `notification_preferences` schema additions
```sql
alter table notification_preferences
  add column chat_push_enabled boolean not null default true,
  add column chat_digest_enabled boolean not null default true;
```

---

## Real-time

Supabase Realtime `postgres_changes` subscription on the `messages` table, filtered by `channel_id`. On INSERT, append message to the active thread. On UPDATE (soft delete), update in place.

Unread counts: on mount and on channel switch, update `channel_members.last_read_at` for the viewed channel. Unread count = messages where `created_at > last_read_at` for that channel.

---

## Managed Profile Handling

When a user is viewing as a managed profile (e.g. a parent viewing as their child), messages they send have `sender_id = auth_user_profile_id` — the parent's own profile, not the managed profile's. The parent appears in the chat as themselves. In the channel list, the managed profile's team channels are shown (since the parent is browsing in that context), but the sender identity on any message they post is always their own account.

---

## Open Questions

1. **Team channel auto-creation**: Should the team channel be created by a DB trigger on `teams INSERT`, or lazily on first visit to the chat page? Trigger is cleaner but adds migration complexity; lazy creation is simpler but requires a guard on every page load.
  - Let's go with the trigger on `teams Insert`

2. **DM uniqueness**: How do we prevent duplicate DM channels between the same two people? Options: (a) enforce at the application layer by querying before creating, (b) a unique index on a sorted pair stored in a `channel_members`-style join, or (c) a separate `dm_channels` table with `(profile_a, profile_b)` unique constraint. Which approach?
 - Let's go with option C

3. **Team channel membership sync**: If a member is removed from a team, should they lose access to the team channel immediately (RLS handles this automatically if we derive from `team_members`) or should their message history be preserved and access revoked? Current plan (derive from `team_members`) means access is cut off immediately — is that the right behaviour?
 - Yes, access should be cut off immediately

4. **Message history for new members**: When someone joins a team mid-season, should they see the full team channel history from before they joined, or only messages from their join date onward?
 - Full team channel history should be visible

5. **DMs across teams**: If a coach is on multiple teams and wants to DM a parent who is only on one of those teams — does the DM live under a team context, or is it team-agnostic? Current model ties channels to a `team_id`, which would prevent cross-team DMs.
 - All DMs are tied to a team. If two people share multiple teams they may have separate DM channels per team — that is acceptable.

6. **Notifications**: Should new chat messages trigger push notifications and/or emails? The existing notification preference system (`email_enabled`, `push_enabled`) is event-focused — do we add a `chat_enabled` flag, or keep chat notifications separate?
 - Push notifications only for real-time delivery (opt-out per device on mobile). No per-message emails. Instead, a daily digest email if the user has any unread chat messages that day — also opt-out. Both preferences should be separate from the existing event notification preferences and from each other. The `notification_preferences` table will need `chat_push_enabled` and `chat_digest_enabled` columns. The daily digest is handled by the existing cron infrastructure (`/api/cron/reminders` pattern).

7. **Group channel visibility**: Can non-admin members see the names/existence of groups they're not in? Or are groups entirely private to their members?
 - Groups are entirely private to their members

8. **Character/message limits**: Should there be a max message length enforced at the DB or API level?
 - Yes, but we can make this limit fairly large. Really just to prevent security issues of massive messages impact DDB size/performance

9. **Viewing As in chat**: When a parent is viewing as their child, they see the child's team channel and can send as the child. Should there be a visible indicator in the chat UI that messages are being sent as the managed profile?
 - **Decided: Option A (auth-user sender).** `sender_id` always = the auth user's own profile ID. A parent viewing as their child posts to the team channel as themselves ("Jane Smith"), not as the child ("Alex Smith"). This is intentional — parents and coaches on the same team know each other by name, so the parent's name is the most intuitive attribution.
 - RLS must be extended: access to a team channel is granted if the auth user is a `team_member` OR manages a `team_member` on that team.
 - No special "sending as" indicator is needed in the UI — the parent is the true author of the message.
