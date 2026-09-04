/**
 * Tests for the per-row session actions in My Training.
 *
 * Spec (individual-training-tracking.md §"My Training"): a session past the
 * 7-day window is read-only to the player (no edit, no delete) and "the UI
 * shows why — e.g. a disabled control with 'Older than 7 days — ask a coach to
 * change this.'" Previously the locked row rendered a bare "Locked" with no
 * explanation.
 */

// @vitest-environment jsdom

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { SessionActions } from "@/components/training/my-training-tab";
import { OLD_SESSION_LOCKED_LABEL } from "@/lib/training";

describe("OLD_SESSION_LOCKED_LABEL", () => {
  it("matches the spec copy verbatim", () => {
    expect(OLD_SESSION_LOCKED_LABEL).toBe(
      "Older than 7 days — ask a coach to change this.",
    );
  });
});

describe("SessionActions — editable (inside the window)", () => {
  it("renders Edit and Delete controls", () => {
    render(<SessionActions editable onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByRole("button", { name: /edit/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /delete/i })).toBeTruthy();
  });

  it("does not render the locked explanation", () => {
    render(<SessionActions editable onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.queryByText(OLD_SESSION_LOCKED_LABEL)).toBeNull();
    expect(screen.queryByLabelText(OLD_SESSION_LOCKED_LABEL)).toBeNull();
  });
});

describe("SessionActions — locked (aged out)", () => {
  it("exposes the explanatory copy as the control's accessible name (not just on hover)", () => {
    render(<SessionActions editable={false} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByLabelText(OLD_SESSION_LOCKED_LABEL)).toBeTruthy();
  });

  it("keeps a visible 'Locked' cue and is keyboard-focusable for the tooltip", () => {
    render(<SessionActions editable={false} onEdit={vi.fn()} onDelete={vi.fn()} />);
    const control = screen.getByLabelText(OLD_SESSION_LOCKED_LABEL);
    expect(control.textContent).toContain("Locked");
    expect(control.getAttribute("tabindex")).toBe("0");
  });

  it("offers no edit or delete affordance", () => {
    render(<SessionActions editable={false} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /edit/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });
});
