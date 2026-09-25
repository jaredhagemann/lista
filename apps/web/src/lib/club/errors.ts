import { NextResponse } from "next/server";

/**
 * How the club functions' refusals (BUG-013) reach the client. Each function
 * raises a stable marker at the start of its message; the rest is for people.
 */
const REFUSALS: Array<[marker: string, status: number, message: string]> = [
  ["NOT_AUTHORIZED", 403, "Only the club owner can do that"],
  ["NOT_A_DIRECTOR", 404, "That person is not a director of this club"],
  ["ALREADY_MEMBER", 409, "That person is already the owner or a director of this club"],
  ["TRANSFER_PENDING", 409, "There is already a pending ownership transfer. Cancel it first."],
  ["TRANSFER_NOT_PENDING", 409, "This transfer is no longer pending"],
  ["TRANSFER_STALE", 409, "Ownership or directorship changed since this transfer began"],
  ["TRANSFER_EXPIRED", 410, "This transfer has expired. Ask the owner to send a new one."],
  ["TRANSFER_NOT_FOUND", 404, "Transfer not found"],
  ["CLUB_CLOSED", 409, "This club is closed"],
  ["NAME_MISMATCH", 400, "Type the club's name exactly to confirm"],
];

export function clubRefusal(error: { message: string }, fallback: string): NextResponse {
  const match = REFUSALS.find(([marker]) => error.message.includes(marker));
  if (match) {
    const [, status, message] = match;
    return NextResponse.json({ error: message }, { status });
  }
  console.error(`${fallback}:`, error.message);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
