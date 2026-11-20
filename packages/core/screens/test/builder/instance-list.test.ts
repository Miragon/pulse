import {
  DefinitionId,
  PageCursor,
  RuntimeError,
  type InstanceFilter,
  type PageRequest,
  type ProcessRuntime,
} from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { InstanceList, ScreenJson, type InstanceListReads } from "../../src/builder/index.js"
import type { InstanceListFilterData } from "../../src/index.js"
import { WORLD_SCREENS } from "../../src/testing/index.js"
import { ScreenWorld } from "./support/world.js"

const ORDER_1 = DefinitionId("pulse-order:1")
const ALL: InstanceListFilterData = { scope: "all" }

interface Counted {
  readonly reads: InstanceListReads
  readonly searches: (readonly [InstanceFilter, PageRequest])[]
  readonly counts: InstanceFilter[]
}

function counted(
  runtime: ProcessRuntime,
  refused?: InstanceListReads["refusedVariableConditions"],
): Counted {
  const searches: (readonly [InstanceFilter, PageRequest])[] = []
  const counts: InstanceFilter[] = []
  return {
    searches,
    counts,
    reads: {
      searchInstances: (filter, page) => {
        searches.push([filter, page])
        return runtime.searchInstances(filter, page)
      },
      countInstances: (filter) => {
        counts.push(filter)
        return runtime.countInstances(filter)
      },
      ...(refused === undefined ? {} : { refusedVariableConditions: refused }),
    },
  }
}

describe("the instance list's reads", () => {
  test("read a page of 50 and the three scopes' counts on the first page, the time asked once first", async () => {
    const { reads, searches, counts } = counted(ScreenWorld.world())
    const times: number[] = []

    await InstanceList.read("conformance", { definitionId: ORDER_1, filter: ALL }, reads, () => {
      times.push(searches.length + counts.length)
      return ScreenWorld.AS_OF
    })

    expect(times).toEqual([0])
    expect(searches).toStrictEqual([[{ definitionId: ORDER_1 }, { limit: 50 }]])
    expect(counts).toEqual([
      { definitionId: ORDER_1, lifecycle: "running" },
      { definitionId: ORDER_1, lifecycle: "running", withIncident: true },
      { definitionId: ORDER_1, lifecycle: "ended" },
    ])
  })

  test("read a later page after its cursor and count nothing there", async () => {
    const { reads, searches, counts } = counted(ScreenWorld.world())
    const after = PageCursor("50")

    const model = await InstanceList.read(
      "conformance",
      { definitionId: ORDER_1, filter: { scope: "running" }, after },
      reads,
      () => ScreenWorld.AS_OF,
    )

    expect(searches).toEqual([
      [
        { definitionId: ORDER_1, lifecycle: "running" },
        { limit: 50, after },
      ],
    ])
    expect(counts).toEqual([])
    expect(model.counts).toBeUndefined()
    expect(ScreenJson.instanceList(model).counts).toBeNull()
  })

  test("give the next page's cursor where the engine has more", async () => {
    const runtime = ScreenWorld.world({
      searchInstances: () => Promise.resolve({ items: [], next: PageCursor("next-50") }),
    })

    const model = await InstanceList.read(
      "conformance",
      { definitionId: ORDER_1, filter: ALL },
      runtime,
      () => ScreenWorld.AS_OF,
    )

    expect(ScreenJson.instanceList(model).next).toBe("next-50")
  })

  test("carry the condition kinds the dialect refuses, none where it names none", async () => {
    const refusing = counted(ScreenWorld.world(), () => ["ordering", "date"])
    const silent = counted(ScreenWorld.world())

    const request = { definitionId: ORDER_1, filter: ALL }
    const refused = await InstanceList.read("c8", request, refusing.reads, () => ScreenWorld.AS_OF)
    const none = await InstanceList.read("c7", request, silent.reads, () => ScreenWorld.AS_OF)

    expect(refused.refusedVariableConditions).toEqual(["ordering", "date"])
    expect(none.refusedVariableConditions).toEqual([])
  })

  test("fail as the page fails or a count fails: rows and counts are the list", async () => {
    const refused = new RuntimeError("forbidden", "no rights")
    const read = (patch: Partial<ProcessRuntime>) =>
      InstanceList.read(
        "conformance",
        { definitionId: ORDER_1, filter: ALL },
        ScreenWorld.world(patch),
        () => ScreenWorld.AS_OF,
      )

    await expect(read({ searchInstances: () => Promise.reject(refused) })).rejects.toBe(refused)
    await expect(read({ countInstances: () => Promise.reject(refused) })).rejects.toBe(refused)
  })

  test("give the world's list of every instance of a version, running and ended", async () => {
    const model = await InstanceList.read(
      "conformance",
      { definitionId: ORDER_1, filter: ALL },
      ScreenWorld.world(),
      () => ScreenWorld.AS_OF,
    )

    expect(ScreenJson.instanceList(model)).toStrictEqual(WORLD_SCREENS.instanceList)
  })
})
