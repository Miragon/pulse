import { afterEach, describe, expect, it } from "vitest"
import {
  clientFor,
  startFakeEngine,
  type FakeEngine,
  type FakeRoutes,
} from "../tools/test-support/fake-engine.js"
import { buildProcessInstancesData } from "./cockpit-data.js"

// V4, D5, X10: the instance list shows when each instance started, an enrichment of ONE history
// read over the page's ids (the runtime's instance carries no start). The failure half is the
// degrade table in `honest-numbers.test.ts`.

const engines: FakeEngine[] = []
afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

async function build(routes: FakeRoutes) {
  const engine = await startFakeEngine(routes, { body: [] })
  engines.push(engine)
  const data = await buildProcessInstancesData(clientFor(engine), "engine-a", {
    processDefinitionKey: "K1",
  })
  return { data, requests: engine.requests }
}

const ROUTES: FakeRoutes = {
  "POST /process-instance": {
    body: ["p1", "p2", "p3"].map((id) => ({ id, definitionId: "K1:7:dep", suspended: false })),
  },
  "POST /process-instance/count": { body: { count: 3 } },
  "GET /process-definition": { body: [{ id: "K1:7:dep", key: "K1", name: "Order", version: 7 }] },
  // The history holds p1's start alone: p2 and p3 started before it was recorded.
  "POST /history/process-instance": {
    body: [{ id: "p1", startTime: "2026-10-10T07:55:00.000+0200" }],
  },
}

describe("buildProcessInstancesData: when each instance started", () => {
  it("reads the page's starts in ONE history read over its ids, never one per row", async () => {
    const { requests } = await build(ROUTES)
    const starts = requests.filter((r) => r.path === "/history/process-instance")
    expect(starts.map((r) => [r.method, r.query, r.body])).toEqual([
      ["POST", { maxResults: "3" }, { processInstanceIds: ["p1", "p2", "p3"] }],
    ])
  })

  it("gives a row its start, and null where the history holds none, never a guess", async () => {
    const { data } = await build(ROUTES)
    expect(data.instances.map((row) => [row.id, row.startTime])).toEqual([
      ["p1", "2026-10-10T07:55:00.000+0200"],
      ["p2", null],
      ["p3", null],
    ])
  })

  it("reads no history for an empty page, and says when the page was read", async () => {
    const { data, requests } = await build({ ...ROUTES, "POST /process-instance": { body: [] } })
    expect(requests.filter((r) => r.path === "/history/process-instance")).toEqual([])
    expect(Number.isNaN(Date.parse(data.fetchedAt))).toBe(false)
  })
})
