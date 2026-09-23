-- ============================================================
-- Reconcile Stripe state instead of ordering Stripe events (BUG-015 review)
-- ============================================================
-- The first attempt at ordering protection stamped one `stripe_event_at`
-- watermark on the organization and refused any write from an older event. The
-- review showed that mechanism is wrong rather than incomplete:
--
--   * Stripe says `created` must not be used to decide order, and two distinct
--     events can share a second. A strict comparison silently dropped the
--     second one.
--   * One watermark for several independent fields meant a status-only write
--     from an invoice advanced the same clock, which then discarded an older
--     subscription event carrying a tier change the invoice never supplied.
--   * Terminal cancellation never participated at all, so a delayed paid
--     invoice could flip a cancelled club back to active.
--
-- Ordering events is the wrong problem to solve. The route now asks Stripe what
-- the subscription *currently* is whenever one of its events arrives, and
-- writes that — which is Stripe's own guidance. Whichever delivery lands last
-- writes the same present-tense truth, so the watermark has nothing left to do.

alter table organizations drop column if exists stripe_event_at;

-- An exclusive claim on an event, so two overlapping deliveries of the same one
-- cannot both run the handler and send the same email twice. The lease is what
-- keeps that safe: a handler that dies without completing leaves a claim that
-- goes stale, and the next delivery picks the work up rather than waiting for
-- someone who is never coming back.
alter table stripe_webhook_events add column if not exists claimed_at timestamptz;

comment on column stripe_webhook_events.claimed_at is
  'When a delivery took exclusive ownership of this event. Stale claims are reclaimable; see claimStripeEvent (BUG-015).';
