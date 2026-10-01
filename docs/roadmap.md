# Lista Roadmap & Process Notes

A living document for tracking feature ideas, process improvements, and architectural decisions. Update this as new ideas come up.

Shipped features are removed from this list. Their specs stay in `docs/specs/`, and git history keeps the record.

---

## Next Features to Build

Roughly prioritized — revisit ordering as the product evolves.

### 1. Tournaments and Leagues (next, before the 1.1.0 mobile release)
Spec: `docs/specs/tournaments-and-leagues.md`. Decided 2026-10-01: tournaments first, then leagues.
- **Tournaments:** a new event type spanning several days, with several games, a placement ("2nd place",
  "Gold bracket champions"), and a record limited to its own games. People answer "are you coming?" once for
  the tournament.
- **Leagues:** tag games with one of the team's leagues, and show a league record next to the overall record.

To be settled before the 1.1.0 mobile release (`docs/releases/mobile-next.md`), because tournaments change
what the app's schedule and event screens should show. The installed 1.0.12 shows a tournament as a plain
event (spec §7). Leagues don't affect what 1.0.12 sees.

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
  nothing sends the digest yet. Build it on the shared email layout in `apps/web/src/emails`
  (`docs/specs/email-upgrade.md`), with a preview sample like every other email.
- **Chat notification settings on the web**: the web settings page only has the general email and push
  toggles.

### 6. Answering Availability Without Signing In
Event emails carry Available / Maybe / Unavailable buttons that record an answer on the event page, after
signing in if needed (`docs/specs/email-upgrade.md` §4.7, D3). Answering straight from the email, with no
sign-in, needs signed per-recipient links: a token route with its own security design (expiry, one person
per link, guardians answering for players). Deferred from the email upgrade.

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
