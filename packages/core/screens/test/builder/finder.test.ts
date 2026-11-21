import {
  InstanceId,
  PageCursor,
  RuntimeError,
  type InstanceFilter,
  type PageRequest,
  type ProcessRuntime,
} from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { Finder, ScreenJson, type FinderReads } from "../../src/builder/index.js"
import { WORLD_SCREENS } from "../../src/testing/index.js"
import { Instances } from "./support/instances.js"
import { ScreenWorld } from "./support/world.js"

interface Counted {
  readonly reads: FinderReads
  readonly calls: string[]
  readonly searches: (readonly [InstanceFilter, PageRequest])[]
  readonly counts: InstanceFilter[]
}

function counted(runtime: ProcessRuntime): Counted {
  const calls: string[] = []
  const searches: (readonly [InstanceFilter, PageRequest])[] = []
  const counts: InstanceFilter[] = []
  return {
    calls,
    searches,
    counts,
    reads: {
      searchInstances: (filter, page) => {
        calls.push("searchInstances")
        searches.push([filter, page])
        return runtime.searchInstances(filter, page)
      },
      countInstances: (filter) => {
        calls.push("countInstances")
        counts.push(filter)
        return runtime.countInstances(filter)
      },
      listDefinitions: () => {
        calls.push("listDefinitions")
        return runtime.listDefinitions()
      },
    },
  }
}

const find = async (text: string, runtime: FinderReads = ScreenWorld.world()) =>
  ScreenJson.find(await Finder.read("conformance", text, runtime, () => ScreenWorld.AS_OF))

describe("the finder's reads", () => {
  test("ask the time once first, the instance with the id, up to 20 with the business key, then the history's gap", async () => {
    const { reads, calls, searches, counts } = counted(ScreenWorld.world())
    const times: number[] = []

    await Finder.read("conformance", "ORD-1003", reads, () => {
      times.push(calls.length)
      return ScreenWorld.AS_OF
    })

    expect(times).toEqual([0])
    expect(searches).toStrictEqual([
      [{ instanceIds: ["ORD-1003"] }, { limit: 1 }],
      [{ businessKey: "ORD-1003" }, { limit: 20 }],
    ])
    expect(counts).toStrictEqual([{}])
    expect(calls.indexOf("listDefinitions")).toBeLessThan(calls.indexOf("countInstances"))
  })

  test("refuse a text that names nothing, before anything is read", async () => {
    const { reads, calls } = counted(ScreenWorld.world())

    for (const text of ["", "   "]) {
      await expect(
        Finder.read("conformance", text, reads, () => ScreenWorld.AS_OF),
      ).rejects.toThrow(
        new RangeError("An instance is found by its id or its business key, never by no text"),
      )
    }
    expect(calls).toEqual([])
  })

  test("fail as either search fails: the hits are the screen", async () => {
    const refused = new RuntimeError("forbidden", "no rights")
    const failing = (fails: (filter: InstanceFilter) => boolean) =>
      ScreenWorld.world({
        searchInstances: (filter) =>
          fails(filter) ? Promise.reject(refused) : Promise.resolve({ items: [] }),
      })

    await expect(
      find(
        "ORD-1003",
        failing((filter) => filter.instanceIds !== undefined),
      ),
    ).rejects.toBe(refused)
    await expect(
      find(
        "ORD-1003",
        failing((filter) => filter.businessKey !== undefined),
      ),
    ).rejects.toBe(refused)
  })
})

describe("what the finder finds over the conformance kit's fixed world", () => {
  test("an ended instance by its exact business key", async () => {
    expect(await find("ORD-1003")).toStrictEqual(WORLD_SCREENS.find)
  })

  test("a running instance with an incident by its id, which has no business key", async () => {
    expect(await find("fake-label-of-DSP-3001")).toStrictEqual(WORLD_SCREENS.findById)
  })

  test("nothing by a part of a business key or of an id", async () => {
    for (const text of ["ORD-100", "ORD-10031", "fake-ORD"]) {
      expect((await find(text)).hits).toEqual([])
    }
  })
})

describe("the finder's hits", () => {
  const byKey = Instances.summary({ id: InstanceId("b"), businessKey: "same" })

  test("list the instance with the id first, then those with the business key, each once", async () => {
    const byId = Instances.summary({ id: InstanceId("same"), businessKey: "same" })
    const runtime = ScreenWorld.world({
      searchInstances: (filter) =>
        Promise.resolve({ items: filter.instanceIds === undefined ? [byKey, byId] : [byId] }),
    })

    const screen = await find("same", runtime)

    expect(screen.hits.map(({ id }) => id)).toEqual(["same", "b"])
  })

  test("say what was cut where more instances have the business key than the finder lists", async () => {
    const runtime = ScreenWorld.world({
      searchInstances: (filter) =>
        Promise.resolve(
          filter.businessKey === undefined
            ? { items: [] }
            : { items: [byKey], next: PageCursor("20") },
        ),
    })

    expect((await find("same", runtime)).cut).toBe(true)
    expect((await find("ORD-1003")).cut).toBe(false)
  })

  test("carry only the fields an instance has, as JSON", async () => {
    const screen = await find("fake-label-of-DSP-3001")

    expect(Object.keys(screen.hits[0] ?? {}).sort()).toEqual([
      "definition",
      "hasIncident",
      "id",
      "startedAt",
      "state",
    ])
    expect(JSON.parse(JSON.stringify(screen))).toStrictEqual(screen)
  })
})

describe("the history's gap the finder names", () => {
  const counting = (count: number, atLeast?: true) =>
    ScreenWorld.world({
      countInstances: () => Promise.resolve(atLeast ? { count, atLeast } : { count }),
    })

  test("is how many of the engine's running instances its history holds, where it holds fewer", async () => {
    expect((await find("ORD-1003", counting(0))).historyGap).toStrictEqual({
      running: 5,
      counted: 0,
    })
    expect((await find("ORD-1003", counting(4))).historyGap).toStrictEqual({
      running: 5,
      counted: 4,
    })
  })

  test("is none where the history holds as many or stopped counting", async () => {
    expect((await find("ORD-1003", counting(5))).historyGap).toBeNull()
    expect((await find("ORD-1003", counting(2, true))).historyGap).toBeNull()
  })

  test("leaves the model without a gap where the history misses nothing, never a gap of undefined", () => {
    const page = { items: [] }
    const facts = {
      engine: "conformance",
      asOf: ScreenWorld.AS_OF,
      byId: page,
      byBusinessKey: page,
    }

    const without = Finder.of({ ...facts, historyGap: undefined })
    const withGap = Finder.of({ ...facts, historyGap: { running: 2, counted: 0 } })

    expect(Object.hasOwn(without, "historyGap")).toBe(false)
    expect(withGap.historyGap).toStrictEqual({ running: 2, counted: 0 })
  })

  test("is none where its reads fail, the hits kept", async () => {
    const failing = (patch: Partial<ProcessRuntime>) => find("ORD-1003", ScreenWorld.world(patch))
    const down = () => Promise.reject(new RuntimeError("unreachable", "down"))

    for (const screen of [
      await failing({ listDefinitions: down }),
      await failing({ countInstances: down }),
    ]) {
      expect(screen.historyGap).toBeNull()
      expect(screen.hits).toStrictEqual(WORLD_SCREENS.find.hits)
    }
  })
})

describe("the finder's parts, each read apart (a surface keeps the history's gap apart from a text)", () => {
  test("the searches read the instance with the id and those with the business key, nothing of the history", async () => {
    const { reads, calls } = counted(ScreenWorld.world())

    const searched = await Finder.search("ORD-1003", reads, () => ScreenWorld.AS_OF)

    expect(calls).toEqual(["searchInstances", "searchInstances"])
    expect(searched.asOf).toBe(ScreenWorld.AS_OF)
    expect(searched.byId).toStrictEqual({ items: [] })
    expect(searched.byBusinessKey.items.map(({ businessKey }) => businessKey)).toEqual(["ORD-1003"])
  })

  test("the searches refuse a text that names nothing, before anything is read", async () => {
    const { reads, calls } = counted(ScreenWorld.world())
    const times: Date[] = []

    await expect(
      Finder.search(" ", reads, () => {
        times.push(ScreenWorld.AS_OF)
        return ScreenWorld.AS_OF
      }),
    ).rejects.toThrow(RangeError)
    expect(calls).toEqual([])
    expect(times).toEqual([])
  })

  test("the history's gap reads the engine's processes, then its history's count, whatever was searched", async () => {
    const { reads, calls, counts } = counted(ScreenWorld.world())

    expect(await Finder.historyGap(reads)).toBeNull()
    expect(calls).toEqual(["listDefinitions", "countInstances"])
    expect(counts).toStrictEqual([{}])
  })

  test("the history's gap is the running instances its history misses, and fails as its reads fail", async () => {
    const missing = ScreenWorld.world({ countInstances: () => Promise.resolve({ count: 1 }) })
    const down = new RuntimeError("unreachable", "down")

    expect(await Finder.historyGap(missing)).toStrictEqual({ running: 5, counted: 1 })
    await expect(
      Finder.historyGap(ScreenWorld.world({ listDefinitions: () => Promise.reject(down) })),
    ).rejects.toBe(down)
    await expect(
      Finder.historyGap(ScreenWorld.world({ countInstances: () => Promise.reject(down) })),
    ).rejects.toBe(down)
  })

  test("together give what the finder reads at once", async () => {
    const runtime = ScreenWorld.world({ countInstances: () => Promise.resolve({ count: 0 }) })
    const searched = await Finder.search("ORD-1003", runtime, () => ScreenWorld.AS_OF)
    const gap = await Finder.historyGap(runtime)

    expect(
      Finder.of({ engine: "conformance", ...searched, historyGap: gap ?? undefined }),
    ).toStrictEqual(await Finder.read("conformance", "ORD-1003", runtime, () => ScreenWorld.AS_OF))
  })
})
