"use client";

import { useState } from "react";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ManageCategoriesDialog } from "@/components/training/manage-categories-dialog";
import type { Sport } from "@/lib/training";

/**
 * Team-settings mirror of the Training → Team tab's "Manage categories"
 * affordance. Opens the same ManageCategoriesDialog so category management is
 * reachable from either surface (spec §"Managing categories").
 */
export function TrainingCategoriesSection({
  teamId,
  sport,
}: {
  teamId: string;
  sport: Sport | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Training Categories</CardTitle>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Settings2 className="mr-1.5 h-4 w-4" /> Manage categories
        </Button>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Customize the categories players choose from when logging their
          individual training.
        </p>
      </CardContent>

      {open && (
        <ManageCategoriesDialog
          open={open}
          onOpenChange={setOpen}
          teamId={teamId}
          sport={sport}
        />
      )}
    </Card>
  );
}
