-- 1. Create locations table
CREATE TABLE locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name text NOT NULL,
  address text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (team_id, name)
);

-- 2. Enable RLS on locations
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team members can view locations"
  ON locations FOR SELECT
  USING (is_team_member(team_id));

CREATE POLICY "Team admins can insert locations"
  ON locations FOR INSERT
  WITH CHECK (is_team_admin(team_id));

CREATE POLICY "Team admins can update locations"
  ON locations FOR UPDATE
  USING (is_team_admin(team_id));

CREATE POLICY "Team admins can delete locations"
  ON locations FOR DELETE
  USING (is_team_admin(team_id));

-- 3. Rename description to notes
ALTER TABLE events RENAME COLUMN description TO notes;

-- 4. Add location_id FK (replaces text location column)
ALTER TABLE events ADD COLUMN location_id uuid REFERENCES locations(id) ON DELETE SET NULL;

-- 5. Drop old text location column
ALTER TABLE events DROP COLUMN location;

-- 6. Add game-specific columns
ALTER TABLE events ADD COLUMN opponent text;
ALTER TABLE events ADD COLUMN home_away text CHECK (home_away IN ('home', 'away'));
ALTER TABLE events ADD COLUMN uniform text CHECK (uniform IN ('home', 'away'));
ALTER TABLE events ADD COLUMN game_result text CHECK (game_result IN ('win', 'loss', 'tie'));
ALTER TABLE events ADD COLUMN score_for integer;
ALTER TABLE events ADD COLUMN score_against integer;
