// @vitest-environment jsdom
/**
 * The event page's availability responses.
 *
 * Each row showed the name first and the ✓ ? ✗ icon after it, so the icons sat
 * at a different place on every row; a coach changed a player's response with a
 * dropdown on the far right. Now every row leads with its icon — or, for a
 * coach, the same ✓ ? ✗ picker as "Your availability" — then the name.
 * Decisions (2026-09-25): a changed row moves to its new group at once; tapping
 * the selected answer again clears it.
 *
 * Responses are for players: what a coach glances at to see whether there are
 * enough for the game. Everyone else on the roster (coaches, managers,
 * directors, parents) is listed in a compact "Coaches & staff" section below,
 * read-only for everyone: staff answer for themselves in "Your availability".
 * The summary counts players only.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";

const mocks = vi.hoisted(() => {
  const calls: Array<{ op: string; values?: unknown }> = [];
  let failNext = false;
  const outcome = () => {
    const error = failNext ? { message: "Network down" } : null;
    failNext = false;
    return Promise.resolve({ error });
  };
  const chain: Record<string, unknown> = {
    upsert: (values: unknown) => {
      calls.push({ op: "upsert", values });
      return outcome();
    },
    delete: () => {
      calls.push({ op: "delete" });
      const d: Record<string, unknown> = { eq: () => d, then: (res: (v: unknown) => unknown) => outcome().then(res) };
      return d;
    },
  };
  return {
    calls,
    failOnce: () => {
      failNext = true;
    },
    client: { from: () => chain },
    toastError: vi.fn(),
  };
});

vi.mock("@/lib/supabase/client", () => ({ createClient: () => mocks.client }));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError, success: vi.fn() } }));

import { ResponseList } from "@/components/availability/response-list";
import { RsvpButtons } from "@/components/availability/rsvp-buttons";

const MEMBERS = [
  { profileId: "coach-1", name: "Coach Casey", role: "coach" },
  { profileId: "p-ava", name: "Ava Smith", role: "player" },
  { profileId: "p-bartholomew", name: "Bartholomew Longname-Jones", role: "player" },
  { profileId: "p-cy", name: "Cy", role: "player" },
  { profileId: "m-morgan", name: "Morgan Manager", role: "manager" },
  { profileId: "g-pat", name: "Pat Parent", role: "parent" },
];
const ROWS = [
  { profileId: "coach-1", status: "available" as const },
  { profileId: "p-ava", status: "available" as const },
  { profileId: "p-bartholomew", status: "unavailable" as const },
  { profileId: "m-morgan", status: "maybe" as const },
];

function renderList(isAdmin: boolean) {
  return render(
    <ResponseList eventId="evt-1" members={MEMBERS} initialRows={ROWS} isAdmin={isAdmin} currentUserId="coach-1" />
  );
}

/** The row that names a member. */
function rowOf(name: string) {
  return screen.getByText(name).closest("[data-member-row]") as HTMLElement;
}

/** The heading of the group a member's row sits under. */
function groupOf(name: string) {
  return rowOf(name).closest("[data-group]")?.getAttribute("data-group");
}

/** Whether `a` comes before `b` in the document. */
function before(a: Element, b: Element) {
  return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.toastError.mockClear();
});

afterEach(cleanup);

describe("a player viewing responses", () => {
  it("each row leads with its icon, then the name", () => {
    renderList(false);

    for (const [name, label] of [
      ["Ava Smith", "Available"],
      ["Bartholomew Longname-Jones", "Unavailable"],
    ]) {
      const row = rowOf(name);
      const icon = within(row).getByLabelText(label);
      expect(before(icon, within(row).getByText(name))).toBe(true);
    }
  });

  it("a member with no response leads with a placeholder the same width, so names line up", () => {
    renderList(false);

    const placeholder = within(rowOf("Cy")).getByLabelText("No response");
    const icon = within(rowOf("Ava Smith")).getByLabelText("Available");
    expect(before(placeholder, within(rowOf("Cy")).getByText("Cy"))).toBe(true);
    expect(placeholder.className).toContain("w-5");
    expect(icon.className).toContain("w-5");
  });

  it("has no pickers", () => {
    renderList(false);

    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("a coach viewing responses", () => {
  it("each teammate's row leads with the ✓ ? ✗ picker, then the name", () => {
    renderList(true);

    const row = rowOf("Ava Smith");
    const picker = within(row).getByRole("group", { name: "Availability for Ava Smith" });
    expect(before(picker, within(row).getByText("Ava Smith"))).toBe(true);
    expect(within(picker).getByRole("button", { name: "Available" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(picker).getByRole("button", { name: "Maybe" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("the coach is not among the players; their row is read-only under Coaches & staff", () => {
    renderList(true);

    expect(groupOf("Coach Casey")).toBe("staff");
    const own = rowOf("Coach Casey");
    expect(within(own).queryByRole("button")).toBeNull();
    expect(within(own).getByLabelText("Available")).toBeTruthy();
  });

  it("other staff are read-only too: coaches manage only players' answers", () => {
    renderList(true);

    expect(within(rowOf("Morgan Manager")).queryByRole("button")).toBeNull();
    expect(within(rowOf("Morgan Manager")).getByLabelText("Maybe")).toBeTruthy();
  });

  it("choosing an answer saves it and moves the row to its new group", async () => {
    renderList(true);
    expect(groupOf("Cy")).toBe("none");

    fireEvent.click(within(rowOf("Cy")).getByRole("button", { name: "Maybe" }));

    await waitFor(() => expect(groupOf("Cy")).toBe("maybe"));
    expect(mocks.calls).toEqual([{ op: "upsert", values: { event_id: "evt-1", profile_id: "p-cy", status: "maybe" } }]);
    expect(screen.getByText(/1 maybe/)).toBeTruthy();
  });

  it("tapping the selected answer again clears it", async () => {
    renderList(true);

    fireEvent.click(within(rowOf("Ava Smith")).getByRole("button", { name: "Available" }));

    await waitFor(() => expect(groupOf("Ava Smith")).toBe("none"));
    expect(mocks.calls).toEqual([{ op: "delete" }]);
  });

  it("a failed save puts the row back and says so", async () => {
    renderList(true);
    mocks.failOnce();

    fireEvent.click(within(rowOf("Ava Smith")).getByRole("button", { name: "Unavailable" }));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("Network down"));
    expect(groupOf("Ava Smith")).toBe("available");
  });
});

describe("Your availability", () => {
  it("uses the same picker: labelled answers, the chosen one pressed, tap again to clear", async () => {
    render(<RsvpButtons eventId="evt-1" profileId="coach-1" initialStatus="maybe" />);

    const picker = screen.getByRole("group", { name: "Your availability" });
    expect(within(picker).getByRole("button", { name: "Maybe" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(within(picker).getByRole("button", { name: "Maybe" }));
    await waitFor(() => expect(mocks.calls).toEqual([{ op: "delete" }]));
    expect(within(picker).getByRole("button", { name: "Maybe" }).getAttribute("aria-pressed")).toBe("false");
  });
});

describe("players first, staff below", () => {
  it("the player groups hold only players", () => {
    renderList(false);

    expect(groupOf("Ava Smith")).toBe("available");
    expect(groupOf("Bartholomew Longname-Jones")).toBe("unavailable");
    expect(groupOf("Cy")).toBe("none");
    for (const staff of ["Coach Casey", "Morgan Manager", "Pat Parent"]) expect(groupOf(staff)).toBe("staff");
  });

  it("the summary and group counts are players only", () => {
    renderList(false);

    // Coach Casey (available) and Morgan Manager (maybe) are not counted.
    expect(screen.getByText("1 available · 1 unavailable")).toBeTruthy();
    expect(screen.getByText("Available (1)")).toBeTruthy();
    expect(screen.queryByText(/maybe/i, { selector: "p" })).toBeNull();
  });

  it("every non-player is under Coaches & staff, each leading with their answer, with their role", () => {
    renderList(false);

    const section = screen.getByRole("region", { name: "Coaches & staff" });
    const rows = within(section).getAllByText(/Coach Casey|Morgan Manager|Pat Parent/);
    expect(rows).toHaveLength(3);
    const morgan = rowOf("Morgan Manager");
    expect(before(within(morgan).getByLabelText("Maybe"), within(morgan).getByText("Morgan Manager"))).toBe(true);
    expect(within(morgan).getByText("Manager")).toBeTruthy();
    expect(within(rowOf("Pat Parent")).getByLabelText("No response")).toBeTruthy();
  });

  it("the staff section comes after the players", () => {
    renderList(false);

    const staff = screen.getByRole("region", { name: "Coaches & staff" });
    expect(before(rowOf("Cy"), staff)).toBe(true);
  });

  it("with no staff, there is no staff section", () => {
    render(
      <ResponseList
        eventId="evt-1"
        members={MEMBERS.filter((m) => m.role === "player")}
        initialRows={ROWS}
        isAdmin={false}
        currentUserId="p-ava"
      />
    );

    expect(screen.queryByRole("region", { name: "Coaches & staff" })).toBeNull();
  });
});

