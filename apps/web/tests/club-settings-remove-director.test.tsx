// @vitest-environment jsdom
/**
 * BUG-047: removing a director asks first, saying what changes for them, and
 * then says what happened (decisions 2026-11-06).
 */
import React from "react";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";
import { ClubSettingsClient } from "@/components/club/club-settings-client";

const ORG = { id: "org-1", name: "San Luis Obispo FC", orgNamePublic: "SLOFC" };
const OWNER = {
  profile_id: "owner-1",
  role: "owner",
  profiles: { first_name: "Olive", last_name: "Owner", email: "olive@test.local" },
};
const DANA = {
  profile_id: "dana-1",
  role: "director",
  profiles: { first_name: "Dana", last_name: "Director", email: "dana@test.local" },
  impact: {
    directorTeams: 6,
    ownedTeams: ["12U Girls", "14U Boys"],
    otherRoles: [{ team: "12U Girls", role: "coach" }],
  },
};
const SUMMARY = {
  teamsPassed: ["12U Girls", "14U Boys"],
  directorPlacesRemoved: 6,
  rolesKept: [{ team: "12U Girls", role: "coach" }],
};

let fetchMock: ReturnType<typeof vi.fn>;

type Director = React.ComponentProps<typeof ClubSettingsClient>["directors"][number];

function renderSettings(directors: Director[] = [OWNER, DANA]) {
  render(<ClubSettingsClient org={ORG} orgRole="owner" directors={directors} currentUserId="owner-1" />);
}

function respond(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

const removeCalls = () => fetchMock.mock.calls.filter(([url]) => url === "/api/club/directors/remove");

beforeEach(() => {
  fetchMock = vi.fn(() => respond(200, { success: true, summary: SUMMARY }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("removing a director", () => {
  it("asks first, naming them and what changes, and removes nothing yet", () => {
    renderSettings();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Remove Dana Director as a director?")).toBeTruthy();
    const text = dialog.textContent!.replace(/\s+/g, " ");
    expect(text).toContain("This is a big change. Dana will:");
    expect(text).toContain("lose access to the club portal");
    expect(text).toContain("be taken off 6 teams they're on as director");
    expect(text).toContain("hand over the teams they own to you: 12U Girls, 14U Boys");
    expect(text).toContain("Dana stays on 12U Girls as a coach.");
    expect(text).toContain("You can invite Dana again later.");
    expect(removeCalls()).toHaveLength(0);
  });

  it("leaves out what doesn't apply, and says 1 team", () => {
    renderSettings([OWNER, { ...DANA, impact: { directorTeams: 1, ownedTeams: [], otherRoles: [] } }]);

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    const text = screen.getByRole("alertdialog").textContent!.replace(/\s+/g, " ");
    expect(text).toContain("be taken off 1 team they're on as director");
    expect(text).not.toContain("hand over");
    expect(text).not.toContain("stays on");
  });

  it("Cancel removes nothing", () => {
    renderSettings();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(removeCalls()).toHaveLength(0);
  });

  it("confirming removes them once, with the button disabled while it runs", async () => {
    let finish!: (r: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => (finish = resolve)));
    renderSettings();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove director" }));

    const pending = screen.getByRole("button", { name: "Removing…" }) as HTMLButtonElement;
    expect(pending.disabled).toBe(true);
    fireEvent.click(pending);
    expect(removeCalls()).toHaveLength(1);
    expect(JSON.parse(removeCalls()[0][1].body)).toEqual({ orgId: "org-1", profileId: "dana-1" });

    finish(new Response(JSON.stringify({ success: true, summary: SUMMARY }), { status: 200 }));
    await screen.findByText("Dana Director is no longer a director of SLOFC.");
  });

  it("then says what happened, from the server, and Done closes it", async () => {
    renderSettings();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove director" }));

    const dialog = await screen.findByRole("alertdialog");
    await within(dialog).findByText("Dana Director is no longer a director of SLOFC.");
    const text = dialog.textContent!.replace(/\s+/g, " ");
    expect(text).toContain("Passed to you: 12U Girls, 14U Boys");
    expect(text).toContain("Still on: 12U Girls (Coach)");
    expect(mocks.refresh).toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("shows an error in the dialog, and nothing claims success", async () => {
    fetchMock.mockImplementation(() => respond(403, { error: "Only the club owner can remove directors" }));
    renderSettings();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove director" }));

    const dialog = screen.getByRole("alertdialog");
    await within(dialog).findByText("Only the club owner can remove directors");
    expect(within(dialog).queryByText(/no longer a director/)).toBeNull();
    expect(toast.success).not.toHaveBeenCalled();
    expect((within(dialog).getByRole("button", { name: "Remove director" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("still offers no Remove for the owner or yourself", () => {
    renderSettings([OWNER]);
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });
});
