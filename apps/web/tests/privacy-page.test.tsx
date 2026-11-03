// @vitest-environment jsdom
/**
 * What the privacy page says is shared, and with whom (BUG-004, D8).
 *
 * The page once said email was visible only to team admins, while any teammate
 * could read it. tests/rls/profiles.test.ts establishes who can read what, by
 * direct query, and the team page adds a guardian's contact details for all its
 * members. Change either, and these claims must change with it.
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import PrivacyPage from "@/app/privacy/page";

afterEach(cleanup);

function sharingSection() {
  render(<PrivacyPage />);
  return screen.getByRole("heading", { name: "Information shared with teammates" }).closest("section")!.textContent!;
}

describe("the privacy page's sharing section", () => {
  it("says teammates can see email, date of birth and gender", () => {
    const text = sharingSection();

    expect(text).toContain("Other members of a team you belong to");
    expect(text).toContain("Your email address.");
    expect(text).toContain("Your date of birth and gender, if you've added them.");
  });

  it("no longer limits email to admins", () => {
    expect(sharingSection()).not.toContain("visible to team admins");
  });

  it("covers parents and guardians, and a child's managed profile", () => {
    const text = sharingSection();

    expect(text).toContain("including the parents and guardians of its players");
    expect(text).toContain("A child's managed profile is shared the same way");
    expect(text).toContain("your email address, and your phone number if you've added one, even if you aren't on the team yourself");
    expect(text).toContain("The coaches and managers of those teams can also see your date of birth and gender");
  });

  it("says club directors and owners see their whole club", () => {
    expect(sharingSection()).toContain("Club directors and owners can see these details for everyone on their club's teams");
  });

  it("says other teams in the club can't see these details", () => {
    expect(sharingSection()).toContain(
      "Members of other teams in your club, and people outside your teams, can't see your email address, phone number, date of birth, or gender."
    );
  });

  // Photos are left out of that promise until BUG-016 settles how they're served.
  it("makes no promise that photos stay within the team", () => {
    const promise = sharingSection().split("can't see")[1];

    expect(promise).not.toContain("photo");
  });

  it("carries the date of this change, as its Changes section promises", () => {
    render(<PrivacyPage />);

    expect(screen.getByText("Effective date: November 3, 2026")).toBeTruthy();
  });
});
