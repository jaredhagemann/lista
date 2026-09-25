# Spec — Game display and uniform colors

**Status:** Ready for implementation. Decisions settled with the user on 2026-09-25 (see *Decisions*); revised the same day after review (event-page data wiring, confirmations, the Title field, score rules, dark-mode and chip contrast).
**Scope:** Web app only (`apps/web`). The mobile app, notification emails and push text are unchanged.

## Goals

1. A team can give each uniform (home, away) an optional **color** alongside its name.
2. Wherever a game's details are shown, the uniform appears **by its name, in its color**, rather than as
   "home" or "away".
3. Games are titled **"[Team Name] vs [opponent]"** (home) or **"[Team Name] @ [opponent]"** (away)
   everywhere on the web: the schedule list, the calendar, the event page and the dashboard.

## Decisions (2026-09-25)

| Question | Decision |
| --- | --- |
| How is a colored uniform name shown? | A **filled pill** in the uniform's color. The text is automatically black or white, whichever contrasts better. Very light colors also get a thin border so the pill stays visible on a white page. |
| Color picker style | A **palette of common kit colors** plus a **Custom** option that opens the browser's full color picker. |
| Uniform on the calendar? | Yes: a **color dot** at the start of a game's chip. The uniform's name is in the chip's tooltip. |
| Home/away in the new title | **"@" for away games**: "[Team Name] @ [opponent]". Home games, and games with home/away unset, use "vs". |
| Event page and dashboard titles | Games are titled the same way **everywhere**, including the event page heading and the dashboard's upcoming events. |

## Today

| Where | What it shows for a game |
| --- | --- |
| Team settings → Uniforms | Two text fields: Home Uniform, Away Uniform (`teams.home_uniform`, `teams.away_uniform`). |
| Event form (create / edit / series edit) | A Uniform select whose options are the team's uniform names, falling back to "Home" and "Away". It stores `events.uniform = 'home' \| 'away'`. |
| Event page | The heading is the event's `title`. Below it: "Opponent: X", "Home" or "Away", and **"Uniform: home"**: the stored code, not the uniform's name. |
| Schedule list | Title "Home vs X" / "Away @ X" / "X", plus " · 3–1" when scored. No uniform. |
| Schedule calendar | Chip text is the event's `title`. The calendar query does not fetch the opponent. |
| Dashboard → Upcoming events | The event's `title`. No uniform. |

## 1. Uniform colors

### Data

- New nullable columns on `teams`: `home_uniform_color` and `away_uniform_color` (`text`).
- Stored as a 6-digit hex color, `#rrggbb`, lowercase. A check constraint enforces the format (or null).
- A color belongs to the **team's uniform**, not the game. A game keeps pointing at `home` / `away`, so
  changing a uniform's name or color updates every game that uses it, past and future. (This is how
  uniform names already work.)
- Existing `teams` update permissions apply (team admins; refused in a closed club).

### Team settings

- Each uniform row (Home, Away) gets an **optional color** next to its name field:
  - **Palette.** One-click swatches: White `#ffffff`, Black `#111111`, Gray `#6b7280`, Navy `#1e3a8a`,
    Royal `#2563eb`, Sky `#38bdf8`, Red `#dc2626`, Maroon `#7f1d1d`, Green `#15803d`, Gold `#eab308`,
    Orange `#ea580c`, Purple `#7c3aed`. Each swatch shows its name as a tooltip and accessible label.
    The selected swatch is marked.
  - **Custom.** Opens the browser's color picker (`<input type="color">`). A custom color replaces any
    palette selection.
  - **Clear.** Removes the color.
- Picking a palette color does **not** change the uniform's name. The name and the color are
  independent.
- View mode shows each uniform exactly as it will appear on games (the pill below), or "—" if neither a
  name nor a color is set.
- A color can be set without a name. The uniform is then displayed as "Home uniform" / "Away uniform" in
  that color.

### Displaying a uniform: `UniformLabel`

One shared component, used everywhere a game's uniform appears:

- **Text:** the uniform's name. If the team hasn't named it, "Home uniform" / "Away uniform".
- **With a color:** a small rounded pill filled with the color.
  - The text is black or white, whichever has the higher WCAG contrast ratio against the fill.
  - The pill gets a thin border when the fill's contrast against the background it sits on is below
    1.5:1, in the **current theme**: white or pale colors on the light theme, and black or very dark
    colors on the dark theme. (Navy, at 1.6:1 against the dark card, needs none.)
- **Without a color:** the name as plain text, as today.
- **Accessibility:** the name is always shown, so the color never carries meaning on its own. The element
  has an accessible name, "Uniform: Navy".

### Where the uniform is shown

| Place | Change |
| --- | --- |
| Event page | "Uniform: home" becomes "Uniform:" followed by `UniformLabel`. |
| Schedule list | `UniformLabel` is added to each game row, under the title next to the type badge, on every screen size. |
| Schedule calendar | A **color dot** at the start of a game's chip, in the uniform's color. The dot gets a thin border when its contrast against the **chip's own background** (the green game chip) is below 1.5:1, in either theme. The chip's tooltip reads "[title] · [uniform name]". No dot when the game has no uniform or the uniform has no color. The mobile dot view is unchanged. |
| Dashboard → Upcoming events | `UniformLabel` is added under a game's time. |
| Event forms (create, edit, series edit) | Each Uniform select option shows a color swatch beside its name, with the same border rule measured against the page. |

Games with no uniform selected show nothing, as today.

## 2. Game titles

One shared helper, `gameTitle(event, teamName, { includeScore = true })`:

| Case | Title |
| --- | --- |
| Game, home or unset, with an opponent | `[Team Name] vs [opponent]` |
| Game, away, with an opponent | `[Team Name] @ [opponent]` |
| Either, with a score, when `includeScore` | The same, plus ` · 3–1` (score suffix kept from today) |
| Game with no opponent | The event's own title |
| Practice or other event | The event's own title |

- **Score.** A score is shown only when **both** `score_for` and `score_against` are set. `0–0` is a score.
  One side set and the other empty shows no score. `includeScore: false` suppresses it: calendar chips and
  whole-series confirmations use that, since scores differ per occurrence.
- **Team Name** is the event's team's `teams.name`. On the schedule, dashboard and event page that is the
  active team.
- The stored `events.title` is unchanged and still editable. It is still used for games without an
  opponent and for every non-game. This is display only, so renaming a team renames every game on its
  schedule.

### Where it applies

| Place | Change |
| --- | --- |
| Schedule list | The title column uses `gameTitle`. The cancel, restore and delete confirmations name the game the same way. |
| Schedule calendar | Chips use `gameTitle(…, { includeScore: false })` instead of `title`. They are one line, truncated with an ellipsis as today, with the full title in the tooltip. |
| Event page | The heading uses `gameTitle`, and so do its cancel, restore and delete-this-event confirmations, so a dialog always names the game the way the heading does. |
| Event page: whole-series confirmations | Deleting or editing a whole series names it by the opened occurrence's `gameTitle(…, { includeScore: false })`, e.g. "the *U10 Girls vs Rivals* series". A score belongs to one game, not the series. |
| Dashboard → Upcoming events | Uses `gameTitle`. |

### The Title field in event forms

The create, edit and series-edit forms keep the Title field, and it stays required on the create form, but
for a game it doesn't always decide what people see. So:

- **Helper text** under Title, shown when the type is Game: "Games with an opponent are shown as
  *[Team Name] vs [opponent]*. This title is used when there's no opponent."
- **Live preview**, shown when the type is Game: "Shown as: **U10 Girls @ Rivals**", updating as Title,
  Opponent and Home/Away change. It uses `gameTitle` without a score, so the preview is exactly what the
  schedule will show.
- Practices and other events show neither: their title is always what's shown.

### The series-edit review

The review of a series edit ("what will change") names uniforms and home/away by what people see:

- **Uniform:** "Navy → White". It uses the team's uniform names, or "Home uniform" / "Away uniform" when
  unnamed, shown with `UniformLabel`. It no longer shows the stored `home → away`.
- **Home/away:** "Home → Away", not `home → away`.

### Data needed

- The calendar query (`CalendarEventRow` in `src/lib/events/queries.ts`) gains `opponent`, `home_away`,
  `uniform`, `score_for` and `score_against`. The scores are only used to keep the title helper's
  contract; chips suppress them.
- Each page passes the team's `name`, the two uniform names and the two uniform colors to the views it
  renders.
- **The event page must read the team directly.** Today
  (`src/app/dashboard/schedule/[eventId]/page.tsx`) it casts `activeMembership.teams`, which is the team
  row itself, as a membership, and then reads `.teams` from it again. So every team field it passes is
  null: uniform names have never reached the event page's edit form, and neither has the team timezone
  added for BUG-010, whose only visible effect is that the event editor's zone picker lacks its
  "(team default)" label and hint. Read `home_uniform`, `away_uniform`, the two colors, `name` and
  `timezone` from `activeMembership.teams`. That fixes both.

## Testing

- **Database:** the color columns accept `#rrggbb` and null, and refuse anything else (`red`, `#fff`,
  `#GGGGGG`).
- **`gameTitle`:**
  - each row of the table above
  - `0–0` shown
  - one score missing means no score
  - `includeScore: false` drops the score
- **`UniformLabel`:**
  - the name, or "Home/Away uniform" when unnamed
  - the fill color
  - black text on white/gold and white text on navy/black
  - the border on white in the light theme, and on black/navy in the dark theme
  - no border where contrast suffices
  - plain text when there is no color
  - the accessible name
- **Calendar dot:**
  - a border on a color close to the green game chip, in both themes
  - none on a contrasting color
  - no dot without a color
- **Event page (page-level, not only the component):**
  - render the page for a game on a team with named, colored uniforms, and check the uniform's
    **name** and color reach the view and the edit form's uniform options
  - check the team timezone reaches the zone picker ("(team default)")
  - this catches the membership cast described under *Data needed*
- **Confirmations:**
  - the schedule list and event-page cancel, restore and delete dialogs name a game by `gameTitle`
  - the whole-series delete names the series without a score
- **Series-edit review:** a uniform change reads "Navy → White" and a home/away change reads
  "Home → Away".
- **Event forms:**
  - for a game, the helper text and the "Shown as" preview appear and follow Title, Opponent and
    Home/Away
  - for a practice, neither appears
- **Team settings:**
  - pick a palette color, pick a custom color, clear a color
  - the saved value is `#rrggbb` or null
  - the name is unchanged by picking
  - view mode shows the pill
- **Schedule list, calendar, event page, dashboard:**
  - a home game renders "[Team Name] vs [opponent]"
  - an away game renders "[Team Name] @ [opponent]"
  - a game with no opponent keeps its title
  - practices are unchanged
  - the uniform label or dot appears where specified
- **Event page:** the uniform shows by name and color, not "home".

## Out of scope

- The mobile app. Its schedule and event screens keep today's text; a follow-up can adopt the same
  display.
- Notification emails and push text.
- Per-game uniform overrides, more than two uniforms, and team logo colors.
