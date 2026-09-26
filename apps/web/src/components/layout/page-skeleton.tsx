/**
 * What a dashboard route shows while its server data loads (every route's
 * loading.tsx), so a click is answered at once rather than when the page is ready.
 */
export function PageSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="animate-pulse space-y-6">
      <span className="sr-only">Loading…</span>
      <div className="h-8 w-56 rounded-md bg-muted" />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="h-40 rounded-xl bg-muted" />
        <div className="h-40 rounded-xl bg-muted" />
      </div>
      <div className="space-y-3">
        <div className="h-12 rounded-md bg-muted" />
        <div className="h-12 rounded-md bg-muted" />
        <div className="h-12 rounded-md bg-muted" />
      </div>
    </div>
  );
}
