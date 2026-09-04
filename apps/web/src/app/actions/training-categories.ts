"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  SPORT_CATEGORY_SUGGESTIONS,
  normalizeLabelKey,
  planSuggestedCategories,
  validateCategoryLabel,
  type Sport,
} from "@/lib/training";

function isDuplicateError(message: string): boolean {
  return /duplicate key|training_categories_team_label_idx/i.test(message);
}

/**
 * Add a custom category. Distinguishes an ACTIVE duplicate (generic error) from
 * an ARCHIVED one: an archived match is returned as `archivedMatchId` so the UI
 * can offer to Restore it (per the spec's "Add custom" flow) instead of a dead
 * "already exists" error.
 */
export async function addCategory(
  teamId: string,
  rawLabel: string
): Promise<{ error?: string; id?: string; archivedMatchId?: string }> {
  const v = validateCategoryLabel(rawLabel);
  if ("error" in v) return { error: v.error };

  const supabase = await createClient();

  // One fetch drives both the duplicate/archived check and the append position.
  const { data: existing } = await supabase
    .from("training_categories")
    .select("id, label, is_active, sort_order")
    .eq("team_id", teamId);
  const rows = existing ?? [];

  const key = normalizeLabelKey(v.label);
  const match = rows.find((c) => normalizeLabelKey(c.label) === key);
  if (match) {
    return match.is_active
      ? { error: "A category with that name already exists." }
      : { archivedMatchId: match.id };
  }

  const id = crypto.randomUUID();
  const { error } = await supabase.from("training_categories").insert({
    id,
    team_id: teamId,
    label: v.label,
    is_default: false,
    sort_order: Math.max(0, ...rows.map((r) => r.sort_order)) + 10,
    is_active: true,
  });

  if (error) {
    // Lost a race since the fetch above — fall back to the generic message.
    return {
      error: isDuplicateError(error.message)
        ? "A category with that name already exists."
        : "Couldn't add the category.",
    };
  }
  revalidatePath("/dashboard/training");
  return { id };
}

export async function renameCategory(
  id: string,
  rawLabel: string
): Promise<{ error?: string }> {
  const v = validateCategoryLabel(rawLabel);
  if ("error" in v) return { error: v.error };

  const supabase = await createClient();
  // The default's label is immutable (guard trigger). update returns no rows on
  // an RLS/guard block, but a duplicate raises — map that to a clear message.
  const { error } = await supabase
    .from("training_categories")
    .update({ label: v.label })
    .eq("id", id);

  if (error) {
    return {
      error: isDuplicateError(error.message)
        ? "A category with that name already exists."
        : "Couldn't rename the category.",
    };
  }
  revalidatePath("/dashboard/training");
  return {};
}

export async function setCategoryActive(
  id: string,
  active: boolean
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("training_categories")
    .update({ is_active: active })
    .eq("id", id);
  if (error) return { error: "Couldn't update the category." };
  revalidatePath("/dashboard/training");
  return {};
}

/**
 * Seed a sport's suggested categories via prefetch-filter (the expression unique
 * index can't be targeted by onConflict). Inserts only labels not already
 * present (active or archived, case/space-insensitively); archived matches are
 * reported for an explicit Restore rather than silently reactivated.
 *
 * A concurrent add can make our multi-row insert collide with the unique index,
 * which rolls back the WHOLE statement (nothing inserted). We therefore
 * refetch + re-plan + retry on a duplicate so the reported counts are the truth:
 * a *successful* insert is atomic, so all planned rows landed; the racing labels
 * simply reappear as `alreadyActive` on the next plan.
 */
export async function addSuggestedCategories(
  teamId: string,
  sport: Sport
): Promise<{
  error?: string;
  added: number;
  alreadyActive: number;
  archived: string[];
}> {
  const suggestions = SPORT_CATEGORY_SUGGESTIONS[sport] ?? [];
  if (suggestions.length === 0) return { added: 0, alreadyActive: 0, archived: [] };

  const supabase = await createClient();

  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: existing } = await supabase
      .from("training_categories")
      .select("label, is_active, sort_order")
      .eq("team_id", teamId);

    const plan = planSuggestedCategories(existing ?? [], suggestions);

    if (plan.toInsert.length === 0) {
      revalidatePath("/dashboard/training");
      return { added: 0, alreadyActive: plan.alreadyActive, archived: plan.archived };
    }

    const rows = plan.toInsert.map((r) => ({
      id: crypto.randomUUID(),
      team_id: teamId,
      label: r.label,
      is_default: false,
      sort_order: r.sort_order,
      is_active: true,
    }));
    const { error } = await supabase.from("training_categories").insert(rows);

    if (!error) {
      // Atomic success → every planned row was inserted.
      revalidatePath("/dashboard/training");
      return { added: rows.length, alreadyActive: plan.alreadyActive, archived: plan.archived };
    }
    if (!isDuplicateError(error.message)) {
      return {
        error: "Couldn't add suggestions.",
        added: 0,
        alreadyActive: plan.alreadyActive,
        archived: plan.archived,
      };
    }
    // Duplicate from a concurrent writer → loop to refetch + re-plan + retry.
  }

  // Sustained contention across retries — report nothing added; the caller
  // refetches and sees the current list either way.
  return {
    error: "Couldn't add suggestions right now. Please try again.",
    added: 0,
    alreadyActive: 0,
    archived: [],
  };
}
