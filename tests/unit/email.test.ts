import { describe, it, expect } from "vitest";
import { buildInviteEmailHtml } from "@/lib/notifications/email";
import { buildTeamDeletionEmailHtml } from "@/lib/notifications/team-deletion";

describe("buildInviteEmailHtml", () => {
  const params = {
    teamName: "U12 Blue",
    inviterName: "Coach Sarah",
    role: "player",
    inviteUrl: "https://lista.app/invite/abc123",
  };

  it("contains the team name", () => {
    const html = buildInviteEmailHtml(params);
    expect(html).toContain("U12 Blue");
  });

  it("contains the inviter name", () => {
    const html = buildInviteEmailHtml(params);
    expect(html).toContain("Coach Sarah");
  });

  it("contains the role", () => {
    const html = buildInviteEmailHtml(params);
    expect(html).toContain("player");
  });

  it("contains the invite URL as a button href and plain text", () => {
    const html = buildInviteEmailHtml(params);
    expect(html).toContain(`href="${params.inviteUrl}"`);
    const plainTextOccurrences = html.split(params.inviteUrl).length - 1;
    expect(plainTextOccurrences).toBeGreaterThanOrEqual(2);
  });

  it("produces valid-looking HTML", () => {
    const html = buildInviteEmailHtml(params);
    expect(html).toContain("<table");
    expect(html).toContain("<a ");
    expect(html).toContain("</table>");
    expect(html).toContain("</a>");
  });
});

describe("buildTeamDeletionEmailHtml", () => {
  const teamName = "U12 Blue";
  const html = buildTeamDeletionEmailHtml({ teamName });

  it("contains the team name", () => {
    expect(html).toContain(teamName);
  });

  it("indicates the team has been permanently deleted", () => {
    expect(html.toLowerCase()).toContain("deleted");
    expect(html.toLowerCase()).toContain("permanently");
  });

  it("does not contain an action button or invite link", () => {
    expect(html).not.toContain("href=");
  });

  it("produces valid-looking HTML", () => {
    expect(html).toContain("<table");
    expect(html).toContain("</table>");
    expect(html).toContain("</html>");
  });
});
