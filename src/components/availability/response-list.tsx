"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

type AvailabilityStatus = "available" | "maybe" | "unavailable";

interface Member {
  profileId: string;
  name: string;
}

interface AvailabilityRow {
  profileId: string;
  status: AvailabilityStatus;
}

const statusConfig = {
  available: { label: "Available", symbol: "✓", color: "text-green-700 dark:text-green-400" },
  maybe: { label: "Maybe", symbol: "?", color: "text-amber-600 dark:text-amber-400" },
  unavailable: { label: "Unavailable", symbol: "✗", color: "text-red-600 dark:text-red-400" },
};

function StatusBadge({ status }: { status: AvailabilityStatus | null }) {
  if (!status) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  const cfg = statusConfig[status];
  return (
    <span className={`text-sm font-semibold ${cfg.color}`} title={cfg.label}>
      {cfg.symbol}
    </span>
  );
}

function AdminStatusSelect({
  eventId,
  profileId,
  currentStatus,
  onStatusChange,
}: {
  eventId: string;
  profileId: string;
  currentStatus: AvailabilityStatus | null;
  onStatusChange: (profileId: string, newStatus: AvailabilityStatus | null) => void;
}) {
  const supabase = createClient();
  const [loading, setLoading] = useState(false);

  async function handleChange(value: string) {
    setLoading(true);
    const prev = currentStatus;

    if (value === "clear") {
      onStatusChange(profileId, null);
      const { error } = await supabase
        .from("availability")
        .delete()
        .eq("event_id", eventId)
        .eq("profile_id", profileId);
      if (error) {
        toast.error(error.message);
        onStatusChange(profileId, prev);
      }
    } else {
      const newStatus = value as AvailabilityStatus;
      onStatusChange(profileId, newStatus);
      const { error } = await supabase.from("availability").upsert(
        { event_id: eventId, profile_id: profileId, status: newStatus },
        { onConflict: "event_id,profile_id" }
      );
      if (error) {
        toast.error(error.message);
        onStatusChange(profileId, prev);
      }
    }

    setLoading(false);
  }

  return (
    <Select
      value={currentStatus ?? "clear"}
      onValueChange={handleChange}
      disabled={loading}
    >
      <SelectTrigger className="h-7 w-36 text-xs">
        <SelectValue placeholder="Set status" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="available">Available</SelectItem>
        <SelectItem value="maybe">Maybe</SelectItem>
        <SelectItem value="unavailable">Unavailable</SelectItem>
        <SelectItem value="clear">Clear response</SelectItem>
      </SelectContent>
    </Select>
  );
}

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
  const [statusMap, setStatusMap] = useState<Map<string, AvailabilityStatus | null>>(() => {
    const map = new Map<string, AvailabilityStatus | null>();
    for (const m of members) map.set(m.profileId, null);
    for (const r of initialRows) map.set(r.profileId, r.status);
    return map;
  });

  function handleStatusChange(profileId: string, newStatus: AvailabilityStatus | null) {
    setStatusMap((prev) => new Map(prev).set(profileId, newStatus));
  }

  // Group members by status
  const groups: Record<"available" | "maybe" | "unavailable" | "none", Member[]> = {
    available: [],
    maybe: [],
    unavailable: [],
    none: [],
  };

  for (const m of members) {
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

  function renderGroup(
    label: string,
    groupMembers: Member[],
    status: AvailabilityStatus | null
  ) {
    if (groupMembers.length === 0) return null;
    return (
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label} ({groupMembers.length})
        </p>
        <div className="space-y-1">
          {groupMembers.map((m) => (
            <div
              key={m.profileId}
              className="flex items-center justify-between py-0.5"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm">{m.name}</span>
                {!isAdmin && <StatusBadge status={status} />}
              </div>
              {isAdmin && m.profileId !== currentUserId && (
                <AdminStatusSelect
                  eventId={eventId}
                  profileId={m.profileId}
                  currentStatus={statusMap.get(m.profileId) ?? null}
                  onStatusChange={handleStatusChange}
                />
              )}
              {isAdmin && m.profileId === currentUserId && (
                <StatusBadge status={status} />
              )}
            </div>
          ))}
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
        {renderGroup("Available", groups.available, "available")}
        {renderGroup("Maybe", groups.maybe, "maybe")}
        {renderGroup("Unavailable", groups.unavailable, "unavailable")}
        {renderGroup("No response", groups.none, null)}
      </div>

      {members.length === 0 && (
        <p className="text-sm text-muted-foreground">No team members found.</p>
      )}
    </div>
  );
}
