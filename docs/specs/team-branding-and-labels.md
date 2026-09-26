# Spec — Team branding and consistent labels

**Status:** Ready for implementation. Decisions settled with the user on 2026-09-25.
**Scope:** Web app only (`apps/web`).

## 1. Consistent capitalization

Stored values such as `game`, `mom`, `coach`, `away` and `win` are shown in about 20 places. Some print
them as-is, and some capitalize them with Tailwind's `capitalize` class, so the same value reads "mom" in
one place and "Mom" in another.

- One helper, `displayLabel(value)`, capitalizes the first letter of each word ("mom" → "Mom",
  "step parent" → "Step Parent"). It leaves an already capitalized value as it is, and returns "—" for an
  empty value.
- Every place that shows one of these values uses it:
  - event types (pills and badges)
  - roles (roster, team picker, profile switcher, invites, ownership transfer)
  - guardian relationships
  - home/away
  - game results
- The `capitalize` class is no longer used for these values. A test checks that no source file uses it.

## 2. Club teams inherit the club logo

- **A club team** is a team whose organization is on a club plan (`club_small` or `club_large`). Free
  teams also have an organization, but it carries no club branding. A club that downgrades stops showing
  its branding, as its subdomain and white-labelling already do.
- **A team's logo** is its own `teams.logo_url` if it has one. For a club team without one, it is the club's
  `organizations.logo_url`.
- The team's logo is shown in the team picker (the button and each option) and at the top left of every
  page (§4).

## 3. Club name before the team name in the team picker

- A club team is shown as **"[club] - [team]"**, e.g. "SLOFC - 12U Girls", in the team picker's button and
  options.
- **[club]** is the club's Public Display Name (`org_name_public`), or its internal name when that is not
  set.
- Teams that are not on a club are shown by their own name, as today.

## 4. Larger logos

- **Header:** 96px tall, up from 56px. The top left shows the **active team's logo** (§2) at 72px tall,
  keeping its proportions.
  - On a club's own subdomain with no team logo, it shows the club's logo, as today.
  - With neither, it shows the club's name or the "lista" wordmark.
- **Dashboard Team card:** the card is rebuilt around the team:

  ```
  ┌───────────────────────────────┐
  │ ┌──────────┐                  │
  │ │   LOGO   │  12U Girls       │
  │ │   96px   │  SLOFC · Fall 26 │
  │ └──────────┘                  │
  │ Record  7–2–1  (W–L–T)        │
  │ Last    W 3–1 vs Rivals FC    │
  │         Sat, Sep 20           │
  │ 18 members · View roster      │
  └───────────────────────────────┘
  ```

  - **Logo:** the team's logo (§2), 96px. Without one, the team's initials on a neutral tile.
  - **Name:** the team's own name, with the club (club teams only) and season under it.
  - **Record:** wins–losses–ties over **every game on this team with a result entered**. Games without a
    result do not count. The record is hidden when no game has a result.
  - **Last:** the **most recent past game with a result**: "W/L/T", the score when entered, the opponent,
    and the date in the game's timezone. It is hidden when no game has a result.
  - **Members:** the member count and the roster link, as today.

## Testing

- `displayLabel`:
  - lowercase, already capitalized and multi-word values
  - an empty value
- A source scan finds no `capitalize` class.
- Surfaces:
  - the dashboard's event type pill reads "Game"
  - a guardian relationship reads "Mom"
  - a roster role reads "Coach"
- Team branding helper:
  - a team's own logo beats the club's
  - a club team without its own logo inherits the club's
  - a free team's organization logo is not used
  - the name is "[public name] - [team]", or "[internal name] - [team]" without a public name, and a free
    team is unprefixed
- Team picker: the button and options show the prefixed name and the inherited logo.
- Header: shows the active team's logo, falling back to the tenant logo and then the wordmark.
- Dashboard Team card:
  - the record counts only games with a result (W, L and T)
  - the last game is the latest one with a result, with its score when entered
  - both are hidden when no game has a result
  - the logo, or initials without one
