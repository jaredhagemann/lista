import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { setActiveTeam } from "@/app/actions/team";
import { findClubTeam } from "@/lib/club/open";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Opens a named club's settings (BUG-028 review).
 *
 * Club settings pick the club from the active team, so a plain link opens
 * whichever club that team is in, or bounces to the dashboard when it isn't in
 * one. A deletion refusal names the club an owner must hand over; its link comes
 * here. The route checks the viewer is an owner or director of the club, then
 * switches to one of the club's teams they're on (findClubTeam) through the team
 * picker's own setActiveTeam, and opens settings.
 * The dashboard layout then moves the page to the club's subdomain (BUG-027).
 *
 *   GET /dashboard/club/open?org=<organization id>
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const orgId = url.searchParams.get("org");
  const dashboard = new URL("/dashboard", url.origin);

  if (!orgId || !UUID.test(orgId)) return NextResponse.redirect(dashboard);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(dashboard);

  const teamId = await findClubTeam(supabase, user.id, orgId);
  if (!teamId) return NextResponse.redirect(dashboard);

  const result = await setActiveTeam(teamId);
  if (!result || "error" in result) return NextResponse.redirect(dashboard);

  return NextResponse.redirect(new URL("/dashboard/club/settings", url.origin));
}
