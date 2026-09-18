-- BUG-007: push notifications could not reach the people they were meant for.
--
-- The routes resolved recipients and preferences through the *caller's* client,
-- and push_subscriptions RLS only ever shows you your own rows — so a sender's
-- client could see the sender's tokens and nobody else's. BUG-006 moved event
-- notices to a service-role worker; this brings chat onto the same path, so chat
-- gets real recipients, per-delivery records and retries too.
--
-- Decision D2 (docs/reviews/2026-09-15-bug-backlog-review.md): each receiving
-- adult controls their own preferences, superseding the archived rule where a
-- managed child's row spoke for everyone who manages them. The migration below
-- carries the old settings across conservatively: if the adult's own row *or*
-- any child they manage had a category switched off, it starts off for them.

-- ── 1. Jobs can carry a chat message, addressed to named people ──────────────

alter table notification_jobs
  add column kind text not null default 'event' check (kind in ('event', 'chat')),
  -- Null means "everyone on the team", which is what an event notice wants.
  add column recipient_profile_ids uuid[];

alter table notification_jobs drop constraint notification_jobs_action_check;
alter table notification_jobs
  add constraint notification_jobs_action_check
  check (action in ('created', 'updated', 'cancelled', 'restored', 'deleted', 'message'));

comment on column notification_jobs.recipient_profile_ids is
  'Members this notice is addressed to (chat). Null means the whole team. These are member profiles; '
  'the worker expands managed players to their guardians (BUG-007).';

-- ── 2. D2: each adult keeps their own settings ──────────────────────────────

-- An adult whose own row, or any managed child's row, had a category off starts
-- with that category off. Deliberately conservative: it can silence a category
-- for a second child whose own setting was on — accepted by the user, 2026-09-15.
insert into notification_preferences (
  profile_id, email_enabled, push_enabled, chat_push_enabled, chat_digest_enabled
)
select
  mgr.id,
  bool_and(coalesce(np.email_enabled, true)),
  bool_and(coalesce(np.push_enabled, true)),
  bool_and(coalesce(np.chat_push_enabled, true)),
  bool_and(coalesce(np.chat_digest_enabled, true))
from profiles mgr
join profile_managers pm
  on pm.manager_id = mgr.id
 and pm.managed_id <> pm.manager_id
join notification_preferences np
  on np.profile_id = pm.managed_id
where mgr.auth_user_id is not null
group by mgr.id
-- Only where a child actually had something switched off.
having not (
  bool_and(coalesce(np.email_enabled, true))
  and bool_and(coalesce(np.push_enabled, true))
  and bool_and(coalesce(np.chat_push_enabled, true))
  and bool_and(coalesce(np.chat_digest_enabled, true))
)
on conflict (profile_id) do update
  set email_enabled = notification_preferences.email_enabled and excluded.email_enabled,
      push_enabled = notification_preferences.push_enabled and excluded.push_enabled,
      chat_push_enabled = notification_preferences.chat_push_enabled and excluded.chat_push_enabled,
      chat_digest_enabled = notification_preferences.chat_digest_enabled and excluded.chat_digest_enabled;

-- ── 3. One row per device, not per person ───────────────────────────────────

-- Registering a device deleted every other Expo token the person had, so a
-- second device silently switched off the first (BUG-007, gap 4). Registration
-- now upserts on the token itself, which needs it to be unique. Web-push rows
-- leave it null, and null never conflicts.
delete from push_subscriptions a
using push_subscriptions b
where a.expo_push_token is not null
  and a.expo_push_token = b.expo_push_token
  and a.ctid > b.ctid;

create unique index push_subscriptions_expo_push_token_key
  on push_subscriptions (expo_push_token);
