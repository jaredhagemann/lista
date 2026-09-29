import type { BulkFields, SeriesEditPlan } from "@/lib/events/series-edit";
import { getRecurrenceDescription } from "@/lib/utils/rrule";
import { formatEventTimeRange, formatZoneName } from "@/lib/notifications/event-time";

/**
 * What a series edit changed, as text: sent with the edit so its one notice can
 * list it (PR #96 review, P2). Moving a series to another day cancels the old
 * occurrences and adds new ones, so no single row's before and after says what
 * happened. This is the review the coach confirms in the editor, in words.
 */

export type SeriesChange = { field: string; before: string; after: string };

export const SERIES_FIELD_LABELS: Record<string, string> = {
  title: "Title",
  event_type: "Type",
  location_id: "Location",
  notes: "Notes",
  arrival_time: "Arrival time",
  opponent: "Opponent",
  home_away: "Home / away",
  uniform: "Uniform",
};

export function seriesEditSummary({
  plan,
  fields,
  anchor,
  describe,
  seriesZone,
  newZone,
  oldRule,
  patternChanged,
}: {
  plan: SeriesEditPlan;
  /** Only the fields that changed. */
  fields: BulkFields;
  /** The occurrence the edit was made from, as it was. */
  anchor: BulkFields & { start_time: string; end_time: string };
  /** A field's value as people see it (describeSeriesValue). */
  describe: (key: string, value: unknown) => string;
  seriesZone: string;
  newZone?: string;
  oldRule: string;
  patternChanged: boolean;
}): SeriesChange[] {
  const changes: SeriesChange[] = Object.entries(fields).map(([key, value]) => ({
    field: SERIES_FIELD_LABELS[key] ?? key,
    before: describe(key, anchor[key as keyof BulkFields]),
    after: describe(key, value),
  }));

  // The time of day, from an occurrence the edit moved or added, each in its zone.
  const zone = newZone ?? seriesZone;
  const moved = plan.updates.find((u) => u.start_time && u.end_time) ?? plan.inserts[0];
  if (moved?.start_time && moved.end_time) {
    const before = formatEventTimeRange(anchor.start_time, anchor.end_time, seriesZone);
    const after = formatEventTimeRange(moved.start_time, moved.end_time, zone);
    if (before !== after) changes.push({ field: "Time", before, after });
  }
  if (newZone && newZone !== seriesZone) {
    changes.push({ field: "Time zone", before: formatZoneName(seriesZone), after: formatZoneName(newZone) });
  }
  if (patternChanged) {
    changes.push({
      field: "Recurrence",
      before: sentence(getRecurrenceDescription(oldRule)),
      after: sentence(getRecurrenceDescription(plan.newHeadRule)),
    });
  }
  return changes;
}

/** "every week on Tuesday" → "Every week on Tuesday", as a table cell reads. */
function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
