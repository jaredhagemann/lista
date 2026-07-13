"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  isCurrentPeriodOrLater,
  periodLabel,
  stepAnchor,
  todayInTz,
  type LeaderboardPeriod,
  type LeaderboardScope,
} from "@/lib/training";
import type { TrainingViewProps } from "./training-view";

type BoardRow = {
  profile_id: string;
  display_name: string;
  avatar_url: string | null;
  team_id: string | null;
  team_name: string | null;
  total_minutes: number;
  session_count: number;
  rank: number;
};
type SummaryRow = {
  total_minutes: number;
  session_count: number;
  rank: number | null;
  denominator: number;
};

export function LeaderboardTab({
  viewerId,
  activeProfile,
  activeTeam,
  org,
  orgTeams,
  onGoToMyTraining,
}: TrainingViewProps & { onGoToMyTraining: () => void }) {
  const supabase = createClient();
  const today = todayInTz(activeTeam.timezone);

  const [scope, setScope] = useState<LeaderboardScope>("team");
  const [period, setPeriod] = useState<LeaderboardPeriod>("week");
  const [anchor, setAnchor] = useState(today);
  const [clubTeamFilter, setClubTeamFilter] = useState<string>("all");
  const [rows, setRows] = useState<BoardRow[]>([]);
  const [summary, setSummary] = useState<SummaryRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const filterTeam = scope === "club" && clubTeamFilter !== "all" ? clubTeamFilter : null;
    // Nullable params are omitted rather than passed as null (they carry SQL
    // defaults) so the args satisfy the generated non-null RPC types.
    const boardArgs =
      scope === "team"
        ? { p_scope: "team" as const, p_team_id: activeTeam.id, p_period: period, p_anchor: anchor }
        : {
            p_scope: "club" as const,
            p_org_id: org.id,
            p_period: period,
            p_anchor: anchor,
            ...(filterTeam ? { p_team_id: filterTeam } : {}),
          };
    const summaryArgs = { ...boardArgs, p_profile_id: activeProfile.id };

    const [boardRes, summaryRes] = await Promise.all([
      supabase.rpc("training_leaderboard", boardArgs),
      supabase.rpc("training_summary", summaryArgs),
    ]);

    if (boardRes.error) {
      setError(boardRes.error.message);
      setRows([]);
    } else {
      setRows((boardRes.data as BoardRow[]) ?? []);
    }
    setSummary(summaryRes.error ? null : ((summaryRes.data as SummaryRow[])?.[0] ?? null));
    setLoading(false);
  }, [supabase, scope, period, anchor, clubTeamFilter, activeTeam.id, org.id, activeProfile.id]);

  useEffect(() => {
    void load(); // eslint-disable-line react-hooks/set-state-in-effect
  }, [load]);

  const atCurrent = isCurrentPeriodOrLater(period, anchor, today);
  const noneLogged = !summary || summary.total_minutes === 0;

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-md border p-0.5">
          {(["team", "club"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className={`rounded px-3 py-1 text-sm font-medium ${
                scope === s ? "bg-accent text-accent-foreground" : "text-muted-foreground"
              }`}
            >
              {s === "team" ? "My Team" : "Club"}
            </button>
          ))}
        </div>

        {scope === "club" && (
          <Select value={clubTeamFilter} onValueChange={setClubTeamFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All teams" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All teams</SelectItem>
              {orgTeams.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

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
      </div>

      {/* Period stepper */}
      <div className="flex items-center justify-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setAnchor(stepAnchor(period, anchor, -1))} aria-label="Previous period">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-[9rem] text-center text-sm font-medium">{periodLabel(period, anchor)}</span>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setAnchor(stepAnchor(period, anchor, 1))}
          disabled={atCurrent}
          aria-label="Next period"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Header: your standing */}
      <Card>
        <CardContent className="py-4">
          {activeProfile.optedOut ? (
            <p className="text-sm">
              You&apos;re hidden from this leaderboard —{" "}
              <a href="/dashboard/settings?tab=account" className="underline">
                change in Settings
              </a>
              .
              {summary && (
                <span className="ml-1 text-muted-foreground">
                  You: {summary.total_minutes} min · {summary.session_count} sessions
                </span>
              )}
            </p>
          ) : noneLogged ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                You haven&apos;t logged training this {period}.
              </p>
              <Button size="sm" variant="secondary" onClick={onGoToMyTraining}>
                Log a session →
              </Button>
            </div>
          ) : (
            <p className="text-sm font-medium">
              You: {summary!.total_minutes} min · {summary!.session_count} sessions
              {summary!.rank != null && (
                <span className="text-muted-foreground"> · #{summary!.rank} of {summary!.denominator}</span>
              )}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Ranked list */}
      {error ? (
        <p className="text-sm text-destructive">Couldn&apos;t load the leaderboard.</p>
      ) : loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No training logged this {period} yet. Be the first.
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {rows.map((r) => {
            const isSelf = r.profile_id === activeProfile.id || r.profile_id === viewerId;
            return (
              <li
                key={r.profile_id + (r.team_id ?? "")}
                className={`flex items-center gap-3 px-3 py-2 ${isSelf ? "bg-accent/50" : ""}`}
              >
                <span className="w-6 text-center text-sm font-semibold tabular-nums text-muted-foreground">
                  {r.rank}
                </span>
                <Avatar className="h-8 w-8">
                  {r.avatar_url && <AvatarImage src={r.avatar_url} alt={r.display_name} />}
                  <AvatarFallback className="text-xs">
                    {r.display_name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="flex-1 truncate text-sm font-medium">
                  {r.display_name}
                  {isSelf && <Badge variant="secondary" className="ml-2 align-middle">You</Badge>}
                </span>
                <span className="text-sm font-semibold tabular-nums">{r.total_minutes} min</span>
                <span className="w-16 text-right text-xs text-muted-foreground tabular-nums">
                  {r.session_count} {r.session_count === 1 ? "session" : "sessions"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
