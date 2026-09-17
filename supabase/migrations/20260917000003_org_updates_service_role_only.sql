-- BUG-005: organization owners and directors could update ANY column of their
-- organization through the data API — plan, subscription_status, Stripe ids,
-- trial dates, team_limit, subdomain, custom_domain — bypassing Stripe, the
-- billing routes, and the settings route's owner-only and club-plan checks.
--
-- No application code updates organizations through a user session. Every
-- writer uses the service role after its own authorization: the billing routes,
-- the Stripe webhook, the trial-expiration and subdomain-quarantine crons, the
-- admin upgrade route, and PATCH /api/club/settings (which already separates
-- owner from director and gates subdomains on a club plan). So direct updates
-- are removed for every role rather than restricted column by column.
--
-- Reads are unchanged: "Orgs visible to members" still lets owners and directors
-- see billing state.

drop policy "Orgs updatable by org admins" on organizations;
