// @vitest-environment jsdom
/**
 * Club ownership and closure on screen (BUG-013, parts 2 and 3).
 *
 * The owner offers the club to a director and can withdraw the offer; the
 * director sees it in the club portal and accepts or declines; the owner can
 * close the club only by typing its name. Decisions (2026-09-24): transfer goes
 * to directors only, expires in 14 days, billing passes to the new owner; closure
 * cancels the subscription at once with no refund and keeps history read-only.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  fetch: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import { ClubOwnershipSection } from "@/components/club/club-ownership-section";
import { CloseClubSection } from "@/components/club/close-club-section";
import { OwnershipOfferBanner } from "@/components/club/ownership-offer-banner";

function ok(body: unknown = { success: true }) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
}

function lastRequest() {
  const [url, init] = mocks.fetch.mock.calls.at(-1) as [string, RequestInit];
  return { url, body: JSON.parse(String(init.body)) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetch.mockImplementation(() => ok());
  vi.stubGlobal("fetch", mocks.fetch);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ── Owner: offering ownership ─────────────────────────────────────────────────

describe("ClubOwnershipSection", () => {
  const directors = [
    { profileId: "dir-1", name: "Dana Director" },
    { profileId: "dir-2", name: "Drew Deputy" },
  ];

  it("offers the club to the chosen director, after saying what happens", async () => {
    render(<ClubOwnershipSection orgId="org-1" directors={directors} pending={null} />);

    fireEvent.change(screen.getByLabelText("New owner"), { target: { value: "dir-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Offer ownership" }));

    expect(await screen.findByText(/become a director/i)).toBeTruthy();
    expect(screen.getAllByText(/billing/i).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Send offer" }));

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
    expect(lastRequest()).toEqual({
      url: "/api/club/ownership/transfer",
      body: { orgId: "org-1", toProfileId: "dir-2" },
    });
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("with no directors, says to invite one first", () => {
    render(<ClubOwnershipSection orgId="org-1" directors={[]} pending={null} />);

    expect(screen.getByText(/invite a director first/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Offer ownership" })).toBeNull();
  });

  it("shows a pending offer, when it expires, and lets the owner withdraw it", async () => {
    render(
      <ClubOwnershipSection
        orgId="org-1"
        directors={directors}
        pending={{ id: "t-1", toName: "Dana Director", expiresAt: "2026-10-08T15:00:00Z" }}
      />
    );

    expect(screen.getByText(/Dana Director/)).toBeTruthy();
    expect(screen.getByText(/October 8, 2026/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Withdraw offer" }));

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
    expect(lastRequest()).toEqual({ url: "/api/club/ownership/cancel", body: { transferId: "t-1" } });
  });

  it("shows the server's refusal", async () => {
    mocks.fetch.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ error: "There is already a pending ownership transfer." }), { status: 409 }))
    );
    render(<ClubOwnershipSection orgId="org-1" directors={directors} pending={null} />);

    fireEvent.change(screen.getByLabelText("New owner"), { target: { value: "dir-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Offer ownership" }));
    fireEvent.click(await screen.findByRole("button", { name: "Send offer" }));

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith("There is already a pending ownership transfer."));
  });
});

// ── Director: answering an offer ──────────────────────────────────────────────

describe("OwnershipOfferBanner", () => {
  const offer = { transferId: "t-1", clubName: "Westside FC", fromName: "Olive Owner", expiresAt: "2026-10-08T15:00:00Z" };

  it("says who offered what, and that billing comes with it", () => {
    render(<OwnershipOfferBanner {...offer} />);

    const text = document.body.textContent ?? "";
    expect(text).toContain("Olive Owner has offered you ownership of Westside FC");
    expect(text).toMatch(/billing/i);
  });

  it("accepting sends the answer and points to billing", async () => {
    render(<OwnershipOfferBanner {...offer} />);

    fireEvent.click(screen.getByRole("button", { name: "Accept ownership" }));

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
    expect(lastRequest()).toEqual({ url: "/api/club/ownership/respond", body: { transferId: "t-1", accept: true } });
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(expect.stringMatching(/billing/i)));
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("declining sends the answer", async () => {
    render(<OwnershipOfferBanner {...offer} />);

    fireEvent.click(screen.getByRole("button", { name: "Decline" }));

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
    expect(lastRequest().body).toEqual({ transferId: "t-1", accept: false });
  });
});

// ── Owner: closing the club ───────────────────────────────────────────────────

describe("CloseClubSection", () => {
  function open() {
    render(<CloseClubSection orgId="org-1" clubName="Westside FC" />);
    fireEvent.click(screen.getByRole("button", { name: "Close club" }));
  }

  it("explains what closing does before anything happens", async () => {
    open();

    expect(await screen.findByText(/read-only/i)).toBeTruthy();
    expect(screen.getByText(/no refund/i)).toBeTruthy();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("stays disabled until the club's name is typed", async () => {
    open();
    const confirm = await screen.findByRole("button", { name: "Close this club" });

    expect(confirm).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText(/type westside fc/i), { target: { value: "westside fc " } });
    expect(confirm).toHaveProperty("disabled", false);
  });

  it("closes the club and leaves the club portal", async () => {
    open();
    fireEvent.change(await screen.findByLabelText(/type westside fc/i), { target: { value: "Westside FC" } });
    fireEvent.click(screen.getByRole("button", { name: "Close this club" }));

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
    expect(lastRequest()).toEqual({ url: "/api/club/close", body: { orgId: "org-1", confirmName: "Westside FC" } });
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/dashboard"));
  });
});
