# Team Settings: Extended Fields

## Context
The Team Settings tab (Settings > Team) currently only has **Team Name** and **Season**. We want to add depth by introducing several optional fields that describe the team's sport, league, demographics, uniforms, and location.

## New Fields

All fields are **optional** (`NULL`-able) and only editable by coaches/managers (same `is_team_admin` check already in place).

| Field | Column Name | Type | Notes |
|---|---|---|---|
| Sport | `sport` | `text` with CHECK | Enum: `baseball`, `basketball`, `cricket`, `field_hockey`, `flag_football`, `football`, `golf`, `gymnastics`, `ice_hockey`, `lacrosse`, `pickleball`, `rugby`, `soccer`, `softball`, `swimming`, `tennis`, `track_and_field`, `volleyball`, `wrestling`, `other` |
| League | `league` | `text` | Free-form, e.g. "AYSO Region 42", "Little League District 5" |
| League Website | `league_url` | `text` | URL to the league's website |
| Team Age | `age_group` | `text` with CHECK | Enum: `6u`, `7u`, `8u`, `9u`, `10u`, `11u`, `12u`, `13u`, `14u`, `15u`, `16u`, `17u`, `18u`, `high_school`, `college`, `adult` |
| Gender | `gender` | `text` with CHECK | Enum: `male`, `female`, `coed` |
| Home Uniform | `home_uniform` | `text` | Free-form description, e.g. "White jersey, blue shorts" |
| Away Uniform | `away_uniform` | `text` | Free-form description, e.g. "Blue jersey, white shorts" |
| Time Zone | `timezone` | `text` | IANA timezone string, e.g. `America/Los_Angeles` — rendered via a searchable Select |
| Country | `country` | `text` | ISO 3166-1 alpha-2 code, e.g. `US`, `CA` — rendered via a Select |
| Zip Code | `zip` | `text` | Postal/zip code |

## Database Migration

Add columns to the `teams` table:

```sql
alter table teams add column sport text;
alter table teams add column league text;
alter table teams add column league_url text;
alter table teams add column age_group text;
alter table teams add column gender text;
alter table teams add column home_uniform text;
alter table teams add column away_uniform text;
alter table teams add column timezone text;
alter table teams add column country text;
alter table teams add column zip text;

alter table teams add constraint teams_sport_check
  check (sport in ('baseball','basketball','cricket','field_hockey','flag_football','football','golf','gymnastics','ice_hockey','lacrosse','pickleball','rugby','soccer','softball','swimming','tennis','track_and_field','volleyball','wrestling','other'));

alter table teams add constraint teams_age_group_check
  check (age_group in ('6u','7u','8u','9u','10u','11u','12u','13u','14u','15u','16u','17u','18u','high_school','college','adult'));

alter table teams add constraint teams_gender_check
  check (gender in ('male','female','coed'));
```

After running the migration, regenerate `src/types/database.ts` so the new columns appear in the `teams` Row/Insert/Update types.

## RLS

No RLS changes needed — existing policies already allow team admins to UPDATE the `teams` table and team members to SELECT it.

## Tests

Add RLS tests in `tests/rls/teams.test.ts`:

1. **Admin can UPDATE new team fields** — coach sets `sport`, `league`, `league_url`, `age_group`, `gender`, `home_uniform`, `away_uniform`, `timezone`, `country`, `zip` and reads them back
2. **Non-admin cannot UPDATE new team fields** — player attempts to set `sport` and it remains unchanged
3. **CHECK constraint rejects invalid sport** — admin tries an invalid sport value and gets an error
4. **CHECK constraint rejects invalid age_group** — admin tries an invalid age_group value and gets an error
5. **CHECK constraint rejects invalid gender** — admin tries an invalid gender value and gets an error

## UI Changes

### `TeamSettingsForm` (`src/components/settings/team-settings-form.tsx`)

Extend the existing view/edit grid with the new fields. Group them into sections for readability:

**General** (existing)
- Team Name (Input, required)
- Season (Input)

**Sport & League**
- Sport (Select from enum values, display labels capitalized/formatted)
- League (Input)
- League Website (Input, type="url")

**Demographics**
- Team Age (Select from enum values, display labels formatted e.g. "10U", "High School")
- Gender (Select: Male / Female / Coed)

**Uniforms**
- Home Uniform (Input)
- Away Uniform (Input)

**Location**
- Time Zone (searchable Select populated from `Intl.supportedValuesOf('timeZone')`)
- Country (Select with common countries at top: US, CA, MX, GB, AU — then alphabetical)
- Zip Code (Input)

Read-only mode shows label/value pairs (same grid layout). Edit mode replaces values with inputs/selects. The existing Save/Cancel/Edit button pattern stays the same — one save updates all fields in a single `.update()` call.

## Files Summary
- **New migration:** `supabase/migrations/2026XXXXXXXXXX_team_settings_fields.sql`
- **Modify:** `src/types/database.ts` (regenerate)
- **Modify:** `src/components/settings/team-settings-form.tsx` — add all new fields
- **Modify:** `tests/rls/teams.test.ts` — add tests for new fields and constraints
