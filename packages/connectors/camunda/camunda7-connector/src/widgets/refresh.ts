import { queryClient } from "@miragon/mcp-toolkit-ui"

// Makes agent remediations and other sessions' writes visible and retries error states; in-widget
// writes invalidate precisely via `WRITE_POLICY` instead. Needs the single shared `queryClient`
// that the server's `resolve.dedupe` of `@miragon/mcp-toolkit-ui` guarantees.
export function refreshCockpitData(): Promise<void> {
  // Not invalidateQueries() blanket: that would refetch host/profile plumbing and the widget-actions feed.
  return queryClient.invalidateQueries({
    predicate: (query) => {
      const root = query.queryKey[0]
      return (
        typeof root === "string" && (root.startsWith("camunda7:") || root.startsWith("analytics:"))
      )
    },
  })
}
