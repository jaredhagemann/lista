# Runbook: recovering a club whose owner has lost access

Decided under [BUG-013](../bugs/fixed/013-club-staffing-and-ownership-handover.md) (D7, 2026-09-24). Use this only
when a club's owner cannot sign in and so cannot transfer ownership themselves. An owner who **can** sign
in transfers ownership from club settings; the director they choose accepts it.

## Who can ask

A **current director** of the club. Ownership can only go to a director, and the requester is normally
the director who will take it over. A request from anyone else (a parent, a coach, the owner's family)
is refused. They can ask a director to make it.

If the club has no director, the owner must be recovered through normal account recovery (their email
provider, or Supabase auth support), not this runbook.

## What to verify before acting

All of these, recorded in the ticket or support thread:

1. **The requester is a current director.** Check that their email appears as `director` in the script's
   dry-run output (below).
2. **The requester knows the club's billing.** They must give one of the following. Check it in the
   Stripe dashboard against the club's customer (`organizations.stripe_customer_id`):
   - the last 4 digits of the card on file, or
   - a recent invoice number, or
   - for a club with no Stripe customer (free plan): the club's subdomain and the name of one team. Note
     that this is weaker evidence.
3. **The owner is really unreachable.** Record what the requester says happened (lost email, left the
   organization, deceased). Do not contact the owner through the requester.

There is **no waiting period**. The owner's address is emailed when the transfer is made, and the email
says how to object.

## Doing it

From `apps/web`, with an env file holding the **production** `NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY` and `RESEND_API_KEY`. Keep that file out of the repo and
delete it afterwards.

1. **Dry run.** This shows the club, its owner and directors, and changes nothing:

   ```
   pnpm exec tsx --env-file=<prod env file> scripts/recover-club-ownership.ts \
     --org <organization id> --to <director's email> --reason "<what was verified>"
   ```

2. Check the output: the club is the right one, and `--to` is listed as a director.
3. **Run it again with `--yes`.** Put what was verified in `--reason`, e.g.
   `"Owner lost access to email; director Dana confirmed card ending 4242 on 2026-09-30, ticket #123"`.
   The reason is stored with the transfer (`organization_ownership_transfers`, status `recovered`).

The script:

- makes the director the owner and the old owner a director, in one transaction
- cancels any pending ownership offer
- moves Stripe's billing email to the new owner. The card on file stays until the new owner replaces it.
- emails the old owner's address.

## Afterwards

- If the script says the **notice was not sent**, email the old owner's address yourself with the same
  message.
- If the script says **Stripe was not updated**, change the customer's email in the Stripe dashboard.
- Tell the new owner they are now responsible for billing, and point them to club settings to update the
  card.
- If the old owner objects: confirm who they are through their own account (they sign in, or
  re-establish their email), then undo it by running the script again with the old owner as `--to`. They
  are a director now, so that works.

## Reopening a closed club

A closed club can only be reopened by support. From a direct database session (Supabase SQL editor):

```sql
select reopen_club('<organization id>');
```

It refuses (`OWNER_REQUIRED`) if the club has no owner, for example because the owner deleted their
account after closing it. In that case recover ownership to a director first, as above; the script works
on a closed club. Then reopen it.

Reopening does not restore the club's subdomain or custom domain: closure quarantined the subdomain
(180 days) and removed the custom domain. Restoring them is a separate step, not covered here.
