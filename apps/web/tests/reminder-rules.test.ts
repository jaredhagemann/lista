/**
 * Whether an event gets its daily reminder (docs/specs/team-notification-controls.md §4.1).
 *
 * The event's own setting wins, even over the team's switch being off (D9).
 * Otherwise the team's switch and the event type's switch must both be on. A
 * tournament game follows the game rule (D12). No settings row is the
 * defaults: everything on. A cancelled event is never reminded.
 */

import { describe, it, expect } from "vitest";
import { shouldRemind, DEFAULT_REMINDER_SETTINGS, type TeamReminderSettings } from "@/lib/notifications/reminder-rules";

const ON: TeamReminderSettings = DEFAULT_REMINDER_SETTINGS;
const event = (overrides: Partial<Parameters<typeof shouldRemind>[0]> = {}) => ({
  event_type: "practice",
  is_cancelled: false,
  reminder: null,
  tournament_id: null,
  ...overrides,
});

describe("shouldRemind", () => {
  it("reminds every type by default, with or without a settings row", () => {
    for (const type of ["practice", "game", "other", "tournament"]) {
      expect(shouldRemind(event({ event_type: type }), ON)).toBe(true);
      expect(shouldRemind(event({ event_type: type }), null)).toBe(true);
    }
  });

  it("follows each type's switch", () => {
    const types = { practice: "remind_practice", game: "remind_game", other: "remind_other", tournament: "remind_tournament" } as const;
    for (const [type, column] of Object.entries(types)) {
      const settings = { ...ON, [column]: false };
      expect(shouldRemind(event({ event_type: type }), settings)).toBe(false);
      for (const other of Object.keys(types).filter((t) => t !== type)) {
        expect(shouldRemind(event({ event_type: other }), settings)).toBe(true);
      }
    }
  });

  it("sends nothing by default when the team's switch is off", () => {
    expect(shouldRemind(event(), { ...ON, enabled: false })).toBe(false);
  });

  it("'Always send' wins over the team's switch and the type's (D9)", () => {
    const allOff = { enabled: false, remind_practice: false, remind_game: false, remind_other: false, remind_tournament: false };
    expect(shouldRemind(event({ reminder: "always" }), allOff)).toBe(true);
  });

  it("'Don't send' wins over everything on", () => {
    expect(shouldRemind(event({ reminder: "never" }), ON)).toBe(false);
    expect(shouldRemind(event({ reminder: "never" }), null)).toBe(false);
  });

  it("a tournament game follows the game rule, and the tournament its own (D12)", () => {
    const game = event({ event_type: "game", tournament_id: "t-1" });
    expect(shouldRemind(game, { ...ON, remind_game: false })).toBe(false);
    expect(shouldRemind(game, { ...ON, remind_tournament: false })).toBe(true);
    expect(shouldRemind(event({ event_type: "tournament" }), { ...ON, remind_game: false })).toBe(true);
  });

  it("never reminds a cancelled event, even with 'Always send'", () => {
    expect(shouldRemind(event({ is_cancelled: true }), ON)).toBe(false);
    expect(shouldRemind(event({ is_cancelled: true, reminder: "always" }), ON)).toBe(false);
  });
});
