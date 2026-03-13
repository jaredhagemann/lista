import { NextResponse } from "next/server";

// Apple App Site Association file for Universal Links.
// Tells iOS that lista.team/invite/* and lista.team/auth/* should open the
// Lista app instead of Safari.
//
const AASA = {
  applinks: {
    apps: [],
    details: [
      {
        appID: "5CY96K8QSL.com.acg.lista",
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
