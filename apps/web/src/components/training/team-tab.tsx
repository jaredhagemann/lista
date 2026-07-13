"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import {
  isCurrentPeriodOrLater,
  periodLabel,
  periodStartStr,
  stepAnchor,
  todayInTz,
  TRAINING_CATEGORY_LABELS,
  type LeaderboardPeriod,
  type TrainingCategory,
} from "@/lib/training";
import type { TrainingViewProps } from "./training-view";

type Player = {
  id: string;
  first_name: string;
  last_name: string | null;
  avatar_url: string | null;
  training_leaderboard_opt_out: boolean;
};
type Session = {
  id: string;
  profile_id: string;
  session_date: string;
  duration_minutes: number;
  category: TrainingCategory;
  notes: string | null;
};

function periodEnd(period: LeaderboardPeriod, start: string): string {
  const d = new Date(start + "T00:00:00Z");
  if (period === "week") d.setUTCDate(d.getUTCDate() + 7);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

export function TeamTab({ activeTeam }: TrainingViewProps) {
  const supabase = createClient();
  const today = todayInTz(activeTeam.timezone);

  const [period, setPeriod] = useState<LeaderboardPeriod>("week");
  const [anchor, setAnchor] = useState(today);
  const [players, setPlayers] = useState<Player[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const start = periodStartStr(period, anchor);
    const end = periodEnd(period, start);
    const [rosterRes, sessionRes] = await Promise.all([
      supabase
        .from("team_members")
        .select("profiles(id, first_name, last_name, avatar_url, training_leaderboard_opt_out)")
        .eq("team_id", activeTeam.id)
        .eq("role", "player"),
      supabase
        .from("training_sessions")
        .select("id, profile_id, session_date, duration_minutes, category, notes")
        .eq("team_id", activeTeam.id)
        .gte("session_date", start)
        .lt("session_date", end)
        .order("session_date", { ascending: false }),
    ]);
    setPlayers(((rosterRes.data ?? []).map((r) => r.profiles) as unknown as Player[]).filter(Boolean));
    setSessions((sessionRes.data as Session[]) ?? []);
    setLoading(false);
  }, [supabase, activeTeam.id, period, anchor]);

  useEffect(() => {
    void load(); // eslint-disable-line react-hooks/set-state-in-effect
  }, [load]);

  async function handleDelete(id: string) {
    const { error } = await supabase.from("training_sessions").delete().eq("id", id);
    if (error) {
      toast.error("Couldn't delete that entry.");
      return;
    }
    toast.success("Entry deleted");
    load();
  }

  const totals = new Map<string, { minutes: number; count: number }>();
  for (const s of sessions) {
    const t = totals.get(s.profile_id) ?? { minutes: 0, count: 0 };
    t.minutes += s.duration_minutes;
    t.count += 1;
    totals.set(s.profile_id, t);
  }
  const ranked = [...players].sort((a, b) => {
    const ta = totals.get(a.id)?.minutes ?? 0;
    const tb = totals.get(b.id)?.minutes ?? 0;
    if (tb !== ta) return tb - ta;
    return (a.last_name ?? "").localeCompare(b.last_name ?? "");
  });

  const atCurrent = isCurrentPeriodOrLater(period, anchor, today);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex rounded-md border p-0.5">
          {(["week", "month"] as const).map((p) => (
            <button
              key={p}
              onClick={() => {
                setPeriod(p);
                setAnchor(today);
              }}
              className={`rounded px-3 py-1 text-sm font-medium ${
                period === p ? "bg-accent text-accent-foreground" : "text-muted-foreground"
              }`}
            >
              {p === "week" ? "Week" : "Month"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => setAnchor(stepAnchor(period, anchor, -1))} aria-label="Previous period">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[9rem] text-center text-sm font-medium">{periodLabel(period, anchor)}</span>
          <Button variant="ghost" size="icon" disabled={atCurrent} onClick={() => setAnchor(stepAnchor(period, anchor, 1))} aria-label="Next period">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : ranked.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No players on this roster.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {ranked.map((p) => {
            const t = totals.get(p.id) ?? { minutes: 0, count: 0 };
            const isOpen = expanded === p.id;
            const playerSessions = sessions.filter((s) => s.profile_id === p.id);
            const name = `${p.first_name}${p.last_name ? " " + p.last_name : ""}`;
            return (
              <li key={p.id}>
                <button
                  className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent/50"
                  onClick={() => setExpanded(isOpen ? null : p.id)}
                >
                  <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? "" : "-rotate-90"}`} />
                  <span className="flex-1 truncate text-sm font-medium">
                    {name}
                    {p.training_leaderboard_opt_out && (
                      <Badge variant="outline" className="ml-2 align-middle text-[10px]">
                        hidden
                      </Badge>
                    )}
                  </span>
                  <span className={`text-sm font-semibold tabular-nums ${t.minutes === 0 ? "text-muted-foreground" : ""}`}>
                    {t.minutes} min
                  </span>
                  <span className="w-20 text-right text-xs text-muted-foreground tabular-nums">
                    {t.count} {t.count === 1 ? "session" : "sessions"}
                  </span>
                </button>
                {isOpen && (
                  <div className="bg-muted/30 px-10 py-2">
                    {playerSessions.length === 0 ? (
                      <p className="py-1 text-xs text-muted-foreground">No sessions this {period}.</p>
                    ) : (
                      <ul className="space-y-1">
                        {playerSessions.map((s) => (
                          <li key={s.id} className="flex items-center gap-3 text-sm">
                            <span className="w-20 shrink-0 tabular-nums text-muted-foreground">
                              {new Date(s.session_date + "T00:00:00Z").toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                                timeZone: "UTC",
                              })}
                            </span>
                            <span className="flex-1 min-w-0">
                              {TRAINING_CATEGORY_LABELS[s.category]} · {s.duration_minutes} min
                              {s.notes && <span className="ml-1 text-muted-foreground">— {s.notes}</span>}
                            </span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              aria-label="Delete entry"
                              onClick={() => handleDelete(s.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
