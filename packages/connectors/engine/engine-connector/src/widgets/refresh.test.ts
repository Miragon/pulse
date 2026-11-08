import { describe, expect, it } from "vitest"
import { createTestQueryClient } from "@miragon/pulse-widget-shell/widgets"
import { refreshCockpitData } from "./refresh.js"

describe("refreshCockpitData", () => {
  it("re-reads the engine module's own feeds only, never the deployment's or a foreign key", async () => {
    const client = createTestQueryClient()
    const keys = [
      ["engine:cockpit-overview", "prod-a"],
      ["engine:job-backlog", "prod-a"],
      ["engine-widget-actions"],
      ["notes:list", ""],
    ]
    for (const key of keys) client.setQueryData(key, { read: 1 })
    await refreshCockpitData(client)
    const invalidated = client
      .getQueryCache()
      .getAll()
      .filter((query) => query.state.isInvalidated)
      .map((query) => query.queryKey)
    expect(invalidated).toEqual([
      ["engine:cockpit-overview", "prod-a"],
      ["engine:job-backlog", "prod-a"],
    ])
  })
})
