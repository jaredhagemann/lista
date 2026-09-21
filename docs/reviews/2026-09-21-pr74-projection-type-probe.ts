// Compile-only review probe: copy temporarily into apps/web/tests, then run
// pnpm exec tsc --noEmit --incremental false from apps/web and remove the copy.
// Expected errors should be enforced by a projection-safe repository, but the
// reviewed commit reports these directives as unused. Not a passing regression.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { fetchEventPage } from "@/lib/events/queries";
export async function checkProjectionTypes(client: SupabaseClient<Database>, teamId: string) {
  const calendar = await fetchEventPage(client, { query: { teamId, includeCancelled: true }, projection: "calendar", pageSize: 1, cursor: null });
  // @ts-expect-error Calendar projection does not select notes.
  const notes: string | null = calendar.items[0].notes;
  // @ts-expect-error Callers must not assert an unrelated row shape.
  const arbitrary = await fetchEventPage<{ inventedField: number }>(client, { query: { teamId, includeCancelled: true }, projection: "calendar", pageSize: 1, cursor: null });
  return { notes, arbitrary };
}
