# Lista Roadmap & Process Notes

A living document for tracking feature ideas, process improvements, and architectural decisions. Update this as new ideas come up.

Shipped features are removed from this list. Their specs stay in `docs/specs/`, and git history keeps the record.

---

## Next Features to Build

Roughly prioritized — revisit ordering as the product evolves.

### 1. Email Upgrade
Every email the app sends — team and director invitations, event reminders, schedule-change notifications,
signup confirmation, billing and trial notices, club ownership, closure and team deletion — is a hand-written
HTML string, sent through Resend. They live in `apps/web/src/lib/notifications/email.ts`, `billing-emails.ts`,
`lib/club/ownership.ts`, `team-deletion.ts` and the invite routes, so each one looks a little different and a
change to the look means touching them all. Upgrade them to one consistent, polished design:

- **One shared layout:** header, footer and button styles in one place, with every email built from it.
- **Branding:** a club team's email carries the club's logo, name and colors (the same rules as the in-app
  branding in `docs/specs/team-branding-and-labels.md`); everything else carries lista's.
- **Richer content:** e.g. event reminders and schedule changes show the event's date, time with its zone,
  location, opponent and uniform, and a one-tap availability answer; invitations show the team's logo and
  who invited you.
- **Reliable rendering:** tested across the main mail clients (Gmail, Outlook, Apple Mail, dark mode and
  phones), with a plain-text version alongside the HTML.
- **Preview and test:** a way to preview every email with sample data, and tests on the content of each.

Open questions for the spec: which emails come first, whether to adopt a template library (e.g. React Email),
and whether the chat digest email (below) is part of this work.

### 2. Stats & Season Records
Game results and scores can be entered on an event, and the dashboard's Record card shows the team's W–L–T
and last game (`docs/specs/team-branding-and-labels.md` §4). Still to build: a season view (goals for and
against, results by opponent, filtered by season) and a per-player stats dashboard.

### 3. Attendance Tracking
"Availability" is a pre-event RSVP — there's no record of who actually showed up. Coaches need this for rostering decisions and parent communication. Likely a lightweight addition: a second status on `availability` or a separate `attendance` table.

### 4. Media / Document Sharing
Supabase Storage is already configured with RLS policies (`tests/rls/storage.test.ts`), but only for avatars and team images. A shared team library for playbooks, game film links, and event photos would round out the feature set without much infrastructure work.

### 5. Chat Follow-ups
Team chat has shipped on web and mobile (`docs/specs/team-chat.md`), including mobile push and chat
notification settings in the mobile app. Still to do:
- **Daily digest email** for unread messages. `notification_preferences.chat_digest_enabled` exists, but
  nothing sends the digest yet.
- **Chat notification settings on the web**: the web settings page only has the general email and push
  toggles.

---

## Mobile App Strategy

**Decision: Monorepo (Turborepo) with React Native / Expo — in place.**

`@supabase/supabase-js` works identically in React Native, so the auth patterns, RLS policies and database types are shared between the apps:

```
lista/ (Turborepo root)
├── apps/
│   ├── web/        ← Next.js app
│   └── mobile/     ← React Native / Expo app
├── packages/
│   ├── supabase/   ← shared Supabase client + config
│   ├── types/      ← shared database.ts types
│   └── utils/      ← shared rrule, date helpers, etc.
└── turbo.json
```

If native Swift/Kotlin is ever chosen instead of React Native, revisit this — the shared-code argument disappears when languages diverge.
