# BUG-016 — Avatar and team images break on a clean deployment

**Severity:** P2
**Status:** Open
**Reported:** 2026-09-04 by readiness review (finding 16)
**Area:** storage
**Evidence class:** Static — configuration mismatch; **no clean-deployment check run**
**Last verified:** `5acde1074`, code inspection, 2026-09-04

## Symptom

Avatar and team-image buckets are created **private** by the migrations, but the upload component stores
and renders `getPublicUrl()` URLs. On a deployment built from the checked-in migrations, those URLs are
not accessible, so uploaded images do not render.

## Reproduction

**Static.** Not yet run.

1. Deploy from a clean database using the checked-in migrations.
2. Upload a team logo or avatar, then view it.

**Expected:** the image renders.
**Actual:** the stored public URL is not accessible against a private bucket.

**The exact failure response is not established** — the recorded probe does not show a specific HTTP status.
Describe it as an inaccessible public URL pending a real clean-deployment check.

**No claim is made about production.** Whether production currently renders images, and whether its buckets
were modified out of band, was **not** established by the review.

## Evidence

- Private buckets: `supabase/migrations/20260303000000_storage_buckets.sql:1`
- Public URL generation: `apps/web/src/components/ui/image-upload.tsx:60`
- [Supabase storage access models](https://supabase.com/docs/guides/storage/buckets/fundamentals)

## Product decisions

**D8 resolved — user decision, 2026-09-15:** children's photos may be viewed by **teammates and clubmates**,
with no access outside the team/club. Shared with
[BUG-004](./004-profile-email-exposed-to-teammates.md).

**This settles the fix direction: the buckets stay private.**

A Supabase public URL is an unguessable but **unauthenticated** link — anyone holding it can open the image,
including someone who has left the club or never belonged to it, and it keeps working after the child leaves.
That is access outside the team/club, so `getPublicUrl()` is not a permitted serving path for avatars under
D8. Serve them through authorized downloads or signed URLs instead.

**Making the buckets public is now explicitly ruled out**, not merely discouraged — it was the tempting
one-line repair for the broken images, and it would contradict D8.

| Asset | Serving path |
| --- | --- |
| Child/player avatars | Authorized download or signed URL, scoped to team/club |
| Team images | Same as avatars unless the club logo exception below applies |
| Club logo | **Open** — see below |

**Open sub-question — is a club logo public?** D8 covers personal data; a club logo is org branding, and a
public club subdomain landing page would need it to load for signed-out visitors. Recommend treating the
club logo as public identity, separate from personal assets. Confirm before implementing.

## Cause

The migrations create private buckets while the app generates and stores public URLs. **The proven defect is
this configuration/URL mismatch** — not that a privacy model was never decided, which is a stronger claim
than the evidence supports.

## Proposed fix

Keep the buckets private and replace `getPublicUrl()` with an authorized serving path for personal assets,
so the migrations and the app agree. Decide the club logo separately.

Note that stored URLs already written into rows will need migrating, not just the upload path changing.

## Regression test

Assert upload-then-fetch round-trips against a database built from **migrations alone**, so the app and the
checked-in configuration cannot drift apart again.

Assert an avatar URL is **not** retrievable by an unauthenticated request or by a user outside the
team/club — the D8 boundary — and that a teammate can retrieve it.
