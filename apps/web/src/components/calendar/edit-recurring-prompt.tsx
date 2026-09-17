"use client";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export type RecurringEditScope = "single" | "following" | "series";

const OPTIONS: { scope: RecurringEditScope; label: string; description: string }[] = [
  { scope: "single", label: "This event", description: "Only this event." },
  {
    scope: "following",
    label: "This and following",
    description: "This event and every event after it.",
  },
  {
    scope: "series",
    label: "Entire series",
    description: "Every remaining event. Past events aren't changed.",
  },
];

export function EditRecurringPrompt({
  open,
  onClose,
  onChoose,
}: {
  open: boolean;
  onClose: () => void;
  onChoose: (scope: RecurringEditScope) => void;
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
        <div className="flex flex-col gap-2">
          {OPTIONS.map((option) => (
            <Button
              key={option.scope}
              variant="outline"
              className="h-auto flex-col items-start gap-0.5 whitespace-normal py-2 text-left"
              onClick={() => onChoose(option.scope)}
            >
              <span className="font-medium">{option.label}</span>
              <span className="text-xs font-normal text-muted-foreground">{option.description}</span>
            </Button>
          ))}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
