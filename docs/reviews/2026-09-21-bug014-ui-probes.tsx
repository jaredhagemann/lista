// @vitest-environment jsdom
// Review probes: these assert the observed defects, not desired behavior.
// To run, copy this file to apps/web/tests/bug014-review-probes.test.tsx and
// run pnpm exec vitest run tests/bug014-review-probes.test.tsx from apps/web.
// Remove that temporary copy afterward; these are not regression expectations.
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AvailabilityMatrix } from "@/components/availability/availability-matrix";
const { upsert } = vi.hoisted(() => ({ upsert: vi.fn(async () => ({ error: null })) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ from: () => ({ upsert }) }) }));
afterEach(() => { cleanup(); upsert.mockClear(); });
const member = { profileId: "player", name: "Player", role: "player" };
const event = (id: string, offset: number) => ({ id, title: id, event_type: "practice" as const, start_time: new Date(Date.now() + offset * 86400000).toISOString() });
const props = { members: [member], isAdmin: false, currentUserId: "player" };
it("past window renders no events despite receiving a past event", () => {
  render(<AvailabilityMatrix {...props} events={[event("past", -5)]} initialRows={[]} />);
  expect(screen.getByText("No events found.")).toBeTruthy();
});
it("expanding the window discards incoming responses and bulk overwrites them", async () => {
  const soon = event("soon", 5);
  const later = event("later", 200);
  const first = { event_id: "soon", profile_id: "player", status: "maybe" as const };
  const second = { event_id: "later", profile_id: "player", status: "unavailable" as const };
  const view = render(<AvailabilityMatrix {...props} events={[soon]} initialRows={[first]} />);
  view.rerender(<AvailabilityMatrix {...props} events={[soon, later]} initialRows={[first, second]} />);
  expect(screen.getByTitle("No response")).toBeTruthy();
  fireEvent.click(screen.getByTitle("Available"));
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  await waitFor(() => expect(upsert).toHaveBeenCalledWith(
    [{ event_id: "later", profile_id: "player", status: "available" }],
    { onConflict: "event_id,profile_id" }
  ));
});
