/**
 * The projection decides the row shape (BUG-014, PR #74 review finding 4).
 *
 * `fetchEventPage<T = EventRow>` let a caller name any result type, and the
 * calendar's narrow SELECT was advertised as a whole `EventRow`: `notes` type-
 * checked as `string | null` while arriving `undefined`. The compiler could not
 * protect the components that are about to be built on this.
 *
 * These assertions are compile-time. `tsc --noEmit` failing is the test failing;
 * the runtime body only keeps vitest happy.
 */

import { describe, it, expect } from "vitest";
import type { CalendarEventRow, ListEventRow, RowFor } from "@/lib/events/queries";

describe("projection row types", () => {
  it("gives the calendar exactly the columns it selects", () => {
    const row: RowFor<"calendar"> = {
      id: "e",
      team_id: "t",
      title: "Practice",
      event_type: "practice",
      start_time: "2026-12-01T17:00:00.000Z",
      end_time: "2026-12-01T18:00:00.000Z",
      is_cancelled: false,
    };

    // @ts-expect-error — the calendar projection never selects `notes`.
    const notes: string | null = row.notes;
    // @ts-expect-error — nor `location_id`.
    const location: string | null = row.location_id;

    expect(row.title).toBe("Practice");
    expect([notes, location]).toHaveLength(2);
  });

  it("gives the list its joined location", () => {
    const row = {} as RowFor<"list">;

    const name: string | undefined = row.locations?.name;
    // The list keeps the whole row, so fields the calendar omits are here.
    const notes: string | null = row.notes;

    expect([name, notes]).toHaveLength(2);
  });

  it("does not let a caller invent a row shape", () => {
    // A calendar row is not assignable to a shape with fields it never selects.
    const calendar = {} as CalendarEventRow;
    // @ts-expect-error — `inventedField` is not part of any projection.
    const invented: { inventedField: number } = calendar;

    const list = {} as ListEventRow;
    const asCalendar: CalendarEventRow = list;

    expect([invented, asCalendar]).toHaveLength(2);
  });
});
