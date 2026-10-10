"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { leagueLabel, type League } from "@/lib/leagues";

const SELECT_CLASS =
  "border-input bg-transparent dark:bg-input/30 h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

const NEW = "__new__";

/**
 * A game's league: the team's active leagues, plus "Add league…" to make one on
 * the spot (docs/specs/tournaments-and-leagues.md §5). An archived league the
 * game is already in stays listed, marked, so saving the form keeps it.
 *
 * A native select: one of these per game row in the tournament form.
 */
export function LeaguePicker({
  id,
  label = "League",
  value,
  onChange,
  leagues,
  defaultSeason,
  onCreate,
}: {
  id: string;
  label?: string;
  /** A league id, or "" for none. */
  value: string;
  onChange: (leagueId: string) => void;
  /** All the team's leagues, archived included. */
  leagues: League[];
  /** A new league's season to start from: the team's. */
  defaultSeason: string;
  onCreate: (name: string, season: string) => Promise<League | null>;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [season, setSeason] = useState("");
  const [saving, setSaving] = useState(false);

  const offered = leagues
    .filter((l) => !l.archived_at || l.id === value)
    .sort((a, b) => leagueLabel(a).localeCompare(leagueLabel(b)));

  async function add() {
    if (!name.trim() || !(season || defaultSeason).trim()) return;
    setSaving(true);
    const created = await onCreate(name, season || defaultSeason);
    setSaving(false);
    if (!created) return;
    onChange(created.id);
    setAdding(false);
    setName("");
    setSeason("");
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        className={SELECT_CLASS}
        value={adding ? NEW : value}
        onChange={(e) => {
          if (e.target.value === NEW) {
            setAdding(true);
            setSeason(defaultSeason);
          } else {
            setAdding(false);
            onChange(e.target.value);
          }
        }}
      >
        <option value="">No league</option>
        {offered.map((l) => (
          <option key={l.id} value={l.id}>
            {leagueLabel(l)}
            {l.archived_at ? " (archived)" : ""}
          </option>
        ))}
        <option value={NEW}>+ Add league…</option>
      </select>
      {adding && (
        <div className="grid grid-cols-[1fr_8rem] gap-2 rounded-md border p-2">
          <div className="space-y-1">
            <Label htmlFor={`${id}-new-name`} className="text-xs">
              New league name
            </Label>
            <Input id={`${id}-new-name`} placeholder="e.g. Division 3" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-new-season`} className="text-xs">
              New league season
            </Label>
            <Input id={`${id}-new-season`} placeholder="e.g. Fall 2026" value={season} onChange={(e) => setSeason(e.target.value)} />
          </div>
          <div className="col-span-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button type="button" size="sm" disabled={saving || !name.trim()} onClick={add}>
              Add this league
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
