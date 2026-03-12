-- Add expo_push_token column for mobile push notifications (APNs via Expo)
-- Web-push rows: endpoint/p256dh/auth set, expo_push_token null
-- Mobile rows: expo_push_token set, endpoint/p256dh/auth null

-- Make web-push fields nullable to support mobile-only rows
alter table push_subscriptions
  alter column endpoint drop not null,
  alter column p256dh drop not null,
  alter column auth drop not null;

-- Add expo push token column
alter table push_subscriptions
  add column expo_push_token text;

-- Add check: each row must have either web-push fields OR an expo token (not neither)
alter table push_subscriptions
  add constraint push_subscriptions_has_token
  check (
    (endpoint is not null and p256dh is not null and auth is not null)
    or expo_push_token is not null
  );
