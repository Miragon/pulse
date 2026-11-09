import { describe, expect, test } from "vitest"
import { InstanceId, IsoTimestamp } from "../src/index.js"
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
