import { useEffect, useState } from "react";
import * as SecureStore from "expo-secure-store";
import { supabase } from "../lib/supabase";

export type ActiveMembership = {
  profileId: string;
  teamId: string;
  teamName: string;
  season: string | null;
  role: string;
  homeUniform: string | null;
  awayUniform: string | null;
};

export function useActiveMembership(userId: string | undefined) {
  const [membership, setMembership] = useState<
    ActiveMembership | null | undefined
  >(undefined);

  useEffect(() => {
    if (!userId) return;

    async function load() {
      const activeProfileId =
        (await SecureStore.getItemAsync("active_profile_id")) ?? userId!;

      const { data: profile } = await supabase
        .from("profiles")
        .select("active_team_id")
        .eq("id", activeProfileId)
        .single();

      let row: any = null;

      if (profile?.active_team_id) {
        const { data } = await supabase
          .from("team_members")
          .select(
            "role, team_id, teams(id, name, season, home_uniform, away_uniform)"
          )
          .eq("profile_id", activeProfileId)
          .eq("team_id", profile.active_team_id)
          .maybeSingle();
        row = data;
      }

      if (!row) {
        const { data } = await supabase
          .from("team_members")
          .select(
            "role, team_id, teams(id, name, season, home_uniform, away_uniform)"
          )
          .eq("profile_id", activeProfileId)
          .order("created_at")
          .limit(1)
          .maybeSingle();
        row = data;
      }

      if (!row) {
        setMembership(null);
        return;
      }

      const team = row.teams as any;
      setMembership({
        profileId: activeProfileId,
        teamId: team.id,
        teamName: team.name,
        season: team.season ?? null,
        role: row.role,
        homeUniform: team.home_uniform ?? null,
        awayUniform: team.away_uniform ?? null,
      });
    }

    load();
  }, [userId]);

  return membership;
}
