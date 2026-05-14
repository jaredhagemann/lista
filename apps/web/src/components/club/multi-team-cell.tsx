"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function MultiTeamCell({ teams }: { teams: string[] }) {
  if (teams.length === 0) return <span className="text-muted-foreground">—</span>;
  if (teams.length === 1) return <span>{teams[0]}</span>;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-default underline decoration-dotted underline-offset-2">
          {teams.length} teams
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <ul className="space-y-0.5 text-sm">
          {teams.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}
