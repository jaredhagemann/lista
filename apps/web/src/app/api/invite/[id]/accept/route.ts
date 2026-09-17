import { NextResponse } from "next/server";
import { resolveRequestUser, adminClient } from "@/lib/api-auth";
import { acceptInvitation, type AcceptFailure } from "@/lib/invitations/accept";

// Accepts an invitation. Supports both mobile callers (Bearer token) and
// web callers (cookie session) via the shared resolveRequestUser helper.
// Recipient, invitation kind and one-time acceptance are all enforced by
// acceptInvitation (BUG-012).

const FAILURE_RESPONSES: Record<AcceptFailure, { status: number; error?: string }> = {
  not_found: { status: 404 },
  already_accepted: { status: 410 },
  wrong_recipient: { status: 403, error: "Forbidden" },
  wrong_type: { status: 400 },
  failed: { status: 500 },
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const user = await resolveRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { type?: string };
  if (body.type !== "self" && body.type !== "manager") {
    return NextResponse.json({ error: "Invalid invitation type" }, { status: 400 });
  }

  const result = await acceptInvitation(adminClient(), {
    invitationId: id,
    userId: user.id,
    mode: body.type,
  });

  if (!result.ok) {
    const { status, error } = FAILURE_RESPONSES[result.reason];
    return NextResponse.json({ error: error ?? result.message }, { status });
  }

  return NextResponse.json({ success: true });
}
