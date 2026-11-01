import type { ReactNode } from "react"
import { createTestQueryClient, TestViewHost } from "./test-view-host.js"
import { createViewQueryClient, type QueryClient } from "./tool-query.js"

/** The spy every call of the test's one tool forwards to, as `(name, args)`. */
export type SpyCall = (name: string, args: Record<string, unknown>) => unknown

/**
 * A `TestViewHost` whose one tool forwards to `callTool`, over a query client the test owns:
 * retry-free by default, the view's production client (TanStack's retries) with `retries`.
 */
export function spyHost(tool: string, callTool: SpyCall, options: { retries?: boolean } = {}) {
  const fresh = (): QueryClient =>
    options.retries ? createViewQueryClient() : createTestQueryClient()
  let client = fresh()
  const tools = { [tool]: (args: Record<string, unknown>) => callTool(tool, args) }
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <TestViewHost client={client} tools={tools}>
        {children}
      </TestViewHost>
    )
  }
  return {
    wrapper,
    client: () => client,
    /** A new client for the next test. */
    reset: () => {
      client = fresh()
    },
    /** TanStack's production retries from now on. */
    withRetries: () => client.setDefaultOptions(createViewQueryClient().getDefaultOptions()),
    /** Stops waiting retries and drops the cache. */
    dispose: async () => {
      await client.cancelQueries()
      client.clear()
    },
  }
}
