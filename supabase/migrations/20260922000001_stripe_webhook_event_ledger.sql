-- ============================================================
-- Stripe webhook delivery ledger and ordering guard (BUG-015)
-- ============================================================
-- The webhook awaited every write, discarded the returned error, and answered
-- `{ received: true }`. Stripe records a successful delivery and stops
-- retrying, so a failed write became permanent: the club's plan stayed stale
-- with nothing left to correct it.
--
-- Checking the errors is most of the fix, but it is not sufficient on its own.
-- Once the route starts returning 500 so Stripe retries, it will be delivered
-- the same event more than once — and Stripe already replays events and does
-- not guarantee order. Two things are needed alongside:
--
--   * a ledger, so a replayed event is recognised and its side effects (the
--     billing emails) do not fire twice
--   * an ordering guard, so a late-arriving older event cannot resurrect a
--     state the club has already moved on from
--
-- The ledger records completion separately from receipt. An attempt that fails
-- half way leaves `completed_at` null, and the retry processes it again — which
-- is the whole point. Only a completed event is skipped.

create table stripe_webhook_events (
  event_id         text primary key,
  event_type       text not null,
  -- Stripe's own timestamp for the event, not ours: it is what orders two
  -- deliveries that arrive the wrong way round.
  event_created_at timestamptz not null,
  received_at      timestamptz not null default now(),
  -- Null until the handler has finished. A retry of an unfinished event is
  -- meant to run again.
  completed_at     timestamptz
);

-- For pruning old rows; nothing reads this table by time otherwise.
create index stripe_webhook_events_received_idx on stripe_webhook_events (received_at);

-- Nobody but the webhook's service role has any business here: it records
-- Stripe's delivery history, not anything a club member reads. RLS on with no
-- policies denies every client role; the service role bypasses it.
alter table stripe_webhook_events enable row level security;

comment on table stripe_webhook_events is
  'Stripe delivery ledger (BUG-015). Deduplicates replayed events and records which finished.';

-- When the organization's billing state was last set, by Stripe's clock. The
-- webhook only applies a state change when its event is newer than this, so an
-- out-of-order delivery is ignored rather than applied.
alter table organizations add column if not exists stripe_event_at timestamptz;

comment on column organizations.stripe_event_at is
  'Stripe event timestamp behind the current billing state (BUG-015). Guards against out-of-order webhook delivery.';
