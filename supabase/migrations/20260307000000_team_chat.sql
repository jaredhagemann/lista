-- ============================================================
-- Team Chat: channels, channel_members, dm_channels, messages
-- ============================================================

-- Group/team channels (DMs use dm_channels table instead)
create table channels (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  name text not null,
  type text not null check (type in ('team', 'group')),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);

-- Explicit membership for group channels; also used for read-tracking on team channels (lazy upsert)
create table channel_members (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  joined_at timestamptz default now(),
  last_read_at timestamptz default now(),
  unique (channel_id, profile_id)
);

-- 1:1 direct message channels, scoped to a team
-- canonical ordering: profile_a < profile_b (UUID string comparison)
create table dm_channels (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  profile_a uuid not null references profiles(id) on delete cascade,
  profile_b uuid not null references profiles(id) on delete cascade,
  last_read_a timestamptz default now(),
  last_read_b timestamptz default now(),
  created_at timestamptz default now(),
  unique (team_id, profile_a, profile_b),
  check (profile_a < profile_b)
);

-- Messages for both group/team channels and DMs
-- exactly one of channel_id or dm_channel_id must be non-null
create table messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid references channels(id) on delete cascade,
  dm_channel_id uuid references dm_channels(id) on delete cascade,
  sender_id uuid not null references profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz default now(),
  deleted_at timestamptz,
  check (
    (channel_id is not null and dm_channel_id is null) or
    (channel_id is null and dm_channel_id is not null)
  )
);

-- Index for efficient message queries per channel
create index messages_channel_id_created_at on messages (channel_id, created_at);
create index messages_dm_channel_id_created_at on messages (dm_channel_id, created_at);

-- ============================================================
-- notification_preferences additions
-- ============================================================

alter table notification_preferences
  add column chat_push_enabled boolean not null default true,
  add column chat_digest_enabled boolean not null default true;

-- ============================================================
-- Trigger: auto-create team channel when a team is created
-- ============================================================

create or replace function create_team_channel()
returns trigger language plpgsql security definer as $$
begin
  insert into channels (team_id, name, type)
  values (new.id, 'Team Chat', 'team');
  return new;
end;
$$;

create trigger on_team_created
  after insert on teams
  for each row execute function create_team_channel();

-- Backfill: create team channels for existing teams that don't have one
insert into channels (team_id, name, type)
select t.id, 'Team Chat', 'team'
from teams t
where not exists (
  select 1 from channels c where c.team_id = t.id and c.type = 'team'
);

-- ============================================================
-- Helper function
-- ============================================================

-- Returns true if the current auth user has an explicit channel_members row
-- (used for group channel access checks)
create or replace function is_channel_member(c_id uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from channel_members
    where channel_id = c_id and profile_id = auth.uid()
  );
$$;

-- ============================================================
-- RLS: channels
-- ============================================================

alter table channels enable row level security;

-- Team members (or managers of team members) can see team channels;
-- explicit group members can see group channels
create policy "channels_select"
  on channels for select
  using (
    (type = 'team' and is_team_member(team_id))
    or (type = 'group' and is_channel_member(id))
  );

-- Any team member can create group channels; team channels are created by trigger only
create policy "channels_insert"
  on channels for insert
  with check (
    type = 'group' and is_team_member(team_id)
  );

-- Creator or admin can delete a group channel
create policy "channels_delete"
  on channels for delete
  using (
    created_by = auth.uid() or is_team_admin(team_id)
  );

-- ============================================================
-- RLS: channel_members
-- ============================================================

alter table channel_members enable row level security;

create policy "channel_members_select"
  on channel_members for select
  using (
    profile_id = auth.uid()
    or is_team_admin((select team_id from channels where id = channel_id))
  );

-- Allow: channel creator, team admin, or self (for read-tracking upserts on team channels)
create policy "channel_members_insert"
  on channel_members for insert
  with check (
    profile_id = auth.uid()
    or auth.uid() = (select created_by from channels where id = channel_id)
    or is_team_admin((select team_id from channels where id = channel_id))
  );

create policy "channel_members_update"
  on channel_members for update
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- Self-removal or admin removal
create policy "channel_members_delete"
  on channel_members for delete
  using (
    profile_id = auth.uid()
    or is_team_admin((select team_id from channels where id = channel_id))
  );

-- ============================================================
-- RLS: dm_channels
-- ============================================================

alter table dm_channels enable row level security;

create policy "dm_channels_select"
  on dm_channels for select
  using (profile_a = auth.uid() or profile_b = auth.uid());

create policy "dm_channels_insert"
  on dm_channels for insert
  with check (profile_a = auth.uid() or profile_b = auth.uid());

-- Allow participants to update last_read_a / last_read_b
create policy "dm_channels_update"
  on dm_channels for update
  using (profile_a = auth.uid() or profile_b = auth.uid())
  with check (profile_a = auth.uid() or profile_b = auth.uid());

-- ============================================================
-- RLS: messages
-- ============================================================

alter table messages enable row level security;

create policy "messages_select"
  on messages for select
  using (
    (
      channel_id is not null
      and (
        (
          (select type from channels where id = channel_id) = 'team'
          and is_team_member((select team_id from channels where id = channel_id))
        )
        or (
          (select type from channels where id = channel_id) = 'group'
          and is_channel_member(channel_id)
        )
      )
    )
    or (
      dm_channel_id is not null
      and (
        auth.uid() = (select profile_a from dm_channels where id = dm_channel_id)
        or auth.uid() = (select profile_b from dm_channels where id = dm_channel_id)
      )
    )
  );

-- sender_id must be the auth user; access check mirrors SELECT
create policy "messages_insert"
  on messages for insert
  with check (
    sender_id = auth.uid()
    and (
      (
        channel_id is not null
        and (
          (
            (select type from channels where id = channel_id) = 'team'
            and is_team_member((select team_id from channels where id = channel_id))
          )
          or (
            (select type from channels where id = channel_id) = 'group'
            and is_channel_member(channel_id)
          )
        )
      )
      or (
        dm_channel_id is not null
        and (
          auth.uid() = (select profile_a from dm_channels where id = dm_channel_id)
          or auth.uid() = (select profile_b from dm_channels where id = dm_channel_id)
        )
      )
    )
  );

-- Soft delete only: sender can delete own; admin can delete any in their team's channels
create policy "messages_update"
  on messages for update
  using (
    sender_id = auth.uid()
    or (
      channel_id is not null
      and is_team_admin((select team_id from channels where id = channel_id))
    )
  )
  with check (
    sender_id = auth.uid()
    or (
      channel_id is not null
      and is_team_admin((select team_id from channels where id = channel_id))
    )
  );
