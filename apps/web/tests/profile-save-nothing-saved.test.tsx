// @vitest-environment jsdom
/**
 * BUG-037: a profile save that changed nothing says so
 * (docs/bugs/fixed/037-profile-save-reports-success-when-nothing-saved.md).
 *
 * An update the permission rules restrict to no rows returns no error, so each
 * save asks for the changed rows back (`.select("id")`) and treats none as a
 * failure, with "Couldn't save your changes. Refresh the page and try again."
 * (decided 2026-10-16). Covers the five saves the ticket lists.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const NOTHING_SAVED = "Couldn't save your changes. Refresh the page and try again.";

const mocks = vi.hoisted(() => {
  const state = { rows: [{ id: "p-1" }] as { id: string }[], updates: [] as Record<string, unknown>[] };
  const refresh = vi.fn();
  const from = (table: string) => {
    let selected = false;
    const chain: Record<string, unknown> = {};
    chain.update = (values: Record<string, unknown>) => {
      if (table === "profiles") state.updates.push(values);
      return chain;
    };
    chain.eq = () => chain;
    chain.select = () => {
      selected = true;
      return chain;
    };
    // Without .select(), PostgREST returns no rows (data: null) and no error,
    // whether or not the update matched anything.
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve({ data: selected ? state.rows.map((r) => ({ ...r })) : null, error: null }).then(res, rej);
    return chain;
  };
  return { state, refresh, client: { from } };
});

vi.mock("@/lib/supabase/client", () => ({ createClient: () => mocks.client }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/layout/navigation-progress", () => ({ useNavigate: () => ({ navigate: vi.fn() }) }));
vi.mock("@/components/team/managers-card", () => ({ ManagersCard: () => null }));
vi.mock("@/app/actions/team", () => ({ removeTeamMember: vi.fn() }));
// The upload itself isn't under test: a button hands the form a new photo URL.
vi.mock("@/components/ui/image-upload", () => ({
  ImageUpload: ({ onUpload }: { onUpload: (url: string) => Promise<void> }) => (
    <button type="button" onClick={() => onUpload("https://cdn.example/new.png")}>
      Upload photo
    </button>
  ),
}));

import { toast } from "sonner";
import { ProfileForm } from "@/components/settings/profile-form";
import { RosterProfile } from "@/components/team/roster-profile";
import { TrainingLeaderboardToggle } from "@/components/settings/training-leaderboard-toggle";

const PROFILE = {
  id: "p-1",
  first_name: "Mia",
  last_name: "Chen",
  birthday: null,
  gender: null,
  avatar_url: null,
  email: "mia@example.com",
} as never;

function renderRosterEdit({ canEditProfile = true, isAdmin = true } = {}) {
  render(
    <RosterProfile
      canEditProfile={canEditProfile}
      member={{ id: "tm-1", team_id: "team-1", profile_id: "p-1", role: "player", jersey_number: null, position: null, profiles: PROFILE } as never}
      managers={[]}
      pendingInvites={[]}
      canEdit
      canRemoveManagers={false}
      isAdmin={isAdmin}
      isOwnProfile={false}
      teamId="team-1"
    />
  );
  fireEvent.click(screen.getByRole("button", { name: /Edit/ }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.rows = [{ id: "p-1" }];
  mocks.state.updates.length = 0;
});

afterEach(cleanup);

const nothingSaved = () => {
  mocks.state.rows = [];
};

describe("BUG-037: the settings profile form", () => {
  it("a save that changed nothing says so, not \"Profile updated\"", async () => {
    nothingSaved();
    render(<ProfileForm profile={PROFILE} />);

    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(NOTHING_SAVED));
    expect(toast.success).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("a save that changed the row still says Profile updated", async () => {
    render(<ProfileForm profile={PROFILE} />);

    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Profile updated"));
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("a photo that didn't save says so", async () => {
    nothingSaved();
    render(<ProfileForm profile={PROFILE} />);

    fireEvent.click(screen.getByRole("button", { name: "Upload photo" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(NOTHING_SAVED));
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe("BUG-037: a member's profile, edited from the roster", () => {
  it("a save that changed nothing says so", async () => {
    nothingSaved();
    renderRosterEdit();

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(NOTHING_SAVED));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("a save that changed the row still says Profile updated", async () => {
    renderRosterEdit();

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Profile updated"));
  });

  it("a photo that didn't save says so", async () => {
    nothingSaved();
    renderRosterEdit();

    fireEvent.click(screen.getByRole("button", { name: "Upload photo" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(NOTHING_SAVED));
  });
});

describe("BUG-037: the training leaderboard toggle", () => {
  it("a change that saved nothing says so, and the switch goes back", async () => {
    nothingSaved();
    render(<TrainingLeaderboardToggle profile={{ id: "p-1", firstName: "Mia", optedOut: false }} />);
    const toggle = screen.getByRole("switch");

    fireEvent.click(toggle);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(NOTHING_SAVED));
    expect(toast.success).not.toHaveBeenCalled();
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  it("a change that saved still confirms it", async () => {
    render(<TrainingLeaderboardToggle profile={{ id: "p-1", firstName: "Mia", optedOut: false }} />);

    fireEvent.click(screen.getByRole("switch"));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("You're hidden from training leaderboards."));
  });
});

// ── Decided 2026-10-16: coaches don't edit players' profiles ─────────────────

describe("BUG-037: a coach editing a player who isn't theirs", () => {
  it("edits the team fields only: the profile shows, read-only", () => {
    renderRosterEdit({ canEditProfile: false });

    // The profile, as on the read-only page, with no form or photo upload.
    expect(screen.getByText("Mia")).toBeTruthy();
    expect(screen.queryByLabelText("First name")).toBeNull();
    expect(screen.queryByRole("button", { name: "Upload photo" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    // The team fields stay.
    expect(screen.getByText("Admin Actions")).toBeTruthy();
    expect(screen.getByText("Jersey number")).toBeTruthy();
  });

  it("the player, or a guardian, still edits the profile", () => {
    renderRosterEdit({ canEditProfile: true, isAdmin: false });

    expect(screen.getByLabelText("First name")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
    expect(screen.queryByText("Admin Actions")).toBeNull();
  });
});
