# Bulk Player / Family Invite

## Overview

Let coaches and club directors onboard an entire roster in one action via CSV upload rather than one invite at a time. The flow is: upload CSV → preview and validate → confirm → batch send → track status.

This feature extends the existing single-invite system (`/api/invitations/send`, `invitations` table) rather than replacing it.

---

## Access Control

Bulk invite is available to coaches, managers, and club directors. It is always scoped to a single team (the user's currently active team). Club directors access it the same way — by selecting the relevant team as their active team first.

Server-side auth check: `is_team_admin(team_id)` (the same guard used for single invites).

---

## CSV Format

Required columns (case-insensitive header matching):

| Column | Required | Notes |
|---|---|---|
| `first_name` | Yes | |
| `last_name` | Yes | |
| `email` | Yes | Must be a valid email address |
| `role` | Yes | `player`, `manager`, or `coach` |

Optional columns:

| Column | Notes |
|---|---|
| `birthday` | ISO 8601 (`YYYY-MM-DD`). Applied to player profile on acceptance. |
| `gender` | Applied to player profile on acceptance. |

`parent` and `director` roles are not supported in bulk invite. Parent invites involve a managed-profile relationship that requires the deliberate single-invite flow. Director is an org-level role outside the team roster context.

Maximum rows per upload: **100**.

---

## Flow

### 1. Upload

User navigates to the team Members page and clicks "Bulk invite." A file picker accepts `.csv` files only. Parsing happens client-side (no upload to server yet).

### 2. Preview & Validation

Before any invites are sent the user sees a preview table with one row per CSV entry. Each row is validated client-side and flagged with one of:

| State | Meaning |
|---|---|
| Valid | Will be sent |
| Warning — duplicate in upload | Another row in this CSV has the same `email + role + first_name + last_name`; second and subsequent occurrences skipped |
| Error — invalid email | Malformed email address; must be fixed before proceeding |
| Error — invalid role | Role value not in `player`, `manager`, `coach`; must be fixed before proceeding |
| Error — missing required field | `first_name`, `last_name`, or `email` is blank |

**Duplicate detection within the upload:** A duplicate is defined as two rows sharing the same `email + role + first_name + last_name`. The first occurrence is kept; subsequent occurrences are flagged as warnings and skipped. Rows with the same email but different names or roles are **not** flagged — this is a valid scenario (e.g. a parent's email used for two players on the same team with the same role).

The "Send X invites" confirm button is disabled if any rows have errors. Rows with warnings are skipped automatically; errors must be resolved (edit the CSV and re-upload) before confirming.

A summary line above the table reads: "X will be sent, Y will be skipped, Z have errors."

### 3. Server-side validation

`POST /api/invitations/bulk-send` re-validates all rows server-side (same rules as client) before touching the database. Any row that fails server-side validation is skipped and reported in the response; it does not block the rest of the batch.

### 4. Batch send

For each valid row, the Resend call is attempted **before** the database insert. Because invitation UUIDs are generated prior to the request (client-side via `crypto.randomUUID()`), the invite URL is known at construction time and can be included in the email before the row exists. After the send attempt resolves, one row is inserted into `invitations` with `email_status` set to `'sent'` or `'failed'` accordingly — no follow-up UPDATE is needed. Emails are sent sequentially within the request to stay within Resend's rate limits.

### 5. Result

After the batch completes the UI shows the final status breakdown: sent / skipped / failed. The user can then view and manage all pending invites from the existing team Members page.

---

## Database Changes

Add `email_status` to the `invitations` table to support richer status tracking (bulk and single invites alike):

```sql
ALTER TABLE invitations
  ADD COLUMN email_status text
  CHECK (email_status IN ('sent', 'failed'))
  DEFAULT 'sent';
```

Postgres backfills existing rows with the column default when `DEFAULT` is specified, so all pre-existing invitation rows will read as `'sent'`. Application code always supplies an explicit `email_status` at insert time; the default serves only as a backfill mechanism for pre-existing rows and does not mask a missing status write.

---

## API Routes

| Route | Purpose |
|---|---|
| `POST /api/invitations/bulk-send` | Validates and sends a batch of invitations; body: `{ teamId, rows: [...] }` |
| `POST /api/invitations/send` | *(existing, updated)* Attempt the Resend call before inserting; insert the row with `email_status = 'sent'` or `'failed'` set at insert time. No follow-up UPDATE is needed. The existing `emailSent` boolean in the response is unchanged. |
| `POST /api/invitations/[id]/resend` | *(existing, updated)* Update `email_status = 'sent'` or `'failed'` after the Resend call. This UPDATE is best-effort: if it fails, `email_status` remains at its prior value. The Resend button in the UI is available regardless of `email_status`, so a stuck status does not prevent retrying. |

The delete route (`DELETE /api/invitations/[id]`) is unchanged.

---

## Rate Limiting

The existing per-user rate limit of 20 invitations per hour would block any meaningful bulk send. For bulk invites, apply a separate limit: **200 invitations per hour per user** (twice the max batch size). The existing 20/hr limit remains for single invites.

---

## UI

### Bulk Invite Entry Point

The existing "Add member" button on the team page becomes a split button or dropdown with two options:

- **Add member** — existing single-invite flow (unchanged)
- **Bulk invite** — opens the bulk invite modal

No new top-level button is added to the page.

### Upload Step

- File picker (`.csv` only)
- "Download template" link — provides a correctly-headed CSV with one example row
- Brief format instructions inline

### Preview Step

- Table with columns: First Name, Last Name, Email, Role, Birthday (if present), Status
- Status column shows Valid / Warning / Error badge with short reason text
- Summary line: "X will be sent, Y will be skipped, Z have errors"
- "Send X invites" button (disabled if any errors)
- "Back" link to re-upload

### Result Step

- Summary: "X invites sent, Y skipped, Z failed"
- "Done" button closes modal / returns to Members page
- Failed rows listed by email with failure reason

### Status in Members Page

Extend the existing pending invites display to show `email_status`:

| Status | Badge |
|---|---|
| `'sent'` | Pending (existing clock badge) |
| `'failed'` | Failed (red badge) — email could not be delivered at send time |

Existing Resend and Delete actions remain on all pending invite rows regardless of email status.

---

## Email

Each bulk invite sends the same email as a single invite — `buildInviteEmailHtml()` with team name, inviter name, role, and invite URL. No changes to email content or branding.

---

## Out of Scope

- Inviting `parent` or `director` roles via CSV
- Multi-team bulk invite in a single upload (directors must switch active team)
- Scheduling bulk invites for a future time
- CSV export of current roster

---

## Testing Checklist

**Validation:**
- [ ] `first_name`, `last_name`, `email`, `role` are required; missing any flagged as error
- [ ] Invalid email format flagged as error, blocks send
- [ ] `role` must be `player`, `manager`, or `coach`; any other value flagged as error
- [ ] Duplicate row within upload (same `email + role + first_name + last_name`) flagged as warning; first occurrence kept, subsequent occurrences skipped
- [ ] Same email + role but different names in the same upload are **not** flagged (valid parent-with-multiple-kids scenario)
- [ ] Same email + different role in the same upload is **not** flagged
- [ ] Maximum 100 rows enforced client-side and server-side
- [ ] `birthday` and `gender` columns are optional; included in created invitation row when present

**Sending:**
- [ ] Valid bulk rows create one `invitations` row each with `email_status = 'sent'`
- [ ] Resend API failure sets `email_status = 'failed'` for both bulk and single invites; invitation row still created
- [ ] Single invite route writes `email_status = 'sent'` or `'failed'` after Resend call; `emailSent` response field unchanged
- [ ] Resend route updates `email_status = 'sent'` or `'failed'` after re-send
- [ ] Rows with errors do not block valid rows in the same batch from sending
- [ ] Server-side re-validation matches client-side rules; skipped rows reported in response
- [ ] Bulk rate limit (200/hr) enforced separately from single-invite limit (20/hr)

**Status tracking:**
- [ ] Members page shows Failed badge on invites where `email_status = 'failed'`

**UI:**
- [ ] "Add member" button becomes dropdown with "Add member" and "Bulk invite" options
- [ ] Upload step accepts `.csv` only; rejects other file types
- [ ] "Download template" link provides correctly-headed CSV with one example row
- [ ] Preview table shows all rows with correct status badges before sending
- [ ] Summary line ("X will be sent, Y skipped, Z errors") is accurate
- [ ] "Send" button disabled when any rows have errors
- [ ] Result step shows sent / skipped / failed breakdown

**Access control:**
- [ ] Coach, manager, and director can access bulk invite on their active team
- [ ] Non-admin team member cannot access bulk invite
- [ ] Director must select a team as their active team; invite is scoped to that team
