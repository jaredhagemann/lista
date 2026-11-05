import Link from "next/link";
import { Calendar } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AgendaDay, AgendaItem } from "@/lib/club/agenda";
import { eventTypeStyle } from "@/lib/events/type-colors";

function AgendaRow({ item }: { item: AgendaItem }) {
  const { event, teamName, title, time, partOf } = item;
  const cancelled = !!event.is_cancelled;
  return (
    <div className="grid gap-x-4 gap-y-0.5 rounded-md p-2 text-sm sm:grid-cols-[13rem_10rem_1fr]">
      <span className="text-muted-foreground">{time}</span>
      <span className="font-medium">{teamName}</span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2">
          <span aria-hidden className={`size-2 shrink-0 rounded-full ${eventTypeStyle(event.event_type).dot}`} />
          <span className={cancelled ? "text-muted-foreground line-through" : undefined}>{title}</span>
          {cancelled && (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              Cancelled
            </Badge>
          )}
        </span>
        {partOf && <span className="block text-xs text-muted-foreground">{partOf}</span>}
      </span>
    </div>
  );
}

/** Straight to the switch for another team's event, sparing it a trip through the event page. */
function switchHref(teamId: string, eventId: string) {
  return `/dashboard/switch-team?${new URLSearchParams({ team: teamId, next: `/dashboard/schedule/${eventId}` })}`;
}

/**
 * The club's week, like Google Calendar's Schedule view. A row links to its event
 * only for a team the viewer can switch to: the switch sends anyone not on the
 * team to the dashboard.
 */
export function ClubAgenda({
  days,
  activeTeamId,
  linkableTeamIds,
  failed,
}: {
  days: AgendaDay[];
  activeTeamId: string | null;
  linkableTeamIds: Set<string>;
  failed: boolean;
}) {
  return (
    <section aria-label="Events this week">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between border-b">
          <CardTitle className="text-sm font-medium">Events this week</CardTitle>
          <Calendar className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent className="divide-y [&>*:not(:first-child)]:pt-5 [&>*:not(:last-child)]:pb-3">
          {failed ? (
            <p className="text-sm text-muted-foreground">Couldn&apos;t load events. Refresh the page to try again.</p>
          ) : days.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events in the next 7 days.</p>
          ) : (
            days.map((day) => (
              <div key={day.key} className="space-y-1">
                <h3 className="text-sm font-semibold">{day.heading}</h3>
                <ul>
                  {day.items.map((item) => (
                    <li key={item.event.id}>
                      {item.event.team_id && linkableTeamIds.has(item.event.team_id) ? (
                        item.event.team_id === activeTeamId ? (
                          <Link
                            href={`/dashboard/schedule/${item.event.id}`}
                            className="block rounded-md transition-colors hover:bg-accent"
                          >
                            <AgendaRow item={item} />
                          </Link>
                        ) : (
                          // Never prefetched: following this link changes the viewer's team.
                          <Link
                            href={switchHref(item.event.team_id, item.event.id)}
                            prefetch={false}
                            className="block rounded-md transition-colors hover:bg-accent"
                          >
                            <AgendaRow item={item} />
                          </Link>
                        )
                      ) : (
                        <AgendaRow item={item} />
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </section>
  );
}
