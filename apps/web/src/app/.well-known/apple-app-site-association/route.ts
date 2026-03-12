import { NextResponse } from "next/server";

// Apple App Site Association file for Universal Links.
// Tells iOS that lista.team/invite/* and lista.team/auth/* should open the
// Lista app instead of Safari.
//
// TODO: Replace APPLE_TEAM_ID with the 10-character Team ID from
//       developer.apple.com → Membership once the Apple Developer account
//       is approved.
const AASA = {
  applinks: {
    apps: [],
    details: [
      {
        appID: "APPLE_TEAM_ID.com.acg.lista",
        paths: ["/invite/*", "/auth/*"],
      },
    ],
  },
};

export function GET() {
  return new NextResponse(JSON.stringify(AASA), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
