# Member UI Changes

Follow-up to the data model changes in `docs/specs/member-model-changes.md`. This spec covers the UI work needed to surface the new `contacts` table and updated profile fields.

---

## 1. Edit Profile (Settings > Profile tab)

**File:** `src/components/settings/profile-form.tsx`

The current form already has first name, last name, birthday, gender, and email (read-only). No further changes needed to the profile fields themselves.

### Add: Contacts section below profile fields

Add a **"Contacts"** card below the existing Profile card on the Settings > Profile tab. This is where users manage their own contact list.

**Layout:**
- Card titled "Contacts" with description "People who can be reached about you (emergency contacts, parents, yourself, etc.)"
- List of existing contacts, each shown as a compact row:
  - **Left:** Relationship badge (e.g. "Self", "Mother") + full name
  - **Right:** Edit (pencil icon) and Delete (trash icon) buttons
- "Add contact" button at the bottom of the list

**Add/Edit contact form** (inline or in a dialog — suggest dialog to keep the page clean):
- Relationship (text input, with common suggestions: "Self", "Mother", "Father", "Guardian", "Emergency")
- First name (required)
- Last name
- Email
- Phone
- Address fields: Street, City, State, Zip — collapsed behind an "Add address" toggle to avoid clutter
- "Receives team emails" checkbox (default off) — controls whether this contact gets copies of team-wide emails

**Behavior:**
- On first visit, if the user has no contacts, show an empty state: "No contacts yet. Add yourself or a parent/guardian."
- The user's own login email is shown on the profile card (read-only). The contacts section is for reachable phone/email/address entries — including a "Self" contact if they want to list their own phone.
- Deleting a contact shows a confirmation dialog.
- All mutations go directly to Supabase from the client component (standard pattern).

**Data flow:**
- Settings page (`src/app/dashboard/settings/page.tsx`) fetches contacts server-side alongside the profile and passes them as a prop.
- The contacts card is a client component that handles CRUD.

---

## 2. Add Member (Invite dialog)

**File:** `src/components/team/invite-member-dialog.tsx`

The current dialog asks for email + role, sends an invitation, and shows a copy-link fallback. The role dropdown now has Player, Coach, Manager (parent was removed in the data model change).

### Changes

1. **Update placeholder text** — change `parent@example.com` to `player@example.com` since Player is the default role.

2. **Add optional name fields** — Add First name and Last name inputs (both optional) above the email field. These are convenience fields: if the admin knows who they're inviting, the name shows up in the pending invitations list on the team page (future work), but they aren't required since the invitee sets their own name on signup.

   Store these on the invitation row. This requires adding `first_name` and `last_name` columns to the `invitations` table (nullable text, migration needed).

3. **No other structural changes** — the send → result → copy-link flow stays the same.

---

## 3. Team Page — Member Detail / Edit

**File:** `src/app/dashboard/team/page.tsx`

Currently the team page shows a read-only roster with avatar, name, email, and role badge. Admins can invite but can't view or edit member details.

### Add: Member detail sheet

When an admin clicks a member row, open a **Sheet** (slide-over panel from the right) showing that member's details:

**Read-only section (visible to all team members):**
- First name, Last name
- Email (from profile)
- Birthday, Gender (if set)
- Role badge + Jersey number (if player)

**Contacts section (visible to all team members):**
- List of that member's contacts (fetched via the `contacts` table)
- Each contact shows: relationship, name, phone, email
- Address shown if present

**Admin-only actions (coach/manager):**
- "Edit role" — dropdown to change the member's role (coach/manager/player)
- "Edit jersey number" — inline input (players only)
- "Remove from team" — destructive action with confirmation

Non-admins see the sheet as read-only (no edit/remove buttons). All members can view teammate contacts — this is by design so coaches and fellow parents can reach each other.

---

## 4. Signup flow

**File:** `src/app/(auth)/signup/signup-form.tsx`

Currently collects "Full name" as a single field. Since the trigger now stores `first_name`:

- Rename the label from "Full name" to "First name"
- Add a "Last name" field below it (optional)
- Pass both as user metadata: `first_name` and `last_name`
- Update the `handle_new_user()` trigger to also read `last_name` from metadata (migration needed)

---

## 5. Accept Invite flow

**File:** `src/app/(auth)/invite/[id]/accept-invite-client.tsx`

No changes needed. The accept flow just adds the user as a team member with the invited role. Name and contact info are managed separately via profile settings.

---

## Implementation Order

1. **Signup form** — split name field, update trigger (small, standalone)
2. **Invite dialog** — add name fields, placeholder fix, migration for invitation name columns
3. **Contacts component** — new `ContactsCard` component with full CRUD
4. **Settings page** — wire up contacts fetch + render `ContactsCard`
5. **Team page member detail sheet** — new `MemberDetailSheet` component showing profile + contacts, admin actions

Each step is independently shippable.

---

## Out of Scope

- Bulk import of members (CSV upload, etc.)
- Profile photo/avatar upload
- Contact deduplication or merging
- Email delivery preferences beyond the per-contact `receives_email` flag
- Admin editing a member's profile or contacts on their behalf (members manage their own data)
