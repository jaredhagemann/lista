/**
 * Component-level tests for CreateTeamForm.
 *
 * Covers test-plan sections §4.1, §4.4, §4.5:
 *   §4.1 — Team name field has required attribute
 *   §4.4 — Button shows "Creating..." while the async operation is in flight
 *   §4.5 — Error message is rendered when executeCreateTeam returns an error string
 *
 * Uses @vitest-environment jsdom so React components can be rendered and the DOM
 * can be queried; the node-environment tests for pure logic live in
 * create-team-form.test.ts.
 */

// @vitest-environment jsdom

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/app/actions/team", () => ({
  clearActiveProfile: vi.fn().mockResolvedValue(undefined),
}));

// executeCreateTeam is mocked so tests control its return value and timing
// without making real HTTP calls.
const mockExecuteCreateTeam = vi.fn();
vi.mock("@/lib/create-team", () => ({
  executeCreateTeam: (...args: Parameters<typeof mockExecuteCreateTeam>) =>
    mockExecuteCreateTeam(...args),
}));

import { CreateTeamForm } from "@/components/team/create-team-form";

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ── §4.1 — Required-field attribute ──────────────────────────────────────────

describe("CreateTeamForm — required-field attribute (§4.1)", () => {
  it("§4.1 team name input has required attribute", () => {
    render(<CreateTeamForm />);
    const input = screen.getByLabelText(/team name/i);
    expect(input).toHaveProperty("required", true);
  });
});

// ── §4.4 — Loading state ──────────────────────────────────────────────────────

describe("CreateTeamForm — loading state (§4.4)", () => {
  it("§4.4 button shows 'Creating...' while submission is in flight", async () => {
    // Hang forever — never resolves — so we can assert the loading state
    mockExecuteCreateTeam.mockReturnValue(new Promise(() => {}));

    render(<CreateTeamForm />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/team name/i), "U12 Boys");
    await user.click(screen.getByRole("button", { name: /create team/i }));

    expect(screen.getByRole("button", { name: /creating/i })).toBeTruthy();
  });

  it("§4.4 button is disabled while submission is in flight", async () => {
    mockExecuteCreateTeam.mockReturnValue(new Promise(() => {}));

    render(<CreateTeamForm />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/team name/i), "U12 Boys");
    await user.click(screen.getByRole("button", { name: /create team/i }));

    const btn = screen.getByRole("button", { name: /creating/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});

// ── §4.5 — Error display ──────────────────────────────────────────────────────

describe("CreateTeamForm — error display (§4.5)", () => {
  it("§4.5 renders error message when executeCreateTeam returns an error", async () => {
    mockExecuteCreateTeam.mockResolvedValue("Something went wrong. Please try again.");

    render(<CreateTeamForm />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/team name/i), "U12 Boys");
    await user.click(screen.getByRole("button", { name: /create team/i }));

    await waitFor(() => {
      expect(screen.getByText("Something went wrong. Please try again.")).toBeTruthy();
    });
  });

  it("§4.5 button returns to 'Create team' after error is shown", async () => {
    mockExecuteCreateTeam.mockResolvedValue("Something went wrong. Please try again.");

    render(<CreateTeamForm />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/team name/i), "U12 Boys");
    await user.click(screen.getByRole("button", { name: /create team/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /create team/i })).toBeTruthy();
    });
  });

  it("§4.5 does not render error block on initial render", () => {
    render(<CreateTeamForm />);
    expect(screen.queryByText(/went wrong/i)).toBeNull();
  });
});
