/**
 * Component-level tests for TrainingCategoriesSection.
 *
 * The spec (individual-training-tracking.md §"Managing categories") requires the
 * "Training categories" management surface to be reachable from the Training →
 * Team tab AND mirrored in team settings. This section is that team-settings
 * mirror: a "Manage categories" affordance that opens the same
 * ManageCategoriesDialog used by the Team tab.
 *
 * ManageCategoriesDialog is mocked here so the section can be tested in isolation
 * without a Supabase client — the dialog's own behavior is exercised elsewhere.
 */

// @vitest-environment jsdom

import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/components/training/manage-categories-dialog", () => ({
  ManageCategoriesDialog: ({
    open,
    teamId,
    sport,
  }: {
    open: boolean;
    teamId: string;
    sport: string | null;
  }) =>
    open ? (
      <div data-testid="manage-dialog" data-team={teamId} data-sport={sport ?? ""}>
        dialog
      </div>
    ) : null,
}));

import { TrainingCategoriesSection } from "@/components/settings/training-categories-section";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TrainingCategoriesSection — team-settings mirror of the Team-tab affordance", () => {
  it("renders a 'Manage categories' affordance", () => {
    render(<TrainingCategoriesSection teamId="team-1" sport="soccer" />);
    expect(screen.getByRole("button", { name: /manage categories/i })).toBeTruthy();
  });

  it("does not render the dialog until the affordance is clicked", () => {
    render(<TrainingCategoriesSection teamId="team-1" sport="soccer" />);
    expect(screen.queryByTestId("manage-dialog")).toBeNull();
  });

  it("opens ManageCategoriesDialog with the team's id and sport when clicked", async () => {
    render(<TrainingCategoriesSection teamId="team-1" sport="soccer" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /manage categories/i }));

    const dialog = screen.getByTestId("manage-dialog");
    expect(dialog.getAttribute("data-team")).toBe("team-1");
    expect(dialog.getAttribute("data-sport")).toBe("soccer");
  });

  it("passes a null sport through to the dialog unchanged", async () => {
    render(<TrainingCategoriesSection teamId="team-2" sport={null} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /manage categories/i }));

    const dialog = screen.getByTestId("manage-dialog");
    expect(dialog.getAttribute("data-team")).toBe("team-2");
    expect(dialog.getAttribute("data-sport")).toBe("");
  });
});
