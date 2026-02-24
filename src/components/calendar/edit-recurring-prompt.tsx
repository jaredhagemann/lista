"use client";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export function EditRecurringPrompt({
  open,
  onClose,
  onEditSingle,
  onEditSeries,
}: {
  open: boolean;
  onClose: () => void;
  onEditSingle: () => void;
  onEditSeries: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent className="sm:max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Edit recurring event</AlertDialogTitle>
          <AlertDialogDescription>
            This event is part of a series. What would you like to edit?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline" onClick={onEditSingle}>
            This event
          </Button>
          <Button onClick={onEditSeries}>Entire series</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
