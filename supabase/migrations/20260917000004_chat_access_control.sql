-- BUG-003: chat access control.
--
-- Specs: docs/specs/archive/team-chat.md (groups are entirely private; members
-- are added by the group's creator or a team admin; no message editing in v1)
-- and docs/specs/multi-tenant-architecture.md (directors are not enrolled in
-- groups and cannot read them unless invited). Removal from a team revokes its
-- chat access, subject to another legitimate source of access
-- (docs/specs/archive/remove-team-member.md). Who may DM whom is deliberately
-- unchanged: the adult-to-child policy is deferred.
--
-- Defects closed:
--   1. channel_members INSERT accepted profile_id = auth.uid() for ANY channel,
--      so a teammate — or someone removed from the team — could join a private
--      group and read it. Admins could add themselves too, directors included.
--   2. channel_members UPDATE let a member re-point their read-marker row's
--      channel_id at a group.
--   3. messages UPDATE allowed any column change, so senders could rewrite a
--      message body or move it into another channel they can read.
--   4. Group messages checked group membership but not team membership, and DM
--      channels and messages checked only participation, so removal from a team
--      did not revoke group or DM access.
--   5. dm_channels UPDATE let a participant re-point the conversation at
--      someone else.
--
-- Channel and DM lookups inside policies now go through SECURITY DEFINER
-- helpers. Policy subqueries run under the caller's own RLS, which is also why
-- the specified "team admin adds a member" path never worked: an admin outside
-- a group could not see the group's row.

-- ── Helpers ───────────────────────────────────────────────────────────────────

-- Whether a profile belongs to a team directly or as the guardian of a player on it.
create or replace function profile_on_team(p_profile_id uuid, p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from team_members
    where team_id = p_team_id and profile_id = p_profile_id
  )
  or exists (
    select 1
    from profile_managers pm
    join team_members tm on tm.profile_id = pm.managed_id
    where pm.manager_id = p_profile_id
      and tm.team_id = p_team_id
  );
$$;

-- It takes arbitrary profile and team ids, so exposing it would let any user
-- probe team membership. Only can_add_channel_member calls it, and that runs
-- with its owner's rights, so client roles need no access.
revoke execute on function profile_on_team(uuid, uuid) from public, anon, authenticated;

-- Whether the caller may read and post in a team or group channel.
create or replace function can_access_channel(p_channel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from channels c
    where c.id = p_channel_id
      and is_team_member(c.team_id)
      and (c.type = 'team' or (c.type = 'group' and is_channel_member(c.id)))
  );
$$;

-- Whether the caller may read and post in a DM: a participant still on its team.
create or replace function can_access_dm(p_dm_channel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from dm_channels d
    where d.id = p_dm_channel_id
      and auth.uid() in (d.profile_a, d.profile_b)
      and is_team_member(d.team_id)
  );
$$;

-- Whether the caller may insert this channel_members row.
create or replace function can_add_channel_member(p_channel_id uuid, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from channels c
    where c.id = p_channel_id
      and is_team_member(c.team_id)
      and (
        -- Your own read marker on the team channel.
        (c.type = 'team' and p_profile_id = auth.uid())
        -- Your own row in a group you created, or already belong to. The app's
        -- read-marker upsert checks the INSERT policy even when the row exists.
        or (
          c.type = 'group'
          and p_profile_id = auth.uid()
          and (c.created_by = auth.uid() or is_channel_member(c.id))
        )
        -- Adding someone else to a group: its creator or a team admin, and only
        -- people on the team. No one — admin or director — admits themselves.
        or (
          c.type = 'group'
          and p_profile_id <> auth.uid()
          and (c.created_by = auth.uid() or is_team_admin(c.team_id))
          and profile_on_team(p_profile_id, c.team_id)
        )
      )
  );
$$;

-- ── channels ──────────────────────────────────────────────────────────────────

drop policy channels_select on channels;
create policy channels_select on channels for select using (
  is_team_member(team_id)
  and (
    type = 'team'
    or (type = 'group' and (is_channel_member(id) or created_by = auth.uid()))
  )
);

-- ── channel_members ───────────────────────────────────────────────────────────

drop policy channel_members_insert on channel_members;
create policy channel_members_insert on channel_members for insert with check (
  can_add_channel_member(channel_id, profile_id)
);

create or replace function protect_channel_member_identity()
returns trigger
language plpgsql
as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon')
     and (
       new.id is distinct from old.id
       or new.channel_id is distinct from old.channel_id
       or new.profile_id is distinct from old.profile_id
     )
  then
    raise exception 'CHANNEL_MEMBER_IDENTITY_LOCKED: channel_id and profile_id cannot be changed from a client session'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger channel_members_protect_identity
  before update on channel_members
  for each row execute function protect_channel_member_identity();

-- ── messages ──────────────────────────────────────────────────────────────────

drop policy messages_select on messages;
create policy messages_select on messages for select using (
  (channel_id is not null and can_access_channel(channel_id))
  or (dm_channel_id is not null and can_access_dm(dm_channel_id))
);

drop policy messages_insert on messages;
create policy messages_insert on messages for insert with check (
  sender_id = auth.uid()
  and (
    (channel_id is not null and can_access_channel(channel_id))
    or (dm_channel_id is not null and can_access_dm(dm_channel_id))
  )
);

-- The UPDATE policy (sender, or a team admin for channel messages) is kept for
-- soft-deletion. Everything else about a sent message is immutable.
create or replace function protect_message_content()
returns trigger
language plpgsql
as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon') then
    if new.id is distinct from old.id
       or new.channel_id is distinct from old.channel_id
       or new.dm_channel_id is distinct from old.dm_channel_id
       or new.sender_id is distinct from old.sender_id
       or new.body is distinct from old.body
       or new.created_at is distinct from old.created_at
    then
      raise exception 'MESSAGE_IMMUTABLE: messages cannot be edited, only deleted'
        using errcode = '42501';
    end if;
    if old.deleted_at is not null and new.deleted_at is distinct from old.deleted_at then
      raise exception 'MESSAGE_IMMUTABLE: a deleted message cannot be restored'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger messages_protect_content
  before update on messages
  for each row execute function protect_message_content();

-- ── dm_channels ───────────────────────────────────────────────────────────────

drop policy dm_channels_select on dm_channels;
create policy dm_channels_select on dm_channels for select using (
  (profile_a = auth.uid() or profile_b = auth.uid()) and is_team_member(team_id)
);

drop policy dm_channels_insert on dm_channels;
create policy dm_channels_insert on dm_channels for insert with check (
  (profile_a = auth.uid() or profile_b = auth.uid()) and is_team_member(team_id)
);

drop policy dm_channels_update on dm_channels;
create policy dm_channels_update on dm_channels for update
  using ((profile_a = auth.uid() or profile_b = auth.uid()) and is_team_member(team_id))
  with check ((profile_a = auth.uid() or profile_b = auth.uid()) and is_team_member(team_id));

create or replace function protect_dm_channel_identity()
returns trigger
language plpgsql
as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon')
     and (
       new.id is distinct from old.id
       or new.team_id is distinct from old.team_id
       or new.profile_a is distinct from old.profile_a
       or new.profile_b is distinct from old.profile_b
     )
  then
    raise exception 'DM_CHANNEL_IDENTITY_LOCKED: a conversation''s team and participants cannot be changed'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger dm_channels_protect_identity
  before update on dm_channels
  for each row execute function protect_dm_channel_identity();
