"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LeaderboardTab } from "./leaderboard-tab";
import { MyTrainingTab } from "./my-training-tab";
import { TeamTab } from "./team-tab";

export type TeamRef = { id: string; name: string };

export type TrainingViewProps = {
  viewerId: string;
  activeProfile: {
    id: string;
    firstName: string;
    lastName: string | null;
    optedOut: boolean;
  };
  activeTeam: { id: string; name: string; timezone: string | null };
  org: { id: string; name: string };
  isTeamAdmin: boolean;
  eligibleTeams: TeamRef[];
  orgTeams: TeamRef[];
};

export function TrainingView(props: TrainingViewProps) {
  const { activeTeam, isTeamAdmin } = props;
  const [tab, setTab] = useState("leaderboard");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Training</h1>
        <p className="text-sm text-muted-foreground">
          Log the work you put in on your own — {activeTeam.name}
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
          <TabsTrigger value="my-training">My Training</TabsTrigger>
          {isTeamAdmin && <TabsTrigger value="team">Team</TabsTrigger>}
        </TabsList>

        <TabsContent value="leaderboard" className="mt-4">
          <LeaderboardTab {...props} onGoToMyTraining={() => setTab("my-training")} />
        </TabsContent>
        <TabsContent value="my-training" className="mt-4">
          <MyTrainingTab {...props} />
        </TabsContent>
        {isTeamAdmin && (
          <TabsContent value="team" className="mt-4">
            <TeamTab {...props} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
