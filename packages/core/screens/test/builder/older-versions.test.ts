import { DefinitionId } from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { ProcessScreen } from "../../src/builder/index.js"
import { Processes } from "./support/processes.js"

const VERSIONS = [
  Processes.version(4, 1, 0),
  Processes.version(3, 0, 0),
  Processes.version(2, 5, 2),
  Processes.version(1, 3, 1),
]

function noticesOf(selected?: string, versions = VERSIONS) {
  return ProcessScreen.of(
    Processes.facts({
      versions,
      selected: selected === undefined ? undefined : DefinitionId(selected),
    }),
  ).notices
}

describe("the notice of older versions", () => {
  test("sums the instances running on older versions, those with incident among them, and shows the newest that runs", () => {
    expect(noticesOf()).toEqual([
      {
        code: "olderVersionsRun",
        running: 8,
        withIncident: 3,
        show: Processes.definition(2, "Order"),
      },
    ])
  })

  test("shows only on the newest version", () => {
    expect(noticesOf("order:4")).toHaveLength(1)
    expect(noticesOf("order:2")).toEqual([])
  })

  test("is none where no older version runs or there is no older version", () => {
    expect(noticesOf(undefined, [Processes.version(2, 1, 0), Processes.version(1, 0, 0)])).toEqual(
      [],
    )
    expect(noticesOf(undefined, [Processes.version(1, 7, 2)])).toEqual([])
    expect(noticesOf(undefined, [])).toEqual([])
  })
})
