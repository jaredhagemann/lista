// @vitest-environment jsdom
/**
 * BUG-046: on the roster, removing a club owner or director from a team only
 * changes their role, and a director row has no Remove.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  removeTeamMember: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/layout/navigation-progress", () => ({ useNavigate: () => ({ navigate: mocks.navigate }) }));
vi.mock("@/components/team/managers-card", () => ({ ManagersCard: () => null }));
vi.mock("@/app/actions/team", () => ({ removeTeamMember: mocks.removeTeamMember }));

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

function renderMember(role: string) {
  render(
    <RosterProfile
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

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("removing a club director who coaches the team", () => {
  it("says they stay on the team as a director", async () => {
    mocks.removeTeamMember.mockResolvedValue({ success: true, keptAsDirector: true });
    renderMember("coach");

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
    renderMember("director");

    expect(screen.queryByRole("button", { name: "Remove from team" })).toBeNull();
  });
});
