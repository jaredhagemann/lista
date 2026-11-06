// @vitest-environment jsdom
/**
 * BUG-046: on the roster, removing a club owner or director from a team only
 * changes their role, and a director row has no Remove. The role editor offers
 * Director for a club owner or director, and only for them.
 */
import React from "react";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  removeTeamMember: vi.fn(),
  navigate: vi.fn(),
  updates: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.update = (values: Record<string, unknown>) => {
        mocks.updates.push(values);
        return chain;
      };
      chain.eq = () => chain;
      chain.select = () => chain;
      chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [{ id: "tm-1" }], error: null }).then(res);
      return chain;
    },
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/layout/navigation-progress", () => ({ useNavigate: () => ({ navigate: mocks.navigate }) }));
vi.mock("@/components/team/managers-card", () => ({ ManagersCard: () => null }));
vi.mock("@/app/actions/team", () => ({ removeTeamMember: mocks.removeTeamMember }));
// A native select in place of the styled one, which jsdom can't open.
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (v: string) => void; children: React.ReactNode }) => (
    <select aria-label="Role" value={value} onChange={(e) => onValueChange(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
}));

import { toast } from "sonner";
import { RosterProfile } from "@/components/team/roster-profile";

const PROFILE = {
  id: "p-1",
  first_name: "Dana",
  last_name: "Reyes",
  birthday: null,
  gender: null,
  avatar_url: null,
  email: "dana@example.com",
} as never;

function renderMember(role: string, { isClubDirector = false } = {}) {
  render(
    <RosterProfile
      isClubDirector={isClubDirector}
      canEditProfile={false}
      member={{ id: "tm-1", team_id: "team-1", profile_id: "p-1", role, jersey_number: null, position: null, profiles: PROFILE } as never}
      managers={[]}
      pendingInvites={[]}
      canEdit
      canRemoveManagers={false}
      isAdmin
      isOwnProfile={false}
      teamId="team-1"
    />
  );
}

async function remove() {
  fireEvent.click(screen.getByRole("button", { name: "Remove from team" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(mocks.removeTeamMember).toHaveBeenCalledWith("tm-1", "team-1"));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updates.length = 0;
});

function renderEditing(role: string, options?: { isClubDirector?: boolean }) {
  renderMember(role, options);
  fireEvent.click(screen.getByRole("button", { name: /Edit/ }));
}

/** The Save beside the role, not the jersey or position ones. */
const saveRole = () =>
  fireEvent.click(within(screen.getByRole("combobox", { name: "Role" }).parentElement!).getByRole("button", { name: "Save" }));

const roleOptions = () =>
  Array.from(screen.getByRole("combobox", { name: "Role" }).querySelectorAll("option")).map((o) => o.textContent);
afterEach(cleanup);

describe("the role editor", () => {
  it("offers Director for a club owner or director, and saves it", async () => {
    renderEditing("coach", { isClubDirector: true });

    expect(roleOptions()).toEqual(["Coach", "Manager", "Player", "Director"]);
    fireEvent.change(screen.getByRole("combobox", { name: "Role" }), { target: { value: "director" } });
    saveRole();

    await waitFor(() => expect(mocks.updates).toContainEqual({ role: "director" }));
  });

  it("lets a director row be given a team role", async () => {
    renderEditing("director", { isClubDirector: true });

    expect((screen.getByRole("combobox", { name: "Role" }) as HTMLSelectElement).value).toBe("director");
    fireEvent.change(screen.getByRole("combobox", { name: "Role" }), { target: { value: "manager" } });
    saveRole();

    await waitFor(() => expect(mocks.updates).toContainEqual({ role: "manager" }));
  });

  it("doesn't offer Director for anyone else", () => {
    renderEditing("player");

    expect(roleOptions()).toEqual(["Coach", "Manager", "Player"]);
  });
});

describe("removing a club director who coaches the team", () => {
  it("says in the confirmation that they stay on as a director", () => {
    renderMember("coach", { isClubDirector: true });

    fireEvent.click(screen.getByRole("button", { name: "Remove from team" }));

    expect(screen.getByText(/is a club director, so they.ll stay on the team as a director/)).toBeTruthy();
    expect(screen.queryByText(/will lose all access to team pages/)).toBeNull();
  });

  it("says they stay on the team as a director", async () => {
    mocks.removeTeamMember.mockResolvedValue({ success: true, keptAsDirector: true });
    renderMember("coach", { isClubDirector: true });

    await remove();

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Dana Reyes is a club director, so they stay on the team as a director."
      )
    );
    expect(mocks.navigate).toHaveBeenCalledWith("/dashboard/team");
  });
});

describe("removing anyone else", () => {
  it("says they were removed, as before", async () => {
    mocks.removeTeamMember.mockResolvedValue({ success: true });
    renderMember("player");

    await remove();

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Member removed from team"));
  });
});

describe("a director row", () => {
  it("has no Remove from team", () => {
    renderMember("director", { isClubDirector: true });

    expect(screen.queryByRole("button", { name: "Remove from team" })).toBeNull();
  });
});
