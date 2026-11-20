import {
  InstanceId,
  RuntimeError,
  type InstanceFilter,
  type PageRequest,
  type ProcessRuntime,
} from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { InstanceScreen, ScreenJson, type InstanceScreenReads } from "../../src/builder/index.js"
import { Instances } from "./support/instances.js"
import { ScreenWorld } from "./support/world.js"

const DISPATCH = InstanceId("fake-DSP-3001")
const LABEL = InstanceId("fake-label-of-DSP-3001")
const FAILED = (): Promise<never> => Promise.reject(new RuntimeError("unreachable", "no answer"))

interface Counted {
  readonly reads: InstanceScreenReads
  readonly calls: string[]
  readonly searches: (readonly [InstanceFilter, PageRequest])[]
}

function counted(runtime: ProcessRuntime): Counted {
  const calls: string[] = []
  const searches: (readonly [InstanceFilter, PageRequest])[] = []
  return {
    calls,
    searches,
    reads: {
      getInstanceDetail: (id) => {
        calls.push("getInstanceDetail")
        return runtime.getInstanceDetail(id)
      },
      getDiagramXml: (id) => {
        calls.push(`getDiagramXml ${id}`)
        return runtime.getDiagramXml(id)
      },
      getCalledProcesses: (id) => {
        calls.push(`getCalledProcesses ${id}`)
        return runtime.getCalledProcesses(id)
      },
      searchInstances: (filter, page) => {
        calls.push("searchInstances")
        searches.push([filter, page])
        return runtime.searchInstances(filter, page)
      },
    },
  }
}

async function screenOf(instanceId: InstanceId, patch: Partial<ProcessRuntime> = {}) {
  const model = await InstanceScreen.read(
    "conformance",
    instanceId,
    ScreenWorld.world(patch),
    () => ScreenWorld.AS_OF,
  )
  return model === undefined ? undefined : ScreenJson.instance(model)
}

describe("the instance screen's reads", () => {
  test("read the detail first, then the version's diagram and the processes it calls", async () => {
    const { reads, calls } = counted(ScreenWorld.world())
    const times: string[] = []

    await InstanceScreen.read("conformance", DISPATCH, reads, () => {
      times.push(`now after ${String(calls.length)} reads`)
      return ScreenWorld.AS_OF
    })

    expect(times).toEqual(["now after 0 reads"])
    expect(calls[0]).toBe("getInstanceDetail")
    expect(calls.slice(1).sort()).toEqual([
      "getCalledProcesses pulse-dispatch:1",
      "getDiagramXml pulse-dispatch:1",
    ])
  })

  test("read the caller of a called instance by its id, one at most", async () => {
    const { reads, calls, searches } = counted(ScreenWorld.world())

    const model = await InstanceScreen.read("conformance", LABEL, reads, () => ScreenWorld.AS_OF)

    expect(calls).toContain("searchInstances")
    expect(searches).toEqual([[{ instanceIds: [DISPATCH] }, { limit: 1 }]])
    expect(model === undefined ? undefined : ScreenJson.instance(model).caller).toEqual({
      instanceId: DISPATCH,
      found: {
        definition: {
          id: "pulse-dispatch:1",
          bpmnProcessId: "pulse-dispatch",
          version: 1,
          name: "Dispatch order",
        },
        state: "running",
        businessKey: "DSP-3001",
      },
    })
  })

  test("give no screen for an instance the engine does not hold, and read nothing more", async () => {
    const { reads, calls } = counted(ScreenWorld.world())

    const model = await InstanceScreen.read(
      "conformance",
      InstanceId("unknown"),
      reads,
      () => ScreenWorld.AS_OF,
    )

    expect(model).toBeUndefined()
    expect(calls).toEqual(["getInstanceDetail"])
  })

  test("fail as the detail fails: the instance is the screen", async () => {
    const refused = new RuntimeError("forbidden", "no rights")

    await expect(
      screenOf(DISPATCH, { getInstanceDetail: () => Promise.reject(refused) }),
    ).rejects.toBe(refused)
  })

  test("keep the instance without its diagram, its called processes or its caller, and name each", async () => {
    const screen = await screenOf(LABEL, {
      getDiagramXml: FAILED,
      getCalledProcesses: FAILED,
      searchInstances: FAILED,
    })

    expect(screen?.unread).toEqual(["diagram", "calledProcesses", "caller"])
    expect(screen?.calls).toEqual([])
    expect(screen?.caller).toEqual({ instanceId: DISPATCH, found: null })
    expect(screen?.incidents).toHaveLength(1)
    expect(screen?.markers).toContainEqual({ elementId: "Activity_RenderLabel", kind: "incident" })
  })

  test("name a caller the search does not find as unread", async () => {
    const elsewhere = Instances.summary({ id: InstanceId("someone-else") })

    const screen = await screenOf(LABEL, {
      searchInstances: () => Promise.resolve({ items: [elsewhere] }),
    })

    expect(screen?.caller).toEqual({ instanceId: DISPATCH, found: null })
    expect(screen?.unread).toEqual(["caller"])
  })

  test("name a caller the search finds nothing for as unread", async () => {
    const screen = await screenOf(LABEL, {
      searchInstances: () => Promise.resolve({ items: [] }),
    })

    expect(screen?.caller).toEqual({ instanceId: DISPATCH, found: null })
    expect(screen?.unread).toEqual(["caller"])
  })

  test("search no caller for an instance nothing called", async () => {
    const { reads, calls } = counted(ScreenWorld.world())

    const model = await InstanceScreen.read("conformance", DISPATCH, reads, () => ScreenWorld.AS_OF)

    expect(calls).not.toContain("searchInstances")
    expect(model?.caller).toBeUndefined()
    expect(model?.unread).toEqual([])
  })

  test("take a diagram the engine no longer holds as unread", async () => {
    const screen = await screenOf(DISPATCH, { getDiagramXml: () => Promise.resolve(undefined) })

    expect(screen?.unread).toEqual(["diagram"])
  })
})

describe("an instance screen built from what a surface read", () => {
  test("holds the instance as the engine gives it, its variables and whether the engine cut it", () => {
    const detail = Instances.detail({
      instance: Instances.summary({ businessKey: "ORD-1", startedAt: Instances.SINCE }),
      truncated: true,
    })

    const model = InstanceScreen.of(Instances.facts(detail))

    expect(model).toMatchObject({
      engine: "prod-a",
      asOf: Instances.AS_OF,
      instance: detail.instance,
      truncated: true,
      unread: [],
    })
    expect(model.caller).toBeUndefined()
  })

  test("takes a caller handed in only where it is the instance that called this one", () => {
    const called = Instances.detail({
      instance: Instances.summary({ parentInstanceId: Instances.CALLER }),
    })
    const caller = Instances.summary({ id: Instances.CALLER, businessKey: "BATCH-7" })
    const other = Instances.summary({ id: Instances.CHILD })

    expect(InstanceScreen.of(Instances.facts(called, { caller }))).toMatchObject({
      caller: { instanceId: Instances.CALLER, read: true, found: caller },
      unread: [],
    })
    expect(InstanceScreen.of(Instances.facts(called, { caller: other }))).toMatchObject({
      caller: { instanceId: Instances.CALLER, read: true, found: undefined },
      unread: ["caller"],
    })
  })

  test("names a caller whose read failed or found nothing as unread", () => {
    const called = Instances.detail({
      instance: Instances.summary({ parentInstanceId: Instances.CALLER }),
    })

    const model = InstanceScreen.of(Instances.facts(called, { caller: null }))

    expect(model.caller).toEqual({ instanceId: Instances.CALLER, read: true, found: undefined })
    expect(model.unread).toEqual(["caller"])
  })

  test("keeps the caller's id and names nothing unread where the surface did not read it", () => {
    const called = Instances.detail({
      instance: Instances.summary({ parentInstanceId: Instances.CALLER }),
    })

    const model = InstanceScreen.of(Instances.facts(called, { caller: undefined }))

    expect(model.caller).toEqual({ instanceId: Instances.CALLER, read: false, found: undefined })
    expect(model.unread).toEqual([])
    expect(ScreenJson.instance(model)).toMatchObject({
      caller: { instanceId: Instances.CALLER, found: null },
      unread: [],
    })
  })
})
