// @vitest-environment jsdom
/**
 * Choosing uniform colors in team settings (spec: docs/specs/game-display-and-uniform-colors.md).
 *
 * Each uniform has an optional color beside its name: a kit color, a custom
 * one, or none. View mode shows each uniform as games will show it. The name
 * and the color are independent — picking a color never renames the uniform.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";

const mocks = vi.hoisted(() => {
  const updates: Array<Record<string, unknown>> = [];
  return {
    updates,
    client: {
      from: () => ({
        update: (values: Record<string, unknown>) => {
          updates.push(values);
          return { eq: () => Promise.resolve({ error: null }) };
        },
      }),
      storage: { from: () => ({}) },
    },
  };
});

vi.mock("@/lib/supabase/client", () => ({ createClient: () => mocks.client }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/ui/image-upload", () => ({ ImageUpload: () => null }));

import { TeamSettingsForm } from "@/components/settings/team-settings-form";
import type { Database } from "@/types/database";

type Team = Database["public"]["Tables"]["teams"]["Row"];

function team(overrides: Partial<Team> = {}): Team {
  return {
    id: "team-1",
    name: "U10 Girls",
    home_uniform: "Navy",
    away_uniform: "White",
    home_uniform_color: "#1e3a8a",
    away_uniform_color: null,
    ...overrides,
  } as Team;
}

beforeEach(() => {
  mocks.updates.length = 0;
});

afterEach(cleanup);

describe("team settings: uniforms", () => {
  it("view mode shows each uniform as games will: a pill when it has a color, the name when not", () => {
    render(<TeamSettingsForm team={team()} isAdmin />);

    expect(screen.getByLabelText("Uniform: Navy").style.backgroundColor).toBe("rgb(30, 58, 138)");
    expect(screen.getByLabelText("Uniform: White").style.backgroundColor).toBe("");
  });

  it("a color without a name shows as 'Away uniform'; neither shows a dash", () => {
    render(
      <TeamSettingsForm
        team={team({ home_uniform: null, home_uniform_color: null, away_uniform: null, away_uniform_color: "#dc2626" })}
        isAdmin
      />
    );

    expect(screen.getByLabelText("Uniform: Away uniform").style.backgroundColor).toBe("rgb(220, 38, 38)");
    expect(screen.queryByLabelText(/Uniform: Home/)).toBeNull();
  });

  it("picks, changes and clears colors, saving #rrggbb or null and leaving the names alone", async () => {
    render(<TeamSettingsForm team={team()} isAdmin />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    fireEvent.click(within(screen.getByRole("group", { name: "Home uniform color" })).getByRole("button", { name: "Clear color" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Away uniform color" })).getByRole("button", { name: "Gold" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocks.updates).toHaveLength(1));
    expect(mocks.updates[0]).toMatchObject({
      home_uniform: "Navy",
      away_uniform: "White",
      home_uniform_color: null,
      away_uniform_color: "#eab308",
    });
  });

  it("takes a custom color", async () => {
    render(<TeamSettingsForm team={team()} isAdmin />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    fireEvent.change(within(screen.getByRole("group", { name: "Home uniform color" })).getByLabelText("Custom color"), {
      target: { value: "#123abc" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocks.updates).toHaveLength(1));
    expect(mocks.updates[0].home_uniform_color).toBe("#123abc");
  });
});
