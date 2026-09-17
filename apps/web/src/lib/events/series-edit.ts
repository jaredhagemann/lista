import { RRule, RRuleSet, type Weekday } from "rrule";
import type { Database } from "@/types/database";

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
 * Times are wall-clock times on the editing device, like the rest of the event
 * forms until event-level timezones land (BUG-010). recurrence rules follow the
 * rrule library's convention: a wall-clock time labeled as UTC.
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

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DDTHH:mm" in the device's timezone. */
export function toWallClock(instant: string | Date): string {
  const d = new Date(instant);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Parses "YYYY-MM-DDTHH:mm" as a device-local time. */
export function fromWallClock(wall: string): Date {
  return new Date(wall);
}

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

/** Where a series' pattern starts: its rule's DTSTART, or (for older rules) the head's start. */
function patternStartWall(head: EventRow): string {
  const dtstart = RRule.fromString(head.recurrence_rule!).origOptions.dtstart;
  return dtstart ? fromRRuleDate(dtstart) : toWallClock(head.start_time);
}

/** Every slot of a rule starting at a wall-clock time, as wall-clock strings. */
function expandSlots(startWall: string, ruleString: string): string[] {
  const set = new RRuleSet();
  set.rrule(new RRule({ ...RRule.fromString(ruleString).origOptions, dtstart: asRRuleDate(startWall) }));
  // Series always have an end date; the cap only guards against a malformed rule.
  return set.all((_, i) => i < 1000).map(fromRRuleDate);
}

function buildRule(options: { interval: number; days: number[]; until: Date | null | undefined }, startWall: string) {
  return new RRule({
    freq: RRule.WEEKLY,
    interval: options.interval,
    byweekday: options.days,
    until: options.until ?? null,
    dtstart: asRRuleDate(startWall),
  }).toString();
}

/**
 * The head's rule with DTSTART pinned to the original pattern start. Used when the head is
 * deleted (the next occurrence is promoted) or its own time is edited, so the pattern does not
 * shift with it. Rules created before BUG-009 have no DTSTART.
 */
export function pinnedStartRule(head: EventRow): string {
  const options = RRule.fromString(head.recurrence_rule!).origOptions;
  if (options.dtstart) return head.recurrence_rule!;
  return new RRule({ ...options, dtstart: asRRuleDate(toWallClock(head.start_time)) }).toString();
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

  // Occurrences off the existing pattern were rescheduled individually.
  const oldStartWall = patternStartWall(head);
  const oldSlots = new Set(expandSlots(oldStartWall, head.recurrence_rule!));
  const isException = (o: EventRow) => !!o.is_cancelled || !oldSlots.has(toWallClock(o.start_time));

  // The pattern after the edit, starting on the anchor's date.
  const oldOptions = RRule.fromString(head.recurrence_rule!).origOptions;
  const newOptions = input.pattern
    ? {
        interval: input.pattern.frequency === "biweekly" ? 2 : 1,
        days: input.pattern.daysOfWeek,
        until: new Date(`${input.pattern.untilDate}T23:59:59.000Z`),
      }
    : { interval: oldOptions.interval ?? 1, days: normalizeDays(oldOptions.byweekday), until: oldOptions.until };
  const newStartWall = `${datePart(toWallClock(anchor.start_time))}T${input.time?.start ?? timePart(oldStartWall)}`;
  const newHeadRuleString = buildRule(newOptions, newStartWall);
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
    const date = datePart(toWallClock(o.start_time));
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

    const start = input.time ? fromWallClock(slot).toISOString() : new Date(o.start_time).toISOString();
    const end = input.time ? new Date(ms(start) + durationMs).toISOString() : new Date(o.end_time).toISOString();
    const timeChanged = start !== new Date(o.start_time).toISOString() || end !== new Date(o.end_time).toISOString();
    kept.push({ id: o.id, start });
    if (timeChanged || Object.keys(input.fields).length > 0) {
      updates.push({ id: o.id, ...(timeChanged ? { start_time: start, end_time: end } : {}), fields: input.fields });
    }
  }

  const insertFields = { ...pickFields(template), ...input.fields };
  const inserts: SeriesEditPlan["inserts"] = [];
  for (const [date, slot] of [...newSlotsByDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const start = fromWallClock(slot);
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
        oldStartWall
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
