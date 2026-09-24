import { RRule, RRuleSet, type Weekday } from "rrule";
import type { Database } from "@/types/database";
import { instantFromWallClock, isUsableTimeZone, wallClockIn } from "@/lib/events/event-timezone";
import { expansionOptions, ruleTimeZone } from "@/lib/utils/rrule";

/**
 * Planning edits to a recurring series (BUG-009, decision D4).
 *
 * A series is a head event carrying `recurrence_rule`, plus child occurrences
 * pointing at it through `parent_event_id`. Editing used to delete every child
 * and re-insert fresh rows, losing availability, results and cancellations and
 * rewriting past events.
 *
 * planSeriesEdit decides, without touching the database, what an edit does:
 *   - only upcoming occurrences from the anchor onward are affected; past ones
 *     are never rewritten
 *   - affected occurrences keep their ids and are updated in place
 *   - individually cancelled or rescheduled occurrences are left alone
 *   - dates dropped from the pattern are cancelled, not deleted
 *   - dates added to the pattern become new occurrences with no history
 *   - the series is split at the anchor: earlier occurrences stay in the old
 *     series (its rule now ends before the anchor), affected ones move under a
 *     new head
 * The database applies the plan in one transaction (`apply_series_edit`).
 *
 * Times are wall-clock times in the series' own zone (BUG-010, D5), never the
 * editing device's, so a series keeps its local clock time across daylight
 * saving wherever the coach is. Recurrence rules follow the rrule library's
 * convention: a wall-clock time labeled as UTC.
 */

type EventRow = Database["public"]["Tables"]["events"]["Row"];

/** Fields a bulk edit may change. Results and scores are only ever edited one event at a time. */
export const BULK_EDITABLE_FIELDS = [
  "title",
  "event_type",
  "location_id",
  "notes",
  "opponent",
  "home_away",
  "uniform",
  "arrival_time",
  "timezone",
] as const;
export type BulkEditableField = (typeof BULK_EDITABLE_FIELDS)[number];
export type BulkFields = Partial<Pick<EventRow, BulkEditableField>>;

export type SeriesEditScope = "following" | "series";

export interface SeriesPattern {
  frequency: "weekly" | "biweekly";
  /** rrule weekday convention: 0 = Monday … 6 = Sunday. */
  daysOfWeek: number[];
  /** Last day of the series, inclusive (YYYY-MM-DD). */
  untilDate: string;
}

export interface SeriesEditInput {
  /** Every occurrence of the series, head included. */
  occurrences: EventRow[];
  /** The occurrence the user opened. */
  openedId: string;
  scope: SeriesEditScope;
  now: Date;
  /** Only the fields that changed. */
  fields: BulkFields;
  /**
   * The zone to fall back on when neither the rule nor the head names one: the
   * team's, else the viewer's. Never the opened occurrence's — see seriesTimeZone.
   */
  timeZone: string;
  /** A new zone for the series, when it changed. Occurrences keep their local clock time in it. */
  newTimeZone?: string;
  /** New time of day ("HH:mm"), when it changed. */
  time?: { start: string; end: string };
  /** New repeat pattern, when it changed. */
  pattern?: SeriesPattern;
  newId?: () => string;
}

export interface SeriesEditPlan {
  /** Head of the series before the edit. */
  seriesHeadId: string;
  /** Head of the series that owns the affected occurrences after the edit. */
  newHeadId: string;
  newHeadRule: string;
  /** The old head's rule, ended before the anchor, when earlier occurrences stay behind. */
  truncateRule: string | null;
  updates: Array<{ id: string; start_time?: string; end_time?: string; fields: BulkFields }>;
  cancels: string[];
  inserts: Array<{ id: string; start_time: string; end_time: string; fields: BulkFields }>;
  /** Existing occurrences to attach to the new head (every affected one except the head itself). */
  reparent: string[];
  /** Start times (ISO) for a confirmation preview. */
  preview: { updated: string[]; cancelled: string[]; added: string[]; unchanged: string[] };
}

export class SeriesEditError extends Error {}

// ── Wall-clock helpers ────────────────────────────────────────────────────────

/** "YYYY-MM-DDTHH:mm" in the series' zone. */
export const toWallClock = wallClockIn;

/** Parses "YYYY-MM-DDTHH:mm" as a time in the series' zone. */
export const fromWallClock = instantFromWallClock;

const asRRuleDate = (wall: string) => new Date(`${wall}:00.000Z`);
const fromRRuleDate = (d: Date) => d.toISOString().slice(0, 16);
const datePart = (wall: string) => wall.slice(0, 10);
const timePart = (wall: string) => wall.slice(11, 16);
const ms = (iso: string) => new Date(iso).getTime();

function normalizeDays(byweekday: unknown): number[] {
  if (byweekday == null) return [];
  const list = Array.isArray(byweekday) ? byweekday : [byweekday];
  return list.map((d) => (typeof d === "number" ? d : (d as Weekday).weekday));
}

/**
 * The zone a series' pattern is in (PR #81 review).
 *
 * The rule's own TZID first: it belongs to the pattern, so it holds when any one
 * occurrence — the head included — has been moved to another zone. A rule from
 * before BUG-010 names none; its head's zone stands in, and the rule gets a
 * TZID (pinnedStartRule) before the head is ever edited on its own or deleted.
 * The opened occurrence never decides: it may be the exception.
 */
export function seriesTimeZone(head: EventRow, fallback: string): string {
  const fromRule = ruleTimeZone(head.recurrence_rule!);
  if (isUsableTimeZone(fromRule)) return fromRule;
  if (isUsableTimeZone(head.timezone)) return head.timezone;
  return fallback;
}

/** Where a series' pattern starts: its rule's DTSTART, or (for older rules) the head's start. */
function patternStartWall(head: EventRow, timeZone: string): string {
  const dtstart = RRule.fromString(head.recurrence_rule!).origOptions.dtstart;
  return dtstart ? fromRRuleDate(dtstart) : toWallClock(head.start_time, timeZone);
}

/** Every slot of a rule starting at a wall-clock time, as wall-clock strings. */
function expandSlots(startWall: string, ruleString: string): string[] {
  const set = new RRuleSet();
  set.rrule(new RRule({ ...expansionOptions(ruleString), dtstart: asRRuleDate(startWall) }));
  // Series always have an end date; the cap only guards against a malformed rule.
  return set.all((_, i) => i < 1000).map(fromRRuleDate);
}

function buildRule(
  options: { interval: number; days: number[]; until: Date | null | undefined },
  startWall: string,
  timeZone: string
) {
  return new RRule({
    freq: RRule.WEEKLY,
    interval: options.interval,
    byweekday: options.days,
    until: options.until ?? null,
    dtstart: asRRuleDate(startWall),
    tzid: timeZone,
  }).toString();
}

/**
 * The head's rule with the pattern's start and zone pinned. Used when the head is deleted
 * (the next occurrence is promoted) or its own time or zone is edited, so the pattern does not
 * shift with it. Rules created before BUG-009 have no DTSTART, and before BUG-010 no TZID: both
 * are taken from the head as it is before the edit. `fallback` is as for planSeriesEdit.
 */
export function pinnedStartRule(head: EventRow, fallback: string): string {
  const options = RRule.fromString(head.recurrence_rule!).origOptions;
  if (options.dtstart && options.tzid) return head.recurrence_rule!;
  const zone = seriesTimeZone(head, fallback);
  return new RRule({
    ...options,
    dtstart: options.dtstart ?? asRRuleDate(toWallClock(head.start_time, zone)),
    tzid: zone,
  }).toString();
}

function pickFields(row: EventRow): BulkFields {
  return Object.fromEntries(BULK_EDITABLE_FIELDS.map((f) => [f, row[f]])) as BulkFields;
}

function minutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// ── Planner ───────────────────────────────────────────────────────────────────

/**
 * The series an occurrence belongs to, sorted by start, and where an edit of the
 * given scope begins: the first upcoming occurrence for the entire series, or the
 * opened occurrence (or the next upcoming one, if it has passed) for this and
 * following. Earlier edits may have split the series, so only the opened
 * occurrence's own series counts.
 */
export function resolveSeriesEdit(
  occurrences: EventRow[],
  openedId: string,
  scope: SeriesEditScope,
  now: Date
): { head: EventRow; opened: EventRow; sorted: EventRow[]; anchor: EventRow } {
  const opened = occurrences.find((o) => o.id === openedId);
  if (!opened) throw new SeriesEditError("Could not find this event in its series.");
  const headId = opened.parent_event_id ?? opened.id;
  const sorted = occurrences
    .filter((o) => o.id === headId || o.parent_event_id === headId)
    .sort((a, b) => ms(a.start_time) - ms(b.start_time));

  const head = sorted.find((o) => o.id === headId && o.recurrence_rule);
  if (!head) throw new SeriesEditError("This event is not part of a series.");

  const upcoming = sorted.filter((o) => ms(o.start_time) > now.getTime());
  const anchor =
    scope === "series" ? upcoming[0] : upcoming.find((o) => ms(o.start_time) >= ms(opened.start_time));
  if (!anchor) throw new SeriesEditError("There are no upcoming events in this series to change.");

  return { head, opened, sorted, anchor };
}

export function planSeriesEdit(input: SeriesEditInput): SeriesEditPlan {
  const newId = input.newId ?? (() => crypto.randomUUID());
  const { head, sorted, anchor } = resolveSeriesEdit(input.occurrences, input.openedId, input.scope, input.now);

  const nowMs = input.now.getTime();
  const upcoming = sorted.filter((o) => ms(o.start_time) > nowMs);

  const affected = upcoming.filter((o) => ms(o.start_time) >= ms(anchor.start_time));
  const affectedIds = new Set(affected.map((o) => o.id));
  const earlier = sorted.filter((o) => !affectedIds.has(o.id));

  // A new zone keeps each occurrence's local clock time, so it moves every instant.
  const oldZone = seriesTimeZone(head, input.timeZone);
  const newZone = input.newTimeZone ?? oldZone;
  const zoneChanged = newZone !== oldZone;
  const retime = !!input.time || zoneChanged;
  const fields: BulkFields = zoneChanged ? { ...input.fields, timezone: newZone } : input.fields;

  // Occurrences off the existing pattern were rescheduled individually.
  const oldStartWall = patternStartWall(head, oldZone);
  const oldSlots = new Set(expandSlots(oldStartWall, head.recurrence_rule!));
  const isException = (o: EventRow) => !!o.is_cancelled || !oldSlots.has(toWallClock(o.start_time, oldZone));

  // The pattern after the edit, starting on the anchor's date.
  const oldOptions = RRule.fromString(head.recurrence_rule!).origOptions;
  const newOptions = input.pattern
    ? {
        interval: input.pattern.frequency === "biweekly" ? 2 : 1,
        days: input.pattern.daysOfWeek,
        until: new Date(`${input.pattern.untilDate}T23:59:59.000Z`),
      }
    : { interval: oldOptions.interval ?? 1, days: normalizeDays(oldOptions.byweekday), until: oldOptions.until };
  const newStartWall = `${datePart(toWallClock(anchor.start_time, oldZone))}T${input.time?.start ?? timePart(oldStartWall)}`;
  const newHeadRuleString = buildRule(newOptions, newStartWall, newZone);
  const newSlotsByDate = new Map(expandSlots(newStartWall, newHeadRuleString).map((w) => [datePart(w), w]));

  const template = affected.find((o) => !isException(o)) ?? anchor;
  let durationMs = ms(template.end_time) - ms(template.start_time);
  if (input.time) {
    const span = minutes(input.time.end) - minutes(input.time.start);
    if (span <= 0) throw new SeriesEditError("End time must be after start time.");
    durationMs = span * 60 * 1000;
  }

  const updates: SeriesEditPlan["updates"] = [];
  const cancels: string[] = [];
  const kept: Array<{ id: string; start: string }> = [];
  const unchanged: string[] = [];
  const filledDates = new Set<string>();

  for (const o of affected) {
    const date = datePart(toWallClock(o.start_time, oldZone));
    if (isException(o)) {
      filledDates.add(date);
      unchanged.push(o.start_time);
      continue;
    }
    const slot = newSlotsByDate.get(date);
    if (!slot) {
      cancels.push(o.id);
      continue;
    }
    filledDates.add(date);

    const start = retime ? fromWallClock(slot, newZone).toISOString() : new Date(o.start_time).toISOString();
    const end = retime
      ? new Date(ms(start) + (input.time ? durationMs : ms(o.end_time) - ms(o.start_time))).toISOString()
      : new Date(o.end_time).toISOString();
    const timeChanged = start !== new Date(o.start_time).toISOString() || end !== new Date(o.end_time).toISOString();
    kept.push({ id: o.id, start });
    if (timeChanged || Object.keys(fields).length > 0) {
      updates.push({ id: o.id, ...(timeChanged ? { start_time: start, end_time: end } : {}), fields });
    }
  }

  // New occurrences are always in the series' zone, even when it came from the team.
  const insertFields = { ...pickFields(template), ...fields, timezone: newZone };
  const inserts: SeriesEditPlan["inserts"] = [];
  for (const [date, slot] of [...newSlotsByDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const start = fromWallClock(slot, newZone);
    if (filledDates.has(date) || start.getTime() <= nowMs) continue;
    inserts.push({
      id: newId(),
      start_time: start.toISOString(),
      end_time: new Date(start.getTime() + durationMs).toISOString(),
      fields: insertFields,
    });
  }

  const headCandidates = [...kept, ...inserts.map((i) => ({ id: i.id, start: i.start_time }))];
  if (headCandidates.length === 0) {
    throw new SeriesEditError("This change would leave the series with no events.");
  }
  const newHeadId = headCandidates.sort((a, b) => ms(a.start) - ms(b.start))[0].id;

  const headAffected = affectedIds.has(head.id);
  const reparent = [
    ...affected.map((o) => o.id),
    // If the old head moves under the new series, anything before it goes too.
    ...(headAffected ? earlier.map((o) => o.id) : []),
  ].filter((id) => id !== newHeadId);

  const truncateRule = headAffected
    ? null
    : buildRule(
        {
          interval: oldOptions.interval ?? 1,
          days: normalizeDays(oldOptions.byweekday),
          until: new Date(asRRuleDate(`${datePart(newStartWall)}T00:00`).getTime() - 60 * 1000),
        },
        oldStartWall,
        oldZone
      );

  const byId = new Map(sorted.map((o) => [o.id, o]));
  return {
    seriesHeadId: head.id,
    newHeadId,
    newHeadRule: newHeadRuleString,
    truncateRule,
    updates,
    cancels,
    inserts,
    reparent,
    preview: {
      updated: updates.map((u) => u.start_time ?? byId.get(u.id)!.start_time),
      cancelled: cancels.map((id) => byId.get(id)!.start_time),
      added: inserts.map((i) => i.start_time),
      unchanged,
    },
  };
}
