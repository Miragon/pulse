import { ElementId, IsoTimestamp, type ElementRun } from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { InstanceScreen, ScreenJson } from "../../src/builder/index.js"
import { Instances } from "./support/instances.js"

function pathOf(path: readonly ElementRun[]) {
  return ScreenJson.instance(InstanceScreen.of(Instances.facts(Instances.detail({ path })))).path
}

const START = IsoTimestamp("2026-10-21T08:00:00.000Z")

function run(changes: Partial<ElementRun>): ElementRun {
  return { elementId: ElementId("Activity_Pack"), startedAt: START, canceled: false, ...changes }
}

describe("the path of an instance", () => {
  test("names each run active, completed or cancelled, with its name where it has one", () => {
    expect(
      pathOf([
        run({ elementName: "Pack" }),
        run({ endedAt: IsoTimestamp("2026-10-21T08:00:01.500Z") }),
        run({ endedAt: IsoTimestamp("2026-10-21T08:00:02.000Z"), canceled: true }),
      ]),
    ).toStrictEqual([
      { elementId: "Activity_Pack", elementName: "Pack", startedAt: START, state: "active" },
      {
        elementId: "Activity_Pack",
        startedAt: START,
        endedAt: "2026-10-21T08:00:01.500Z",
        state: "completed",
        durationMs: 1500,
      },
      {
        elementId: "Activity_Pack",
        startedAt: START,
        endedAt: "2026-10-21T08:00:02.000Z",
        state: "canceled",
        durationMs: 2000,
      },
    ])
  })

  test("never gives a duration below zero, and none where a time is no time", () => {
    const [early, broken] = pathOf([
      run({ endedAt: IsoTimestamp("2026-10-21T07:59:59.000Z") }),
      run({ endedAt: "later" as IsoTimestamp }),
    ])

    expect(early?.durationMs).toBe(0)
    expect(broken).not.toHaveProperty("durationMs")
  })
})
