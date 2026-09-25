import { SelectItem } from "@/components/ui/select";
import { uniformOf, type TeamUniforms } from "@/lib/events/game-display";
import { UniformDot } from "./uniform-label";

/** A game form's uniform choices: each by the team's name for it, with its color. */
export function UniformOptions({ team }: { team: TeamUniforms }) {
  return (
    <>
      {(["home", "away"] as const).map((which) => {
        const uniform = uniformOf(which, team)!;
        return (
          <SelectItem key={which} value={which}>
            <span className="flex items-center gap-2">
              <UniformDot uniform={uniform} on="page" />
              {uniform.name}
            </span>
          </SelectItem>
        );
      })}
    </>
  );
}
