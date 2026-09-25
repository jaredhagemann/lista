"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import {
  AVAILABILITY,
  AvailabilityPicker,
  nextAvailability,
  saveAvailability,
  type AvailabilityStatus,
} from "./availability-picker";

interface Member {
  profileId: string;
  name: string;
  /** Roster role. Only players count toward the responses; everyone else is staff. */
  role?: string | null;
}

const isPlayer = (m: Member) => (m.role ?? "player") === "player";
const roleLabel = (role: string | null | undefined) =>
  role ? role.charAt(0).toUpperCase() + role.slice(1) : "Staff";

interface AvailabilityRow {
  profileId: string;
  status: AvailabilityStatus;
}

/**
 * A read-only answer, in a fixed-width slot so every name starts in the same
 * place: ✓ ? ✗, or a dash for no response.
 */
function StatusIcon({ status }: { status: AvailabilityStatus | null }) {
  if (!status) {
    return (
      <span aria-label="No response" className="w-5 shrink-0 text-center text-sm text-muted-foreground">
        —
      </span>
    );
  }
  const cfg = AVAILABILITY[status];
  return (
    <span
      aria-label={cfg.label}
      title={cfg.label}
      className={`w-5 shrink-0 text-center text-sm font-semibold ${cfg.icon}`}
    >
      {cfg.symbol}
    </span>
  );
}

/**
 * Players' answers, grouped by answer: what a coach glances at to see whether
 * there are enough for the game. Each row leads with its answer, then the name.
 * A coach answers for a player with the same ✓ ? ✗ picker as "Your
 * availability"; a changed row moves to its new group at once, and tapping the
 * chosen answer again clears it.
 *
 * Everyone else on the roster (coaches, managers, directors, parents) is listed
 * below in a compact "Coaches & staff" section, read-only for everyone: staff
 * answer for themselves in "Your availability". The counts are players only.
 */
export function ResponseList({
  eventId,
  members,
  initialRows,
  isAdmin,
  currentUserId,
}: {
  eventId: string;
  members: Member[];
  initialRows: AvailabilityRow[];
  isAdmin: boolean;
  currentUserId: string;
}) {
  const supabase = createClient();
  const [statusMap, setStatusMap] = useState<Map<string, AvailabilityStatus | null>>(() => {
    const map = new Map<string, AvailabilityStatus | null>();
    for (const m of members) map.set(m.profileId, null);
    for (const r of initialRows) map.set(r.profileId, r.status);
    return map;
  });
  const [saving, setSaving] = useState<Set<string>>(new Set());

  function setStatus(profileId: string, status: AvailabilityStatus | null) {
    setStatusMap((prev) => new Map(prev).set(profileId, status));
  }

  async function answerFor(profileId: string, clicked: AvailabilityStatus) {
    const previous = statusMap.get(profileId) ?? null;
    const next = nextAvailability(previous, clicked);

    setSaving((prev) => new Set(prev).add(profileId));
    setStatus(profileId, next);
    const { error } = await saveAvailability(supabase, eventId, profileId, next);
    if (error) {
      toast.error(error.message);
      setStatus(profileId, previous);
    }
    setSaving((prev) => {
      const rest = new Set(prev);
      rest.delete(profileId);
      return rest;
    });
  }

  // Group members by status
  const groups: Record<"available" | "maybe" | "unavailable" | "none", Member[]> = {
    available: [],
    maybe: [],
    unavailable: [],
    none: [],
  };

  const players = members.filter(isPlayer);
  const staff = members.filter((m) => !isPlayer(m));

  for (const m of players) {
    const s = statusMap.get(m.profileId) ?? null;
    if (s === "available") groups.available.push(m);
    else if (s === "maybe") groups.maybe.push(m);
    else if (s === "unavailable") groups.unavailable.push(m);
    else groups.none.push(m);
  }

  const counts = {
    available: groups.available.length,
    maybe: groups.maybe.length,
    unavailable: groups.unavailable.length,
  };

  const summary = [
    counts.available > 0 && `${counts.available} available`,
    counts.maybe > 0 && `${counts.maybe} maybe`,
    counts.unavailable > 0 && `${counts.unavailable} unavailable`,
  ]
    .filter(Boolean)
    .join(" · ");

  function renderGroup(key: keyof typeof groups, label: string, groupMembers: Member[]) {
    if (groupMembers.length === 0) return null;
    return (
      <div className="space-y-1" data-group={key}>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label} ({groupMembers.length})
        </p>
        <div className="space-y-1">
          {groupMembers.map((m) => {
            const status = statusMap.get(m.profileId) ?? null;
            return (
              <div key={m.profileId} data-member-row className="flex items-center gap-3 py-0.5">
                {/* Your own answer is set only in "Your availability". */}
                {isAdmin && m.profileId !== currentUserId ? (
                  <AvailabilityPicker
                    compact
                    label={`Availability for ${m.name}`}
                    status={status}
                    disabled={saving.has(m.profileId)}
                    onChoose={(clicked) => answerFor(m.profileId, clicked)}
                  />
                ) : (
                  <StatusIcon status={status} />
                )}
                <span className="min-w-0 truncate text-sm">{m.name}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Responses</p>
        {summary && (
          <p className="text-xs text-muted-foreground">{summary}</p>
        )}
      </div>

      <div className="space-y-4">
        {renderGroup("available", "Available", groups.available)}
        {renderGroup("maybe", "Maybe", groups.maybe)}
        {renderGroup("unavailable", "Unavailable", groups.unavailable)}
        {renderGroup("none", "No response", groups.none)}
      </div>

      {players.length === 0 && (
        <p className="text-sm text-muted-foreground">No players on this team yet.</p>
      )}

      {staff.length > 0 && (
        <section aria-label="Coaches & staff" data-group="staff" className="space-y-1 border-t pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Coaches &amp; staff ({staff.length})
          </p>
          {staff.map((m) => (
            <div key={m.profileId} data-member-row className="flex items-center gap-3 text-xs">
              <StatusIcon status={statusMap.get(m.profileId) ?? null} />
              <span className="min-w-0 truncate">{m.name}</span>
              <span className="text-muted-foreground">{roleLabel(m.role)}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
