"use client";

import { useState } from "react";
import { RsvpButtons } from "./rsvp-buttons";
import { ResponseList } from "./response-list";
import type { AvailabilityStatus } from "./availability-picker";

/**
 * The event page's availability card: "Your availability" and everyone's
 * responses. The viewer's own answer is held here, once, so answering in
 * "Your availability" shows at once in their row of the list: a player's in the
 * player groups, staff under Coaches & staff, a parent's child when viewing as
 * them. A failed save puts both back.
 */
export function EventAvailability({
  eventId,
  isPast,
  members,
  availabilityRows,
  isAdmin,
  currentUserId,
}: {
  eventId: string;
  isPast: boolean;
  members: { profileId: string; name: string; role?: string | null }[];
  availabilityRows: { profileId: string; status: AvailabilityStatus }[];
  isAdmin: boolean;
  /** Whoever the viewer is answering as: themselves, or the child they are viewing as. */
  currentUserId: string;
}) {
  const [ownStatus, setOwnStatus] = useState<AvailabilityStatus | null>(
    () => availabilityRows.find((r) => r.profileId === currentUserId)?.status ?? null
  );

  return (
    <>
      {!isPast && (
        <RsvpButtons
          eventId={eventId}
          profileId={currentUserId}
          initialStatus={ownStatus}
          onStatusChange={setOwnStatus}
        />
      )}
      {isPast && (
        <p className="text-sm text-muted-foreground">
          RSVP is closed — this event has already started.
        </p>
      )}
      <div className="border-t pt-4">
        <ResponseList
          eventId={eventId}
          members={members}
          initialRows={availabilityRows}
          isAdmin={isAdmin}
          currentUserId={currentUserId}
          currentUserStatus={ownStatus}
        />
      </div>
    </>
  );
}
