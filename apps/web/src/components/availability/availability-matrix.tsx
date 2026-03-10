"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";

type AvailabilityStatus = "available" | "maybe" | "unavailable";
type EventType = "practice" | "game" | "other";
type TimeFilter = "upcoming" | "all";

interface MatrixEvent {
  id: string;
  title: string;
  event_type: EventType;
  start_time: string;
}

interface Member {
  profileId: string;
  name: string;
  role: string;
}

interface AvailabilityRow {
  event_id: string;
  profile_id: string;
  status: AvailabilityStatus;
}

const statusConfig: Record<
  AvailabilityStatus,
  { label: string; symbol: string; bg: string; text: string }
> = {
  available: {
    label: "Available",
    symbol: "✓",
    bg: "bg-green-100 dark:bg-green-900/40",
    text: "text-green-800 dark:text-green-300",
  },
  maybe: {
    label: "Maybe",
    symbol: "?",
    bg: "bg-amber-100 dark:bg-amber-900/40",
    text: "text-amber-800 dark:text-amber-300",
  },
  unavailable: {
    label: "Unavailable",
    symbol: "✗",
    bg: "bg-red-100 dark:bg-red-900/40",
    text: "text-red-800 dark:text-red-300",
  },
};

const eventTypeBadge: Record<EventType, string> = {
  practice: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  game: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  other: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
};

function StatusChip({ status }: { status: AvailabilityStatus | null }) {
  if (!status) {
    return (
      <span className="inline-block rounded px-2 py-0.5 text-sm leading-none bg-muted text-muted-foreground" title="No response">
        —
      </span>
    );
  }
  const cfg = statusConfig[status];
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-sm leading-none font-semibold ${cfg.bg} ${cfg.text}`}
      title={cfg.label}
    >
      {cfg.symbol}
    </span>
  );
}

function SelfCell({
  eventId,
  profileId,
  currentStatus,
  onStatusChange,
}: {
  eventId: string;
  profileId: string;
  currentStatus: AvailabilityStatus | null;
  onStatusChange: (eventId: string, profileId: string, status: AvailabilityStatus | null) => void;
}) {
  const supabase = createClient();
  const [loading, setLoading] = useState(false);

  const cycle: (AvailabilityStatus | null)[] = ["available", "maybe", "unavailable", null];

  async function handleClick() {
    if (loading) return;
    setLoading(true);
    const prev = currentStatus;
    const currentIdx = cycle.indexOf(currentStatus);
    const next = cycle[(currentIdx + 1) % cycle.length];

    onStatusChange(eventId, profileId, next);

    let error;
    if (next === null) {
      ({ error } = await supabase
        .from("availability")
        .delete()
        .eq("event_id", eventId)
        .eq("profile_id", profileId));
    } else {
      ({ error } = await supabase.from("availability").upsert(
        { event_id: eventId, profile_id: profileId, status: next },
        { onConflict: "event_id,profile_id" }
      ));
    }

    if (error) {
      toast.error(error.message);
      onStatusChange(eventId, profileId, prev);
    }

    setLoading(false);
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="cursor-pointer hover:opacity-70 transition-opacity disabled:opacity-50"
      title="Click to cycle your availability"
    >
      <StatusChip status={currentStatus} />
    </button>
  );
}

const now = new Date();

export function AvailabilityMatrix({
  events,
  members,
  initialRows,
  isAdmin,
  currentUserId,
}: {
  events: MatrixEvent[];
  members: Member[];
  initialRows: AvailabilityRow[];
  isAdmin: boolean;
  currentUserId: string;
}) {
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("upcoming");
  const [typeFilter, setTypeFilter] = useState<EventType | "all">("all");
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [bulkPending, setBulkPending] = useState<AvailabilityStatus | null>(null);

  // statusMap: eventId -> profileId -> status
  const [statusMap, setStatusMap] = useState<Map<string, Map<string, AvailabilityStatus | null>>>(
    () => {
      const map = new Map<string, Map<string, AvailabilityStatus | null>>();
      for (const row of initialRows) {
        if (!map.has(row.event_id)) map.set(row.event_id, new Map());
        map.get(row.event_id)!.set(row.profile_id, row.status);
      }
      return map;
    }
  );

  function handleStatusChange(
    eventId: string,
    profileId: string,
    status: AvailabilityStatus | null
  ) {
    setStatusMap((prev) => {
      const next = new Map(prev);
      if (!next.has(eventId)) next.set(eventId, new Map());
      const inner = new Map(next.get(eventId)!);
      inner.set(profileId, status);
      next.set(eventId, inner);
      return next;
    });
  }

  const filteredEvents = events.filter((e) => {
    const eventDate = new Date(e.start_time);
    if (timeFilter === "upcoming" && eventDate < now) return false;
    if (typeFilter !== "all" && e.event_type !== typeFilter) return false;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filteredEvents.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pagedEvents = filteredEvents.slice((safePage - 1) * pageSize, safePage * pageSize);

  function applyTimeFilter(v: TimeFilter) { setTimeFilter(v); setCurrentPage(1); }
  function applyTypeFilter(v: EventType | "all") { setTypeFilter(v); setCurrentPage(1); }
  function applyPageSize(v: number) { setPageSize(v); setCurrentPage(1); }

  // Bulk-set: all future events where the current user has no response
  const futureUncheckedEvents = events.filter(
    (e) =>
      new Date(e.start_time) >= now &&
      (statusMap.get(e.id)?.get(currentUserId) ?? null) === null
  );

  async function handleBulkConfirm() {
    if (!bulkPending) return;
    const status = bulkPending;
    setBulkPending(null);

    const rows = futureUncheckedEvents.map((e) => ({
      event_id: e.id,
      profile_id: currentUserId,
      status,
    }));
    if (rows.length === 0) return;

    // Optimistic update
    setStatusMap((prev) => {
      const next = new Map(prev);
      for (const e of futureUncheckedEvents) {
        const inner = new Map(next.get(e.id) ?? []);
        inner.set(currentUserId, status);
        next.set(e.id, inner);
      }
      return next;
    });

    const supabase = createClient();
    const { error } = await supabase
      .from("availability")
      .upsert(rows, { onConflict: "event_id,profile_id" });

    if (error) {
      toast.error(error.message);
      // Roll back optimistic update
      setStatusMap((prev) => {
        const next = new Map(prev);
        for (const e of futureUncheckedEvents) {
          const inner = new Map(next.get(e.id) ?? []);
          inner.set(currentUserId, null);
          next.set(e.id, inner);
        }
        return next;
      });
    } else {
      toast.success(`Set to ${statusConfig[status].label} for ${rows.length} event${rows.length === 1 ? "" : "s"}`);
    }
  }

  if (filteredEvents.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex gap-2 flex-wrap">
          <Filters
            timeFilter={timeFilter}
            setTimeFilter={applyTimeFilter}
            typeFilter={typeFilter}
            setTypeFilter={applyTypeFilter}
            pageSize={pageSize}
            setPageSize={applyPageSize}
          />
        </div>
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          <p>No events found.</p>
          <Link
            href="/dashboard/schedule"
            className="text-sm underline-offset-4 hover:underline mt-1 inline-block"
          >
            View schedule
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        <Filters
          timeFilter={timeFilter}
          setTimeFilter={applyTimeFilter}
          typeFilter={typeFilter}
          setTypeFilter={applyTypeFilter}
          pageSize={pageSize}
          setPageSize={applyPageSize}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-max min-w-full border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              {/* Sticky name column header */}
              <th className="sticky left-0 z-10 bg-muted/50 px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide min-w-[140px]">
                Member
              </th>
              {pagedEvents.map((e) => {
                const d = new Date(e.start_time);
                return (
                  <th
                    key={e.id}
                    className="px-3 py-3 text-center min-w-[100px]"
                  >
                    <Link
                      href={`/dashboard/schedule/${e.id}`}
                      className="hover:underline block"
                    >
                      <span className="block text-xs text-muted-foreground">
                        {d.toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {d.toLocaleDateString("en-US", { weekday: "short" })}
                      </span>
                      <span
                        className={`inline-block mt-1 rounded px-1.5 py-0.5 text-[10px] font-medium capitalize ${eventTypeBadge[e.event_type]}`}
                      >
                        {e.event_type}
                      </span>
                    </Link>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {(() => {
              const players = members.filter((m) => m.role === "player");
              const nonPlayers = members.filter((m) => m.role !== "player");

              function renderMemberRows(group: Member[], rowOffset: number) {
                return group.map((member, i) => {
                  const rowIdx = rowOffset + i;
                  const isCurrentUser = member.profileId === currentUserId;
                  return (
                    <tr
                      key={member.profileId}
                      className={rowIdx % 2 === 0 ? "bg-background" : "bg-muted/20"}
                    >
                      <td
                        className={`sticky left-0 z-10 px-4 py-2 font-medium ${
                          rowIdx % 2 === 0 ? "bg-background" : "bg-muted/20"
                        }`}
                      >
                        <div>
                          <span>{member.name}</span>
                          {isCurrentUser && (
                            <span className="ml-1 text-xs text-muted-foreground">(you)</span>
                          )}
                        </div>
                        {isCurrentUser && (
                          <div className="flex items-center gap-1 mt-1">
                            <span className="text-xs text-muted-foreground">Set multiple:</span>
                            {(["available", "maybe", "unavailable"] as AvailabilityStatus[]).map((s) => (
                              <button
                                key={s}
                                onClick={() => setBulkPending(s)}
                                title={statusConfig[s].label}
                                className={`text-xs font-semibold rounded px-1.5 py-0.5 ${statusConfig[s].bg} ${statusConfig[s].text} hover:opacity-75 transition-opacity`}
                              >
                                {statusConfig[s].symbol}
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                      {pagedEvents.map((e) => {
                        const status = statusMap.get(e.id)?.get(member.profileId) ?? null;
                        const isPast = new Date(e.start_time) < now;

                        if ((isCurrentUser || isAdmin) && !isPast) {
                          return (
                            <td key={e.id} className="px-3 py-2 text-center">
                              <SelfCell
                                eventId={e.id}
                                profileId={member.profileId}
                                currentStatus={status}
                                onStatusChange={handleStatusChange}
                              />
                            </td>
                          );
                        }

                        return (
                          <td key={e.id} className="px-3 py-2 text-center">
                            <StatusChip status={status} />
                          </td>
                        );
                      })}
                    </tr>
                  );
                });
              }

              return (
                <>
                  {players.length > 0 && (
                    <>
                      <tr>
                        <td
                          colSpan={pagedEvents.length + 1}
                          className="sticky left-0 bg-muted/50 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                        >
                          Players
                        </td>
                      </tr>
                      {renderMemberRows(players, 0)}
                    </>
                  )}
                  {nonPlayers.length > 0 && (
                    <>
                      <tr>
                        <td
                          colSpan={pagedEvents.length + 1}
                          className="sticky left-0 bg-muted/50 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground border-t"
                        >
                          Staff
                        </td>
                      </tr>
                      {renderMemberRows(nonPlayers, players.length)}
                    </>
                  )}
                </>
              );
            })()}
          </tbody>
        </table>
      </div>

      {/* Bulk-set confirmation */}
      <AlertDialog open={bulkPending !== null} onOpenChange={(open) => !open && setBulkPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Set availability for multiple events?</AlertDialogTitle>
            <AlertDialogDescription>
              {bulkPending && (
                <>
                  This will mark you as{" "}
                  <span className={`font-semibold ${statusConfig[bulkPending].text}`}>
                    {statusConfig[bulkPending].label}
                  </span>{" "}
                  for{" "}
                  <span className="font-semibold">{futureUncheckedEvents.length} upcoming event{futureUncheckedEvents.length === 1 ? "" : "s"}</span>{" "}
                  where you haven&apos;t responded yet. Events where you&apos;ve already set a response won&apos;t be changed.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkConfirm}>
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Pagination footer */}
      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
          <span>
            Page {safePage} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            disabled={safePage === 1}
            onClick={() => setCurrentPage((p) => p - 1)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            disabled={safePage === totalPages}
            onClick={() => setCurrentPage((p) => p + 1)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

function Filters({
  timeFilter,
  setTimeFilter,
  typeFilter,
  setTypeFilter,
  pageSize,
  setPageSize,
}: {
  timeFilter: TimeFilter;
  setTimeFilter: (v: TimeFilter) => void;
  typeFilter: EventType | "all";
  setTypeFilter: (v: EventType | "all") => void;
  pageSize: number;
  setPageSize: (v: number) => void;
}) {
  return (
    <>
      <Select value={timeFilter} onValueChange={(v) => setTimeFilter(v as TimeFilter)}>
        <SelectTrigger className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="upcoming">Upcoming</SelectItem>
          <SelectItem value="all">All events</SelectItem>
        </SelectContent>
      </Select>

      <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as EventType | "all")}>
        <SelectTrigger className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All types</SelectItem>
          <SelectItem value="practice">Practice</SelectItem>
          <SelectItem value="game">Game</SelectItem>
          <SelectItem value="other">Other</SelectItem>
        </SelectContent>
      </Select>

      <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
        <SelectTrigger className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Array.from({ length: 16 }, (_, i) => i + 5).map((n) => (
            <SelectItem key={n} value={String(n)}>
              {n} per page
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
