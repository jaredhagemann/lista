import { gameTitle } from "@/lib/events/game-display";

/**
 * Under a game's Title field: when the typed title is used, and what the
 * schedule will actually show (spec: game-display-and-uniform-colors). Without
 * it, changing a game's title would appear to do nothing. Renders nothing for
 * practices and other events, whose title is always what is shown.
 */
export function GameTitleHint({
  eventType,
  title,
  opponent,
  homeAway,
  teamName,
}: {
  eventType: string;
  title: string;
  opponent: string;
  homeAway: string;
  teamName: string;
}) {
  if (eventType !== "game") return null;
  const shown = gameTitle(
    { title, event_type: eventType, opponent, home_away: homeAway || null },
    teamName,
    { includeScore: false }
  );
  return (
    <div className="space-y-0.5 text-xs text-muted-foreground">
      <p>
        Games with an opponent are shown as{" "}
        <em>
          {teamName} vs {"[opponent]"}
        </em>
        . This title is used when there&apos;s no opponent.
      </p>
      <p data-testid="game-title-preview">
        Shown as: <strong className="text-foreground">{shown}</strong>
      </p>
    </div>
  );
}
