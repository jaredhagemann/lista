import { describe, it, expect, afterAll } from "vitest";
import {
  createTestUser,
  createTestTeam,
  cleanupTestData,
  adminClient,
} from "./helpers";
import { buildRRule, expandRecurrence } from "@/lib/utils/rrule";

describe("event creation", () => {
  afterAll(async () => {
    await cleanupTestData();
  });

  describe("single event", () => {
    it("admin can create a single event with all fields", async () => {
      const coach = await createTestUser();
      const { teamId } = await createTestTeam(coach.user.id);

      const startTime = new Date("2026-03-10T18:00:00Z");
      const endTime = new Date("2026-03-10T19:30:00Z");

      const { data, error } = await coach.client
        .from("events")
        .insert({
          team_id: teamId,
          title: "Tuesday Practice",
          event_type: "practice",
          start_time: startTime.toISOString(),
          end_time: endTime.toISOString(),
          notes: "Bring water bottles",
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect(data!.title).toBe("Tuesday Practice");
      expect(data!.event_type).toBe("practice");
      expect(new Date(data!.start_time).getTime()).toBe(startTime.getTime());
      expect(new Date(data!.end_time).getTime()).toBe(endTime.getTime());
      expect(data!.notes).toBe("Bring water bottles");
      expect(data!.recurrence_rule).toBeNull();
      expect(data!.parent_event_id).toBeNull();
      expect(data!.is_cancelled).toBe(false);
    });

    it("admin can create a game event with game-specific fields", async () => {
      const coach = await createTestUser();
      const { teamId } = await createTestTeam(coach.user.id);

      const { data, error } = await coach.client
        .from("events")
        .insert({
          team_id: teamId,
          title: "vs Wildcats",
          event_type: "game",
          start_time: new Date("2026-03-15T14:00:00Z").toISOString(),
          end_time: new Date("2026-03-15T16:00:00Z").toISOString(),
          opponent: "Wildcats",
          home_away: "home",
          uniform: "home",
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(data!.opponent).toBe("Wildcats");
      expect(data!.home_away).toBe("home");
      expect(data!.uniform).toBe("home");
    });

    it("single event has no parent_event_id or recurrence_rule", async () => {
      const coach = await createTestUser();
      const { teamId } = await createTestTeam(coach.user.id);

      const { data, error } = await coach.client
        .from("events")
        .insert({
          team_id: teamId,
          title: "One-off Event",
          event_type: "other",
          start_time: new Date("2026-03-20T10:00:00Z").toISOString(),
          end_time: new Date("2026-03-20T11:00:00Z").toISOString(),
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(data!.recurrence_rule).toBeNull();
      expect(data!.parent_event_id).toBeNull();
    });
  });

  describe("recurring event creation", () => {
    it("creates parent event with recurrence_rule and child events", async () => {
      const coach = await createTestUser();
      const { teamId } = await createTestTeam(coach.user.id);

      // Simulate the form dialog's recurring event creation flow
      // Tuesday March 3, 2026 at 6:00 PM, recurring weekly until March 31
      const startTime = new Date("2026-03-03T18:00:00Z");
      const endTime = new Date("2026-03-03T19:30:00Z");
      const durationMs = endTime.getTime() - startTime.getTime();

      // Build RRULE (same logic as event-form-dialog.tsx)
      const jsDay = startTime.getDay(); // JS Tuesday = 2
      const rruleDay = jsDay === 0 ? 6 : jsDay - 1; // rrule Tuesday = 1
      const rruleString = buildRRule({
        frequency: "weekly",
        daysOfWeek: [rruleDay],
        until: new Date("2026-03-31T23:59:59Z"),
      });

      // Create parent event
      const { data: parentEvent, error: parentError } = await coach.client
        .from("events")
        .insert({
          team_id: teamId,
          title: "Weekly Practice",
          event_type: "practice",
          start_time: startTime.toISOString(),
          end_time: endTime.toISOString(),
          recurrence_rule: rruleString,
          created_by: coach.user.id,
        })
        .select()
        .single();

      expect(parentError).toBeNull();
      expect(parentEvent).not.toBeNull();
      expect(parentEvent!.recurrence_rule).toBe(rruleString);

      // Expand recurrence and create child events (same logic as form dialog)
      const occurrences = expandRecurrence(rruleString, startTime);

      // Skip the first occurrence (it's the parent)
      const childEventData = occurrences.slice(1).map((date) => ({
        team_id: teamId,
        title: "Weekly Practice",
        event_type: "practice" as const,
        start_time: date.toISOString(),
        end_time: new Date(date.getTime() + durationMs).toISOString(),
        parent_event_id: parentEvent!.id,
        created_by: coach.user.id,
      }));

      if (childEventData.length > 0) {
        const { error: childError } = await coach.client
          .from("events")
          .insert(childEventData);
        expect(childError).toBeNull();
      }

      // Verify: query all events in the series
      const { data: allEvents, error: queryError } = await coach.client
        .from("events")
        .select()
        .eq("team_id", teamId)
        .order("start_time", { ascending: true });

      expect(queryError).toBeNull();

      const parentEvents = allEvents!.filter((e) => e.recurrence_rule !== null);
      const childEvents = allEvents!.filter((e) => e.parent_event_id !== null);

      // Should have exactly 1 parent
      expect(parentEvents).toHaveLength(1);
      expect(parentEvents[0].id).toBe(parentEvent!.id);

      // Total events should equal number of occurrences
      expect(allEvents).toHaveLength(occurrences.length);

      // Child events should reference the parent
      for (const child of childEvents) {
        expect(child.parent_event_id).toBe(parentEvent!.id);
        expect(child.title).toBe("Weekly Practice");
        expect(child.event_type).toBe("practice");
      }

      // All events should be on Tuesdays with correct duration
      for (const event of allEvents!) {
        const start = new Date(event.start_time);
        const end = new Date(event.end_time);
        expect(start.getUTCDay()).toBe(2); // Tuesday
        expect(end.getTime() - start.getTime()).toBe(durationMs);
      }
    });

    it("creates biweekly recurring events 14 days apart", async () => {
      const coach = await createTestUser();
      const { teamId } = await createTestTeam(coach.user.id);

      // Wednesday March 4, 2026 at 5:00 PM, biweekly until April 30
      const startTime = new Date("2026-03-04T17:00:00Z");
      const endTime = new Date("2026-03-04T18:30:00Z");
      const durationMs = endTime.getTime() - startTime.getTime();

      const jsDay = startTime.getDay(); // JS Wednesday = 3
      const rruleDay = jsDay === 0 ? 6 : jsDay - 1; // rrule Wednesday = 2
      const rruleString = buildRRule({
        frequency: "biweekly",
        daysOfWeek: [rruleDay],
        until: new Date("2026-04-30T23:59:59Z"),
      });

      // Create parent
      const { data: parentEvent, error: parentError } = await coach.client
        .from("events")
        .insert({
          team_id: teamId,
          title: "Biweekly Training",
          event_type: "practice",
          start_time: startTime.toISOString(),
          end_time: endTime.toISOString(),
          recurrence_rule: rruleString,
          created_by: coach.user.id,
        })
        .select()
        .single();

      expect(parentError).toBeNull();

      // Expand and create children
      const occurrences = expandRecurrence(rruleString, startTime);
      const childEventData = occurrences.slice(1).map((date) => ({
        team_id: teamId,
        title: "Biweekly Training",
        event_type: "practice" as const,
        start_time: date.toISOString(),
        end_time: new Date(date.getTime() + durationMs).toISOString(),
        parent_event_id: parentEvent!.id,
        created_by: coach.user.id,
      }));

      if (childEventData.length > 0) {
        const { error: childError } = await coach.client
          .from("events")
          .insert(childEventData);
        expect(childError).toBeNull();
      }

      // Verify
      const { data: allEvents } = await coach.client
        .from("events")
        .select()
        .eq("team_id", teamId)
        .order("start_time", { ascending: true });

      expect(allEvents).toHaveLength(occurrences.length);
      expect(allEvents!.length).toBeGreaterThanOrEqual(4); // ~8 weeks of biweekly

      // Verify 14-day spacing between consecutive events
      for (let i = 1; i < allEvents!.length; i++) {
        const prev = new Date(allEvents![i - 1].start_time);
        const curr = new Date(allEvents![i].start_time);
        const diffDays =
          (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
        expect(diffDays).toBe(14);
      }

      // All should be on Wednesdays
      for (const event of allEvents!) {
        expect(new Date(event.start_time).getUTCDay()).toBe(3);
      }
    });

    it("child events do not carry game result fields from parent", async () => {
      const coach = await createTestUser();
      const { teamId } = await createTestTeam(coach.user.id);

      // Saturday March 7, 2026 game, weekly until March 28
      const startTime = new Date("2026-03-07T14:00:00Z");
      const endTime = new Date("2026-03-07T16:00:00Z");
      const durationMs = endTime.getTime() - startTime.getTime();

      const jsDay = startTime.getDay(); // JS Saturday = 6
      const rruleDay = jsDay === 0 ? 6 : jsDay - 1; // rrule Saturday = 5
      const rruleString = buildRRule({
        frequency: "weekly",
        daysOfWeek: [rruleDay],
        until: new Date("2026-03-28T23:59:59Z"),
      });

      // Create parent game event
      const { data: parentEvent, error: parentError } = await coach.client
        .from("events")
        .insert({
          team_id: teamId,
          title: "vs Eagles",
          event_type: "game",
          start_time: startTime.toISOString(),
          end_time: endTime.toISOString(),
          opponent: "Eagles",
          home_away: "home",
          uniform: "home",
          recurrence_rule: rruleString,
          created_by: coach.user.id,
        })
        .select()
        .single();

      expect(parentError).toBeNull();

      // Create children — form dialog explicitly nulls out game_result/score fields
      const occurrences = expandRecurrence(rruleString, startTime);
      const childEventData = occurrences.slice(1).map((date) => ({
        team_id: teamId,
        title: "vs Eagles",
        event_type: "game" as const,
        start_time: date.toISOString(),
        end_time: new Date(date.getTime() + durationMs).toISOString(),
        parent_event_id: parentEvent!.id,
        created_by: coach.user.id,
        opponent: "Eagles",
        home_away: "home" as const,
        uniform: "home" as const,
        game_result: null,
        score_for: null,
        score_against: null,
      }));

      if (childEventData.length > 0) {
        const { error: childError } = await coach.client
          .from("events")
          .insert(childEventData);
        expect(childError).toBeNull();
      }

      // Verify child events have null game_result/scores
      const { data: children } = await coach.client
        .from("events")
        .select()
        .eq("parent_event_id", parentEvent!.id);

      expect(children!.length).toBeGreaterThan(0);
      for (const child of children!) {
        expect(child.game_result).toBeNull();
        expect(child.score_for).toBeNull();
        expect(child.score_against).toBeNull();
        expect(child.opponent).toBe("Eagles");
        expect(child.home_away).toBe("home");
      }
    });

    it("deleting parent event cascades to child events", async () => {
      const coach = await createTestUser();
      const { teamId } = await createTestTeam(coach.user.id);

      const startTime = new Date("2026-03-05T18:00:00Z");
      const endTime = new Date("2026-03-05T19:00:00Z");
      const durationMs = endTime.getTime() - startTime.getTime();

      const jsDay = startTime.getDay();
      const rruleDay = jsDay === 0 ? 6 : jsDay - 1;
      const rruleString = buildRRule({
        frequency: "weekly",
        daysOfWeek: [rruleDay],
        until: new Date("2026-03-26T23:59:59Z"),
      });

      // Create parent
      const { data: parentEvent } = await coach.client
        .from("events")
        .insert({
          team_id: teamId,
          title: "Cascade Test",
          event_type: "practice",
          start_time: startTime.toISOString(),
          end_time: endTime.toISOString(),
          recurrence_rule: rruleString,
          created_by: coach.user.id,
        })
        .select()
        .single();

      // Create children
      const occurrences = expandRecurrence(rruleString, startTime);
      const childEventData = occurrences.slice(1).map((date) => ({
        team_id: teamId,
        title: "Cascade Test",
        event_type: "practice" as const,
        start_time: date.toISOString(),
        end_time: new Date(date.getTime() + durationMs).toISOString(),
        parent_event_id: parentEvent!.id,
        created_by: coach.user.id,
      }));

      if (childEventData.length > 0) {
        await coach.client.from("events").insert(childEventData);
      }

      // Verify children exist
      const { data: beforeDelete } = await coach.client
        .from("events")
        .select()
        .eq("team_id", teamId);
      expect(beforeDelete!.length).toBeGreaterThan(1);

      // Delete parent — should cascade to children (ON DELETE CASCADE)
      const { error: deleteError } = await coach.client
        .from("events")
        .delete()
        .eq("id", parentEvent!.id);
      expect(deleteError).toBeNull();

      // All events should be gone
      const { data: afterDelete } = await coach.client
        .from("events")
        .select()
        .eq("team_id", teamId);
      expect(afterDelete).toHaveLength(0);
    });

    it("recurring event with Sunday start uses correct day mapping", async () => {
      const coach = await createTestUser();
      const { teamId } = await createTestTeam(coach.user.id);

      // Sunday March 1, 2026 at 10:00 AM
      const startTime = new Date("2026-03-01T10:00:00Z");
      const endTime = new Date("2026-03-01T12:00:00Z");
      const durationMs = endTime.getTime() - startTime.getTime();

      // JS Sunday = 0, rrule Sunday = 6
      const jsDay = startTime.getDay();
      expect(jsDay).toBe(0);
      const rruleDay = jsDay === 0 ? 6 : jsDay - 1;
      expect(rruleDay).toBe(6);

      const rruleString = buildRRule({
        frequency: "weekly",
        daysOfWeek: [rruleDay],
        until: new Date("2026-03-31T23:59:59Z"),
      });

      // Create parent
      const { data: parentEvent } = await coach.client
        .from("events")
        .insert({
          team_id: teamId,
          title: "Sunday Practice",
          event_type: "practice",
          start_time: startTime.toISOString(),
          end_time: endTime.toISOString(),
          recurrence_rule: rruleString,
          created_by: coach.user.id,
        })
        .select()
        .single();

      // Expand and create children
      const occurrences = expandRecurrence(rruleString, startTime);
      const childEventData = occurrences.slice(1).map((date) => ({
        team_id: teamId,
        title: "Sunday Practice",
        event_type: "practice" as const,
        start_time: date.toISOString(),
        end_time: new Date(date.getTime() + durationMs).toISOString(),
        parent_event_id: parentEvent!.id,
        created_by: coach.user.id,
      }));

      if (childEventData.length > 0) {
        await coach.client.from("events").insert(childEventData);
      }

      // All events should be on Sundays
      const { data: allEvents } = await coach.client
        .from("events")
        .select()
        .eq("team_id", teamId)
        .order("start_time", { ascending: true });

      expect(allEvents!.length).toBeGreaterThan(1);
      for (const event of allEvents!) {
        const start = new Date(event.start_time);
        expect(start.getUTCDay()).toBe(0); // Sunday
        expect(start.getUTCHours()).toBe(10);
      }
    });
  });
});
