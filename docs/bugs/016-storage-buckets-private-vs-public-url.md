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

Tracked as **D8** in `docs/reviews/2026-09-15-bug-backlog-review.md`, shared with
[BUG-004](./004-profile-email-exposed-to-teammates.md):

| Question | Recommendation | Decision |
| --- | --- | --- |
| How are children's avatars served? | Through authorized access, not a public URL | **Open** |
| May a club logo be public? | Yes, if it is intended as the public club identity | **Open** |

Do **not** make all buckets public merely to repair broken images. That would resolve the mismatch by
discarding the privacy model rather than choosing one.

## Cause

The migrations create private buckets while the app generates and stores public URLs. **The proven defect is
this configuration/URL mismatch** — not that a privacy model was never decided, which is a stronger claim
than the evidence supports. D8 supplies the serving policy.

## Proposed fix

Choose a serving path per asset type under D8 and make the migrations and the app agree.

## Regression test

Assert upload-then-fetch round-trips against a database built from **migrations alone**, so the app and the
checked-in configuration cannot drift apart again.
