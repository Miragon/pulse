import { describe, expect, test } from "vitest"
import { IncidentId, InstanceId, IsoTimestamp } from "../src/index.js"
import { FakeEngine, FakeWorld } from "../src/testing/index.js"

describe("the fake's instance search", () => {
  test("breaks a tie of start times by id, in code point order", async () => {
    const { state } = FakeWorld.seed()
    const [model] = state.instances
    if (model === undefined) {
      throw new Error("the world holds no instance")
    }
    const startedAt = IsoTimestamp("2026-01-01T00:00:00.000Z")
    const twins = ["order-b", "order-B", "order-a"].map((id) => ({
      ...model,
      summary: { ...model.summary, id: InstanceId(id), startedAt },
    }))
    const engine = new FakeEngine({ ...state, instances: twins })

    const page = await engine.searchInstances({}, { limit: 10 })

    expect(page.items.map((item) => item.id)).toEqual(["order-B", "order-a", "order-b"])
  })
})

describe("the fake's incident search", () => {
  test("lists the newest first and keeps a tie in the order the incidents were raised", async () => {
    const { state } = FakeWorld.seed()
    const [model] = state.incidents
    if (model === undefined) {
      throw new Error("the world holds no incident")
    }
    const raised = [
      { id: "tie-b", at: "2026-01-01T00:00:00.000Z" },
      { id: "oldest", at: "2025-12-31T23:59:59.000Z" },
      { id: "tie-a", at: "2026-01-01T00:00:00.000Z" },
      { id: "newest", at: "2026-01-01T00:00:01.000Z" },
    ].map(({ id, at }) => ({
      ...model,
      incident: { ...model.incident, id: IncidentId(id), createdAt: IsoTimestamp(at) },
    }))
    const engine = new FakeEngine({ ...state, incidents: raised })

    const page = await engine.searchIncidents({}, { limit: 10 })

    expect(page.items.map((incident) => incident.id)).toEqual([
      "newest",
      "tie-b",
      "tie-a",
      "oldest",
    ])
  })
})
