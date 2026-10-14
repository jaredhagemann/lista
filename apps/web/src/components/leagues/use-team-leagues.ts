"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { activeLeagues, leagueErrorMessage, normalizeLeagueText, type League } from "@/lib/leagues";

/**
 * A team's leagues, archived ones included, and its season, which a new league
 * starts from. `create` adds one and returns it, or null after saying why not.
 */
export function useTeamLeagues(teamId: string) {
  const [supabase] = useState(() => createClient());
  const [leagues, setLeagues] = useState<League[]>([]);
  const [season, setSeason] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let current = true;
    void Promise.all([
      supabase.from("leagues").select("*").eq("team_id", teamId).order("season"),
      supabase.from("teams").select("season").eq("id", teamId).maybeSingle(),
    ]).then(([{ data }, { data: team }]) => {
      // A newer team's read may have started since.
      if (!current) return;
      setLeagues((data ?? []) as League[]);
      setSeason((team as { season?: string | null } | null)?.season ?? "");
      setLoaded(true);
    });
    return () => {
      current = false;
    };
  }, [supabase, teamId]);

  async function create(name: string, seasonText: string): Promise<League | null> {
    const row = {
      id: crypto.randomUUID(),
      team_id: teamId,
      name: normalizeLeagueText(name),
      season: normalizeLeagueText(seasonText),
    };
    const { error } = await supabase.from("leagues").insert(row);
    if (error) {
      toast.error(leagueErrorMessage(error));
      return null;
    }
    const created: League = { ...row, archived_at: null, created_at: new Date().toISOString(), created_by: null };
    setLeagues((prev) => [...prev, created]);
    return created;
  }

  return { leagues, active: activeLeagues(leagues), season, loaded, create, setLeagues };
}
