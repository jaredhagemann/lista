"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, ChevronRight, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { fetchEventPage, type EventCursor } from "@/lib/events/queries";
import {
  fetchResponsesForEvents,
  fetchTeamRoster,
  type RosterMember,
} from "@/lib/availability/queries";
import {
  AVAILABILITY_WINDOWS,
  newAnchor,
  windowLabel,
  windowRange,
  type AvailabilityWindow,
} from "@/lib/availability/window";

type AvailabilityStatus = "available" | "maybe" | "unavailable";
type EventType = "practice" | "game" | "other";

type MatrixEvent = {
  id: string;
  title: string;
  event_type: string;
  start_time: string;
};

/** What a cell knows. `undefined` is "not read yet", `null` is "no response". */
type CellStatus = AvailabilityStatus | null | undefined;

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

const eventTypeBadge: Record<string, string> = {
  practice: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  game: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  other: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
};

/**
 * A cell.
 *
 * "Not read yet" and "no response" are drawn differently on purpose: a dash for
 * a response that genuinely is not there, and a muted placeholder while the page
 * is still loading. Rendering an unread cell as "no response" is the defect this
 * whole ticket is about (BUG-014, spec §7.3).
 */
function StatusChip({ status }: { status: CellStatus }) {
  if (status === undefined) {
    return (
      <span
        className="inline-block h-5 w-7 animate-pulse rounded bg-muted align-middle"
        title="Loading"
        aria-label="Loading"
      />
    );
  }
  if (status === null) {
    return (
      <span
        className="inline-block rounded bg-muted px-2 py-0.5 text-sm leading-none text-muted-foreground"
        title="No response"
      >
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

const CYCLE: (AvailabilityStatus | null)[] = ["available", "maybe", "unavailable", null];

/**
 * Keeps whatever the reader changed on top of a freshly read page.
 *
 * A read that started before an edit would otherwise hand back the server's
 * older value and undo it on screen, seconds after the click (spec §7.3).
 */
function mergeMutations(
  fresh: Map<string, Map<string, AvailabilityStatus | null>>,
  current: Map<string, Map<string, AvailabilityStatus | null>>
) {
  const merged = new Map(fresh);
  for (const [eventId, inner] of current) {
    if (!merged.has(eventId)) continue;
    const target = new Map(merged.get(eventId)!);
    for (const [profileId, status] of inner) target.set(profileId, status);
    merged.set(eventId, target);
  }
  return merged;
}

export function AvailabilityMatrix({
  teamId,
  currentUserId,
  isAdmin,
  timeZone,
}: {
  teamId: string;
  /** The profile whose responses this session may edit. */
  currentUserId: string;
  isAdmin: boolean;
  timeZone?: string | null;
}) {
  const [supabase] = useState(() => createClient());

  // Frozen for the session: recomputing it between pages would slide the window
  // underneath the reader (spec §5).
  const [anchor, setAnchor] = useState(() => newAnchor());
  const [window_, setWindow] = useState<AvailabilityWindow>("upcoming");
  const [typeFilter, setTypeFilter] = useState<EventType | "all">("all");
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);

  const [events, setEvents] = useState<MatrixEvent[]>([]);
  const [members, setMembers] = useState<RosterMember[]>([]);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);

  // eventId → profileId → status. Only ever holds rows from a completed read
  // for the current identity; anything missing is "not read yet".
  const [statusMap, setStatusMap] = useState<Map<string, Map<string, AvailabilityStatus | null>>>(
    new Map()
  );

  const cursorHistory = useRef<(EventCursor | null)[]>([null]);
  const nextCursor = useRef<EventCursor | null>(null);
  const requestGeneration = useRef(0);
  // Bumped on every cell write, so a read that started earlier cannot undo it.
  const mutationGeneration = useRef(0);

  // Everything a page of this matrix depends on. A cursor, and a response map,
  // belong to exactly one of these.
  const identity = `${teamId}|${currentUserId}|${window_}|${typeFilter}|${pageSize}|${anchor}`;
  const loadedIdentity = useRef(identity);

  const range = useMemo(() => windowRange(window_, anchor), [window_, anchor]);

  useEffect(() => {
    if (loadedIdentity.current !== identity) {
      loadedIdentity.current = identity;
      cursorHistory.current = [null];
      nextCursor.current = null;
      // Events and responses are replaced together when the new read lands,
      // so the last complete result stays readable until then rather than
      // blanking (spec §7.3).
      if (page !== 1) {
        // Synchronous on purpose: a new range starts at its own first page, and
        // reading page three of a range nobody asked for would be wasted work.
        setPage(1); // eslint-disable-line react-hooks/set-state-in-effect
        return;
      }
    }

    const generation = ++requestGeneration.current;
    const mutationsAtStart = mutationGeneration.current;
    setLoading(true);
    setFailure(null);

    void (async () => {
      try {
        const eventPage = await fetchEventPage(supabase, {
          query: {
            teamId,
            fromInclusive: range.fromInclusive,
            toExclusive: range.toExclusive,
            eventType: typeFilter === "all" ? undefined : typeFilter,
            // Cancelled events stay visible here, as they always have. The
            // calendar hides them; changing that by accident is not this PR's
            // business (spec §7.1).
            includeCancelled: true,
          },
          pageSize,
          cursor: cursorHistory.current[page - 1] ?? null,
          projection: "calendar",
        });

        const displayed = eventPage.items;
        // Responses for what is on screen, and the roster, together: the page is
        // ready only when all three have succeeded (spec §7.1).
        const [responses, roster] = await Promise.all([
          fetchResponsesForEvents(
            supabase,
            displayed.map((e) => e.id)
          ),
          fetchTeamRoster(supabase, teamId),
        ]);

        if (generation !== requestGeneration.current) return;

        const map = new Map<string, Map<string, AvailabilityStatus | null>>();
        for (const event of displayed) map.set(event.id, new Map());
        for (const row of responses) {
          const inner = map.get(row.event_id) ?? new Map();
          inner.set(row.profile_id, row.status);
          map.set(row.event_id, inner);
        }

        setEvents(displayed);
        setMembers(roster);
        setHasNext(eventPage.hasNext);
        nextCursor.current = eventPage.nextCursor;
        // A cell edited while this read was in flight keeps its newer value.
        setStatusMap((current) =>
          mutationsAtStart === mutationGeneration.current ? map : mergeMutations(map, current)
        );
        setLoading(false);
      } catch (error) {
        if (generation !== requestGeneration.current) return;
        setFailure(error instanceof Error ? error.message : "Could not load availability");
        setLoading(false);
      }
    })();
  }, [identity, page, supabase, teamId, typeFilter, pageSize, range]);

  function restart() {
    cursorHistory.current = [null];
    nextCursor.current = null;
    setPage(1);
  }

  function statusFor(eventId: string, profileId: string): CellStatus {
    const inner = statusMap.get(eventId);
    if (!inner) return undefined;
    return inner.get(profileId) ?? null;
  }

  async function setCell(
    eventId: string,
    profileId: string,
    next: AvailabilityStatus | null,
    previous: AvailabilityStatus | null
  ) {
    const mutation = ++mutationGeneration.current;
    applyCell(eventId, profileId, next);

    const { error } =
      next === null
        ? await supabase
            .from("availability")
            .delete()
            .eq("event_id", eventId)
            .eq("profile_id", profileId)
        : await supabase
            .from("availability")
            .upsert(
              { event_id: eventId, profile_id: profileId, status: next },
              { onConflict: "event_id,profile_id" }
            );

    if (error) {
      toast.error(error.message);
      // Roll back this cell only: a newer edit elsewhere is none of its business.
      if (mutation === mutationGeneration.current) applyCell(eventId, profileId, previous);
    }
  }

  function applyCell(eventId: string, profileId: string, status: AvailabilityStatus | null) {
    setStatusMap((prev) => {
      const next = new Map(prev);
      const inner = new Map(next.get(eventId) ?? []);
      inner.set(profileId, status);
      next.set(eventId, inner);
      return next;
    });
  }

  const players = members.filter((m) => m.role === "player");
  const nonPlayers = members.filter((m) => m.role !== "player");

  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      {/* The only date filter. The matrix used to carry a second, hidden one
          that defaulted to "upcoming" and emptied the past window (spec §7.3). */}
      <div className="flex items-center gap-0.5 rounded-md border p-0.5">
        {AVAILABILITY_WINDOWS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={window_ === option.value}
            onClick={() => {
              setWindow(option.value);
              restart();
            }}
            className={`rounded px-3 py-1 text-sm transition-colors ${
              window_ === option.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <Select
        value={typeFilter}
        onValueChange={(v) => {
          setTypeFilter(v as EventType | "all");
          restart();
        }}
      >
        <SelectTrigger className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All types</SelectItem>
          <SelectItem value="practice">Practices</SelectItem>
          <SelectItem value="game">Games</SelectItem>
          <SelectItem value="other">Other</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={String(pageSize)}
        onValueChange={(v) => {
          setPageSize(Number(v));
          restart();
        }}
      >
        <SelectTrigger className="w-28">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {[5, 10, 15, 20].map((size) => (
            <SelectItem key={size} value={String(size)}>
              {size} events
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          // A refresh is a new question: new anchor, back to the first page.
          setAnchor(newAnchor());
          restart();
        }}
      >
        Refresh
      </Button>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Controls stay usable while loading and while showing an error. */}
      {controls}
      <p className="text-sm text-muted-foreground">{windowLabel(window_, anchor, timeZone)}</p>

      {failure && events.length === 0 ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div className="space-y-2">
              <p className="font-medium text-destructive">Couldn&apos;t load availability</p>
              <p className="text-sm text-muted-foreground">
                Responses are missing, and a missing response looks exactly like &ldquo;no
                reply&rdquo; — so nothing is shown rather than something misleading.
              </p>
              <Button variant="outline" size="sm" onClick={() => setAnchor(newAnchor())}>
                Try again
              </Button>
            </div>
          </div>
        </div>
      ) : !loading && events.length === 0 ? (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          <p>No events in this range.</p>
          <Link
            href="/dashboard/schedule"
            className="mt-1 inline-block text-sm underline-offset-4 hover:underline"
          >
            View schedule
          </Link>
        </div>
      ) : (
        <>
          {failure && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-muted-foreground">
                  <span className="font-medium text-destructive">Couldn&apos;t refresh.</span>{" "}
                  These responses were read earlier and may be out of date, so they cannot be
                  changed until a read succeeds.
                </p>
                <Button variant="outline" size="sm" onClick={() => setAnchor(newAnchor())}>
                  Try again
                </Button>
              </div>
            </div>
          )}
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-max min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="sticky left-0 z-10 min-w-[140px] bg-muted/50 px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Member
                    {loading && (
                      <Loader2 className="ml-2 inline size-3 animate-spin text-muted-foreground" />
                    )}
                  </th>
                  {events.map((event) => {
                    const at = new Date(event.start_time);
                    return (
                      <th key={event.id} className="min-w-[100px] px-3 py-3 text-center">
                        <Link href={`/dashboard/schedule/${event.id}`} className="block hover:underline">
                          <span className="block text-xs text-muted-foreground">
                            {at.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {at.toLocaleDateString("en-US", { weekday: "short" })}
                          </span>
                          <span
                            className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium capitalize ${
                              eventTypeBadge[event.event_type] ?? eventTypeBadge.other
                            }`}
                          >
                            {event.event_type}
                          </span>
                        </Link>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                <MemberRows
                  label="Players"
                  group={players}
                  events={events}
                  rowOffset={0}
                  currentUserId={currentUserId}
                  isAdmin={isAdmin}
                  stale={failure !== null}
                  statusFor={statusFor}
                  onSet={setCell}
                />
                {players.length > 0 && (
                  <tr className="border-t">
                    <td className="sticky left-0 z-10 bg-muted/30 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Total Available
                    </td>
                    {events.map((event) => {
                      const counted = players.filter(
                        (p) => statusFor(event.id, p.profileId) === "available"
                      ).length;
                      return (
                        <td
                          key={event.id}
                          className="bg-muted/30 px-3 py-2 text-center text-sm font-semibold text-muted-foreground"
                        >
                          {loading ? "—" : counted}
                        </td>
                      );
                    })}
                  </tr>
                )}
                <MemberRows
                  label="Staff"
                  group={nonPlayers}
                  events={events}
                  rowOffset={players.length}
                  currentUserId={currentUserId}
                  isAdmin={isAdmin}
                  stale={failure !== null}
                  statusFor={statusFor}
                  onSet={setCell}
                />
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
            <span>Page {page}</span>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              aria-label="Previous events"
              disabled={page === 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              aria-label="More events"
              disabled={!hasNext || loading}
              onClick={() => {
                cursorHistory.current[page] = nextCursor.current;
                setPage((p) => p + 1);
              }}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function MemberRows({
  label,
  group,
  events,
  rowOffset,
  currentUserId,
  isAdmin,
  stale,
  statusFor,
  onSet,
}: {
  label: string;
  group: RosterMember[];
  events: MatrixEvent[];
  rowOffset: number;
  currentUserId: string;
  isAdmin: boolean;
  stale: boolean;
  statusFor: (eventId: string, profileId: string) => CellStatus;
  onSet: (
    eventId: string,
    profileId: string,
    next: AvailabilityStatus | null,
    previous: AvailabilityStatus | null
  ) => void;
}) {
  if (group.length === 0) return null;

  return (
    <>
      <tr>
        <td
          colSpan={events.length + 1}
          className="sticky left-0 bg-muted/50 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {label}
        </td>
      </tr>
      {group.map((member, i) => {
        const rowIdx = rowOffset + i;
        const isCurrentUser = member.profileId === currentUserId;
        const striped = rowIdx % 2 === 0 ? "bg-background" : "bg-muted/20";

        return (
          <tr key={member.profileId} className={striped}>
            <td className={`sticky left-0 z-10 px-4 py-2 font-medium ${striped}`}>
              <span>{member.name}</span>
              {isCurrentUser && <span className="ml-1 text-xs text-muted-foreground">(you)</span>}
            </td>
            {events.map((event) => {
              const status = statusFor(event.id, member.profileId);
              // Eligibility is decided when the row renders, not once at import.
              const isPast = new Date(event.start_time) < new Date();
              // Editable while a refresh is in flight: what is on screen came
              // from a complete read, and an edit made now keeps its newer
              // value when that read lands. Not editable once a read has
              // failed, because the values shown may no longer be true.
              const editable =
                (isCurrentUser || isAdmin) && !isPast && !stale && status !== undefined;

              return (
                <td key={event.id} className="px-3 py-2 text-center" data-cell={`${event.id}:${member.profileId}`}>
                  {editable ? (
                    <button
                      className="cursor-pointer transition-opacity hover:opacity-70"
                      title="Click to cycle availability"
                      onClick={() => {
                        const current = (status ?? null) as AvailabilityStatus | null;
                        const next = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length];
                        onSet(event.id, member.profileId, next, current);
                      }}
                    >
                      <StatusChip status={status} />
                    </button>
                  ) : (
                    <StatusChip status={status} />
                  )}
                </td>
              );
            })}
          </tr>
        );
      })}
    </>
  );
}
