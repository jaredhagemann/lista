import { AlertTriangle } from "lucide-react";

/**
 * Shown when a list could not be read completely (BUG-014).
 *
 * Partial data is worse than no data here: a missing availability row renders as
 * "no response", and a half-loaded roster looks exactly like a roster. So the
 * page says what happened instead of showing rows that a coach might act on.
 */
export function ListLoadError({
  title = "Couldn't load this list",
  description,
}: {
  title?: string;
  description: string;
}) {
  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-6">
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
        <div className="space-y-1">
          <p className="font-medium text-destructive">{title}</p>
          <p className="text-sm text-muted-foreground">{description}</p>
          <p className="text-sm text-muted-foreground">
            Reload the page to try again. If it keeps happening, the list is too large to show
            all at once — narrow the date range.
          </p>
        </div>
      </div>
    </div>
  );
}
