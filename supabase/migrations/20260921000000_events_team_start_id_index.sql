-- BUG-014 / schedule-and-availability-pagination spec §10.
--
-- Every paginated event read is scoped to a team and ordered by
-- (start_time, id) — the unique ordering keyset pagination needs. Without an
-- index in that shape, each page is a scan of the team's history that Postgres
-- then sorts, which gets worse exactly as the history grows.
--
-- Checked first: no existing index covers (team_id, start_time, id). The events
-- table has only its primary key and foreign keys.
--
-- Deliberately a plain CREATE INDEX. CREATE INDEX CONCURRENTLY cannot run inside
-- a transaction, and migrations run in one; at this data size the brief write
-- lock is not worth splitting the migration for. Revisit if the table grows into
-- the millions.
--
-- Additive: an application rollback can leave this in place.

create index if not exists events_team_start_id_idx
  on public.events (team_id, start_time, id);

comment on index public.events_team_start_id_idx is
  'Supports keyset pagination of a team''s events ordered by (start_time, id). '
  'Used by the web schedule list, calendar and availability matrix, and by the '
  'mobile schedule feed (BUG-014).';
