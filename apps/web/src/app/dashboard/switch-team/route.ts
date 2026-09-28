import { NextResponse } from "next/server";
import { setActiveTeam } from "@/app/actions/team";
import { sanitizeNext } from "@/lib/auth/sanitize-next";

/**
 * Switches the active team, then returns to `next` (BUG-026).
 *
 * A link to another team's event lands here from the event page: a page can't
 * set the "viewing as" cookie, so the switch is a route. It goes through the
 * team picker's own setActiveTeam, which checks that the viewer (or a player
 * they manage) is on the team. The way back is marked switched=1 so a switch
 * that didn't take can't bounce between the two.
 *
 *   GET /dashboard/switch-team?team=<team id>&next=<same-site path>
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const teamId = url.searchParams.get("team");
  const dashboard = new URL("/dashboard", url.origin);

  if (!teamId) return NextResponse.redirect(dashboard);

  const result = await setActiveTeam(teamId);
  if (!result || "error" in result) return NextResponse.redirect(dashboard);

  const back = new URL(sanitizeNext(url.searchParams.get("next")), url.origin);
  back.searchParams.set("switched", "1");
  return NextResponse.redirect(back);
}
