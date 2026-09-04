"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Archive, Check, Pencil, RotateCcw, Sparkles, X } from "lucide-react";
import {
  sortCategories,
  SPORT_CATEGORY_SUGGESTIONS,
  MAX_CATEGORY_LABEL_LENGTH,
  type CategoryRow,
  type Sport,
} from "@/lib/training";
import {
  addCategory,
  renameCategory,
  setCategoryActive,
  addSuggestedCategories,
} from "@/app/actions/training-categories";

export function ManageCategoriesDialog({
  open,
  onOpenChange,
  teamId,
  sport,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  teamId: string;
  sport: Sport | null;
}) {
  const supabase = createClient();
  const [rows, setRows] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newLabel, setNewLabel] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("training_categories")
      .select("id, label, is_default, sort_order, is_active, created_at")
      .eq("team_id", teamId);
    setRows((data as CategoryRow[]) ?? []);
    setLoading(false);
  }, [supabase, teamId]);

  useEffect(() => {
    void load(); // eslint-disable-line react-hooks/set-state-in-effect
  }, [load]);

  const active = sortCategories(rows.filter((r) => r.is_active));
  const archived = rows
    .filter((r) => !r.is_active)
    .sort(
      (a, b) =>
        a.sort_order - b.sort_order ||
        a.created_at.localeCompare(b.created_at) ||
        a.id.localeCompare(b.id)
    );
  const suggestions = sport ? (SPORT_CATEGORY_SUGGESTIONS[sport] ?? []) : [];

  async function handleAdd() {
    const label = newLabel.trim();
    if (!label) return;
    setBusy(true);
    const res = await addCategory(teamId, label);
    setBusy(false);

    // The label matches an ARCHIVED category — offer to restore it rather than
    // failing with a dead "already exists" (spec's "Add custom" flow).
    if (res.archivedMatchId) {
      const archivedId = res.archivedMatchId;
      toast("This category is archived.", {
        description: `"${label}" already exists but was archived.`,
        action: {
          label: "Restore",
          onClick: () => {
            void (async () => {
              const r = await setCategoryActive(archivedId, true);
              if (r.error) {
                toast.error(r.error);
              } else {
                toast.success("Category restored");
                await load();
              }
            })();
          },
        },
      });
      setNewLabel("");
      return;
    }

    if (res.error) return void toast.error(res.error);
    setNewLabel("");
    await load();
  }

  async function handleRename(id: string) {
    const label = editingLabel.trim();
    if (!label) return;
    setBusy(true);
    const res = await renameCategory(id, label);
    setBusy(false);
    if (res.error) return void toast.error(res.error);
    setEditingId(null);
    await load();
  }

  async function handleActive(id: string, next: boolean) {
    setBusy(true);
    const res = await setCategoryActive(id, next);
    setBusy(false);
    if (res.error) return void toast.error(res.error);
    if (!next) toast.success("Archived — existing sessions keep this category.");
    await load();
  }

  async function handleSuggested() {
    if (!sport) return;
    setBusy(true);
    const res = await addSuggestedCategories(teamId, sport);
    setBusy(false);
    if (res.error) return void toast.error(res.error);
    const parts = [`${res.added} added`];
    if (res.alreadyActive) parts.push(`${res.alreadyActive} already there`);
    if (res.archived.length) parts.push(`${res.archived.length} archived — restore below`);
    toast.success(parts.join(" · "));
    await load();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Training categories</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={newLabel}
              maxLength={MAX_CATEGORY_LABEL_LENGTH}
              placeholder="Add a category…"
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleAdd();
                }
              }}
            />
            <Button onClick={handleAdd} disabled={busy || !newLabel.trim()}>
              Add
            </Button>
          </div>

          {suggestions.length > 0 && (
            <Button variant="outline" size="sm" onClick={handleSuggested} disabled={busy}>
              <Sparkles className="mr-1.5 h-4 w-4" /> Add suggested for {sport}
            </Button>
          )}

          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {active.map((c) => (
                <li key={c.id} className="flex items-center gap-2 px-3 py-2">
                  {editingId === c.id ? (
                    <>
                      <Input
                        className="h-8 flex-1"
                        value={editingLabel}
                        maxLength={MAX_CATEGORY_LABEL_LENGTH}
                        autoFocus
                        onChange={(e) => setEditingLabel(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void handleRename(c.id);
                          }
                          if (e.key === "Escape") setEditingId(null);
                        }}
                      />
                      <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Save" onClick={() => handleRename(c.id)}>
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Cancel" onClick={() => setEditingId(null)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 truncate text-sm">
                        {c.label}
                        {c.is_default && (
                          <Badge variant="outline" className="ml-2 align-middle text-[10px]">
                            default
                          </Badge>
                        )}
                      </span>
                      {!c.is_default && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            aria-label="Rename"
                            onClick={() => {
                              setEditingId(c.id);
                              setEditingLabel(c.label);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            aria-label="Archive"
                            onClick={() => handleActive(c.id, false)}
                          >
                            <Archive className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          {archived.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Archived</p>
              <ul className="divide-y rounded-md border">
                {archived.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 px-3 py-2">
                    <span className="flex-1 truncate text-sm text-muted-foreground">{c.label}</span>
                    <Button variant="ghost" size="sm" onClick={() => handleActive(c.id, true)} disabled={busy}>
                      <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Restore
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
