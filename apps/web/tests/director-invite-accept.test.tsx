// @vitest-environment jsdom
/**
 * Accepting a director invitation from the invite page (BUG-013, part 1).
 *
 * A director invitation is to a club, not a team. The accept screen names the
 * club and says what the role is, and a new director lands on the club portal
 * rather than a roster entry.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  accept: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: vi.fn() }) }));
vi.mock("@/app/actions/invite", () => ({ acceptInvitationAsSelf: mocks.accept }));

import { DirectAcceptClient } from "@/components/invite/direct-accept-client";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.accept.mockResolvedValue({ success: true, memberId: "member-1" });
});

afterEach(cleanup);

describe("a director invitation", () => {
  it("names the club and the role", () => {
    render(<DirectAcceptClient invitationId="inv-1" teamName="Westside FC" role="director" />);

    expect(screen.getByText("Westside FC")).toBeTruthy();
    expect(screen.getByText(/help run a club/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /accept & join club/i })).toBeTruthy();
  });

  it("lands the new director on the club portal", async () => {
    render(<DirectAcceptClient invitationId="inv-1" teamName="Westside FC" role="director" />);

    fireEvent.click(screen.getByRole("button", { name: /accept/i }));

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/dashboard/club"));
    expect(mocks.accept).toHaveBeenCalledWith("inv-1");
  });
});

describe("a coach invitation (unchanged)", () => {
  it("joins the team and lands on the roster entry", async () => {
    render(<DirectAcceptClient invitationId="inv-2" teamName="U10 Girls" role="coach" />);

    expect(screen.getByRole("button", { name: /accept & join team/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /accept/i }));

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/dashboard/team/member-1"));
  });
});
