// @vitest-environment jsdom

/**
 * After a link switches the active team, the header must show the new team. A link
 * within the app keeps the layout it was on, so the event page asks for it again.
 */

import React from "react";
import { render, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

import { RefreshAfterTeamSwitch } from "@/components/layout/refresh-after-team-switch";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("RefreshAfterTeamSwitch", () => {
  it("refreshes, so the layout is rebuilt for the new team", () => {
    window.history.replaceState(null, "", "/dashboard/schedule/evt-1?switched=1");

    render(<RefreshAfterTeamSwitch />);

    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("drops the switched mark from the address and keeps the rest", () => {
    window.history.replaceState(null, "", "/dashboard/schedule/evt-1?edit=true&switched=1");

    render(<RefreshAfterTeamSwitch />);

    expect(window.location.pathname + window.location.search).toBe("/dashboard/schedule/evt-1?edit=true");
  });
});
