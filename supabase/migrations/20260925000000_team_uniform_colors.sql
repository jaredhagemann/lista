-- Optional uniform colors (spec: docs/specs/game-display-and-uniform-colors.md).
--
-- Each of a team's two uniforms can have a color alongside its name, shown
-- wherever a game's uniform appears on the web. Stored as #rrggbb, lowercase.
-- A game keeps pointing at 'home' / 'away', so a color change applies to every
-- game that wears that uniform, as a name change already does. The existing
-- teams update policy (team admins) governs who can set them.

alter table teams
  add column home_uniform_color text,
  add column away_uniform_color text;

alter table teams add constraint teams_uniform_color_format check (
  (home_uniform_color is null or home_uniform_color ~ '^#[0-9a-f]{6}$')
  and (away_uniform_color is null or away_uniform_color ~ '^#[0-9a-f]{6}$')
);
