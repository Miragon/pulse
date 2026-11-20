import { DefinitionId, type InstanceFilter } from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { InstanceCounts } from "../../src/builder/index.js"

describe("the counts of an instance list's scopes", () => {
  test("count all as running and ended together, each exact where the engine counts to the end", () => {
    expect(InstanceCounts.of({ count: 12 }, { count: 8 }, { count: 340 })).toStrictEqual({
      running: 12,
      withIncident: 8,
      ended: 340,
      all: 352,
    })
  })

  test("name each scope where the engine stops counting as a lower bound, and all with it", () => {
    expect(
      InstanceCounts.of({ count: 1000, atLeast: true }, { count: 3 }, { count: 0 }).atLeast,
    ).toEqual(["running", "all"])
    expect(
      InstanceCounts.of(
        { count: 1 },
        { count: 1000, atLeast: true },
        { count: 1000, atLeast: true },
      ).atLeast,
    ).toEqual(["withIncident", "ended", "all"])
  })

  test("read the three scopes with the list's filter, keeping an ended count handed in", async () => {
    const asked: InstanceFilter[] = []
    const reads = {
      countInstances: (filter: InstanceFilter) => {
        asked.push(filter)
        return Promise.resolve({ count: asked.length })
      },
    }
    const version = DefinitionId("order:2")

    const counts = await InstanceCounts.read(
      reads,
      version,
      { scope: "ended", businessKey: "ORD-1" },
      { count: 7, atLeast: true },
    )

    expect(asked).toEqual([
      { definitionId: version, lifecycle: "running", businessKey: "ORD-1" },
      { definitionId: version, lifecycle: "running", withIncident: true, businessKey: "ORD-1" },
    ])
    expect(counts).toStrictEqual({
      running: 1,
      withIncident: 2,
      ended: 7,
      all: 8,
      atLeast: ["ended", "all"],
    })
  })

  test("give the ended count back as the engine gave it", () => {
    expect(
      InstanceCounts.endedOf(InstanceCounts.of({ count: 1 }, { count: 0 }, { count: 5 })),
    ).toStrictEqual({ count: 5 })
    expect(
      InstanceCounts.endedOf(
        InstanceCounts.of({ count: 1 }, { count: 0 }, { count: 5, atLeast: true }),
      ),
    ).toStrictEqual({ count: 5, atLeast: true })
  })
})
