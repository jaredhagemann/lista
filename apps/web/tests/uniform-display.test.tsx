// @vitest-environment jsdom
/**
 * Showing and choosing uniform colors (spec: docs/specs/game-display-and-uniform-colors.md).
 *
 * UniformLabel: the uniform's name on a pill filled with its color, black or
 * white text, a border in whichever theme the fill would vanish into; plain text
 * without a color. UniformDot: the calendar's dot, bordered against the green
 * game chip. UniformColorPicker: the twelve kit colors, a custom color, clear.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { UniformLabel, UniformDot } from "@/components/events/uniform-label";
import { UniformColorPicker } from "@/components/events/uniform-color-picker";

afterEach(cleanup);

describe("UniformLabel", () => {
  it("shows the name on a pill in the uniform's color, with readable text", () => {
    render(<UniformLabel uniform={{ name: "Navy", color: "#1e3a8a" }} />);

    const pill = screen.getByLabelText("Uniform: Navy");
    expect(pill.textContent).toBe("Navy");
    expect(pill.style.backgroundColor).toBe("rgb(30, 58, 138)");
    expect(pill.style.color).toBe("rgb(255, 255, 255)");
  });

  it("uses black text on a light color", () => {
    render(<UniformLabel uniform={{ name: "Gold", color: "#eab308" }} />);

    expect(screen.getByLabelText("Uniform: Gold").style.color).toBe("rgb(0, 0, 0)");
  });

  it("borders white in the light theme only, and black in the dark theme only", () => {
    render(
      <>
        <UniformLabel uniform={{ name: "White", color: "#ffffff" }} />
        <UniformLabel uniform={{ name: "Black", color: "#111111" }} />
        <UniformLabel uniform={{ name: "Red", color: "#dc2626" }} />
      </>
    );

    const white = screen.getByLabelText("Uniform: White");
    const black = screen.getByLabelText("Uniform: Black");
    const red = screen.getByLabelText("Uniform: Red");
    expect([white.dataset.borderLight, white.dataset.borderDark]).toEqual(["true", "false"]);
    expect([black.dataset.borderLight, black.dataset.borderDark]).toEqual(["false", "true"]);
    expect([red.dataset.borderLight, red.dataset.borderDark]).toEqual(["false", "false"]);
    expect(white.className).toMatch(/(^|\s)border(\s|$)/);
    expect(black.className).toContain("dark:border");
  });

  it("without a color, shows the name as plain text", () => {
    render(<UniformLabel uniform={{ name: "Home uniform", color: null }} />);

    const label = screen.getByLabelText("Uniform: Home uniform");
    expect(label.textContent).toBe("Home uniform");
    expect(label.style.backgroundColor).toBe("");
  });

  it("renders nothing for a game with no uniform", () => {
    const { container } = render(<UniformLabel uniform={null} />);
    expect(container.textContent).toBe("");
  });
});

describe("UniformDot", () => {
  it("is a dot in the uniform's color, bordered where it matches the green game chip", () => {
    render(
      <>
        <UniformDot uniform={{ name: "Mint", color: "#dcfce7" }} />
        <UniformDot uniform={{ name: "Forest", color: "#0f2e1c" }} />
        <UniformDot uniform={{ name: "Red", color: "#dc2626" }} />
      </>
    );

    const mint = screen.getByLabelText("Uniform: Mint");
    const forest = screen.getByLabelText("Uniform: Forest");
    const red = screen.getByLabelText("Uniform: Red");
    expect(mint.style.backgroundColor).toBe("rgb(220, 252, 231)");
    expect([mint.dataset.borderLight, mint.dataset.borderDark]).toEqual(["true", "false"]);
    expect([forest.dataset.borderLight, forest.dataset.borderDark]).toEqual(["false", "true"]);
    expect([red.dataset.borderLight, red.dataset.borderDark]).toEqual(["false", "false"]);
  });

  it("renders nothing without a color", () => {
    const { container } = render(<UniformDot uniform={{ name: "Home uniform", color: null }} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("UniformColorPicker", () => {
  it("offers the twelve kit colors and picks one", () => {
    const onChange = vi.fn();
    render(<UniformColorPicker label="Home uniform color" value={null} onChange={onChange} />);

    expect(screen.getAllByRole("button", { name: /^(White|Black|Gray|Navy|Royal|Sky|Red|Maroon|Green|Gold|Orange|Purple)$/ })).toHaveLength(12);
    fireEvent.click(screen.getByRole("button", { name: "Navy" }));
    expect(onChange).toHaveBeenCalledWith("#1e3a8a");
  });

  it("marks the chosen color", () => {
    render(<UniformColorPicker label="Home uniform color" value="#1e3a8a" onChange={() => {}} />);

    expect(screen.getByRole("button", { name: "Navy" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Red" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("takes a custom color, lowercased", () => {
    const onChange = vi.fn();
    render(<UniformColorPicker label="Home uniform color" value={null} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Custom color"), { target: { value: "#ABCDEF" } });
    expect(onChange).toHaveBeenCalledWith("#abcdef");
  });

  it("clears the color", () => {
    const onChange = vi.fn();
    render(<UniformColorPicker label="Home uniform color" value="#1e3a8a" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Clear color" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
