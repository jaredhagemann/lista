# BUG-016 — Avatar and team images break on a clean deployment

**Severity:** P2
**Status:** Open
**Reported:** 2026-09-04 by readiness review (finding 16)
**Area:** storage

## Symptom

Avatar and team-image buckets are created **private** by the migrations, but the upload component stores
and renders `getPublicUrl()` URLs. On any deployment built from the checked-in migrations, uploaded images
render broken unless bucket configuration was changed out of band.

## Reproduction

**Code-confirmed configuration mismatch.**

1. Deploy from a clean database using the checked-in migrations.
2. Upload a team logo or avatar, then view it.

**Expected:** the image renders.
**Actual:** the stored public URL 400s against a private bucket.

**Environment:** production currently renders images, which implies its buckets were changed out of band —
**unconfirmed**, see "Questions".

## Evidence

- Private buckets: `supabase/migrations/20260303000000_storage_buckets.sql:1`
- Public URL generation: `apps/web/src/components/ui/image-upload.tsx:60`
- [Supabase storage access models](https://supabase.com/docs/guides/storage/buckets/fundamentals)

## Cause

The privacy model was never decided per asset type. Private buckets need authenticated downloads or signed
URLs; making everything public would change the privacy model — particularly for children's photos.

## Fix

Choose an explicit privacy model for each asset type and implement its serving path. Verify upload and
download after a clean database deployment so the migrations and the app agree.

**Open product decision:** whether children's photos may be served from public URLs. See "Questions".

## Regression test

Assert upload-then-fetch round-trips against a database built from migrations alone.
