import type { QueryClient } from "@miragon/pulse-widget-shell/widgets"

// Makes agent remediations and other sessions' writes visible and retries error states; in-widget
// writes invalidate precisely via `WRITE_POLICY` instead. `client` is the view's one query client.
export function refreshCockpitData(client: QueryClient): Promise<void> {
  // Not invalidateQueries() blanket: that would refetch host plumbing and the widget-actions feed.
  return client.invalidateQueries({
    predicate: (query) => {
      const root = query.queryKey[0]
      return (
        typeof root === "string" && (root.startsWith("engine:") || root.startsWith("analytics:"))
      )
    },
  })
}
