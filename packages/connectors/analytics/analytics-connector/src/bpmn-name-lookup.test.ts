import { afterEach, describe, expect, it, vi } from "vitest"
import { getMcpRequestInfo, runWithMcpRequestInfo } from "@miragon/pulse-widget-shell/server"
import { NO_NAMES, createNameLookup, type FetchBpmnXml } from "./bpmn-name-lookup.js"
import { elementNameOf, processNameOf } from "./bpmn-names.js"

// The XML reader itself is tested in widget-shell's `bpmn-names.test.ts`.

const LEASING = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs_1">
  <!-- <bpmn:userTask id="Task_Commented" name="Never shown" /> -->
  <bpmn:process id="miraveloLeasing" name="Bike Leasing" isExecutable="true">
    <bpmn:startEvent id="StartEvent_1" name="Application&#10;&#10; received" />
    <bpmn:userTask id="Activity_Decide" name='Decide on "Leasing &amp; Co"'>
      <bpmn:documentation><![CDATA[<bpmn:task id="Task_InCdata" name="Nope"/>]]></bpmn:documentation>
    </bpmn:userTask>
    <bpmn:exclusiveGateway id="Gateway_Amount" name="Amount &gt; 1000?" />
    <bpmn:serviceTask id="Activity_Unnamed" />
    <bpmn:serviceTask id="Activity_Blank" name="   " />
    <bpmn:endEvent id="EndEvent_Done" name="Done &#x2713;"/>
  </bpmn:process>
</bpmn:definitions>`

describe("createNameLookup", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("knows no names without a BPMN lookup (no camunda7 module)", async () => {
    expect(createNameLookup(undefined)).toBe(NO_NAMES)
    expect(await NO_NAMES(["a"])).toEqual({})
  })

  it("reads each key once and keeps only the elements a view asks for", async () => {
    const fetchBpmnXml = vi.fn((key: string) =>
      Promise.resolve(key === "miraveloLeasing" ? LEASING : null),
    )
    const namesFor = createNameLookup(fetchBpmnXml)
    const index = await namesFor(["miraveloLeasing", "miraveloLeasing", "", "unknown"], {
      elementIds: { miraveloLeasing: ["Activity_Decide", "Activity_Missing"], unknown: [] },
    })
    // Strictly: an element the model does not name is left out, never `undefined`.
    expect(index).toStrictEqual({
      miraveloLeasing: {
        name: "Bike Leasing",
        elements: { Activity_Decide: 'Decide on "Leasing & Co"' },
      },
    })
    expect(fetchBpmnXml.mock.calls.map((c) => c[0])).toEqual(["miraveloLeasing", "unknown"])
    expect(processNameOf(index, "miraveloLeasing")).toBe("Bike Leasing")
    expect(processNameOf(index, "unknown")).toBeNull()
    expect(elementNameOf(index, "miraveloLeasing", "Activity_Decide")).toBe(
      'Decide on "Leasing & Co"',
    )
    expect(elementNameOf(index, "miraveloLeasing", "constructor")).toBeNull()
    expect(elementNameOf(index, "unknown", "x")).toBeNull()
    expect(elementNameOf(undefined, "a", "b")).toBeNull()
    // Without an element list a key comes with every named element.
    const all = await namesFor(["miraveloLeasing"])
    expect(Object.keys(all.miraveloLeasing.elements)).toHaveLength(4)
  })

  it("reuses a read, an empty one too, until it is older than the ttl", async () => {
    let now = 0
    const fetchBpmnXml = vi.fn((key: string) => Promise.resolve(key === "a" ? LEASING : null))
    const namesFor = createNameLookup(fetchBpmnXml, { ttlMs: 1000, now: () => now })
    await namesFor(["a", "b"])
    now = 999
    await namesFor(["a", "b"])
    expect(fetchBpmnXml).toHaveBeenCalledTimes(2)
    now = 1000
    await namesFor(["a", "b"])
    expect(fetchBpmnXml).toHaveBeenCalledTimes(4)
  })

  it("goes on with the ids when a read fails or is slow, and asks again next time", async () => {
    vi.useFakeTimers()
    const fetchBpmnXml = vi.fn((key: string) =>
      key === "slow"
        ? new Promise<string | null>(() => {})
        : Promise.reject(new Error("ECONNREFUSED")),
    )
    const namesFor = createNameLookup(fetchBpmnXml, { timeoutMs: 50 })
    const pending = namesFor(["slow", "broken"])
    await vi.advanceTimersByTimeAsync(50)
    expect(await pending).toEqual({})
    const again = namesFor(["slow", "broken"])
    await vi.advanceTimersByTimeAsync(50)
    await again
    expect(fetchBpmnXml).toHaveBeenCalledTimes(4)
    expect(vi.getTimerCount()).toBe(0)
  })

  // The fetcher rejects a failed read and resolves null only for "no such model".
  it("keeps a 'no such model' answer but never a failure", async () => {
    let engineUp = false
    const fetchBpmnXml = vi.fn((key: string) =>
      engineUp
        ? Promise.resolve(key === "miraveloLeasing" ? LEASING : null)
        : Promise.reject(new Error("503 Service Unavailable")),
    )
    const namesFor = createNameLookup(fetchBpmnXml)
    expect(await namesFor(["miraveloLeasing", "unknown"])).toEqual({})
    engineUp = true
    expect(processNameOf(await namesFor(["miraveloLeasing", "unknown"]), "miraveloLeasing")).toBe(
      "Bike Leasing",
    )
    expect(fetchBpmnXml).toHaveBeenCalledTimes(4)
    // Now both are answers: the names and "no such model", both kept.
    await namesFor(["miraveloLeasing", "unknown"])
    expect(fetchBpmnXml).toHaveBeenCalledTimes(4)
  })

  it("leaves no timer pending after a fast view", async () => {
    vi.useFakeTimers()
    const fetchBpmnXml = vi.fn<FetchBpmnXml>(() => Promise.resolve(LEASING))
    const index = await createNameLookup(fetchBpmnXml)(["miraveloLeasing"])
    expect(processNameOf(index, "miraveloLeasing")).toBe("Bike Leasing")
    expect(vi.getTimerCount()).toBe(0)
  })

  it("finishes a slow read for the next view", async () => {
    vi.useFakeTimers()
    let answer: (xml: string) => void = () => {}
    const fetchBpmnXml = vi.fn(
      () =>
        new Promise<string | null>((resolve) => {
          answer = resolve
        }),
    )
    const namesFor = createNameLookup(fetchBpmnXml, { timeoutMs: 50 })
    const first = namesFor(["miraveloLeasing"])
    await vi.advanceTimersByTimeAsync(50)
    expect(await first).toEqual({})
    answer(LEASING)
    await vi.advanceTimersByTimeAsync(0)
    expect(processNameOf(await namesFor(["miraveloLeasing"]), "miraveloLeasing")).toBe(
      "Bike Leasing",
    )
    expect(fetchBpmnXml).toHaveBeenCalledTimes(1)
  })

  it("looks up at most maxKeys keys for one view, in the order it names them", async () => {
    const fetchBpmnXml = vi.fn<FetchBpmnXml>(() => Promise.resolve(null))
    await createNameLookup(fetchBpmnXml, { maxKeys: 2 })(["a", "b", "c"])
    expect(fetchBpmnXml.mock.calls.map((c) => c[0])).toEqual(["a", "b"])
  })

  it("keeps at most maxEntries answers, dropping the oldest first", async () => {
    const fetchBpmnXml = vi.fn<FetchBpmnXml>(() => Promise.resolve(null))
    const namesFor = createNameLookup(fetchBpmnXml, { maxEntries: 2 })
    await namesFor(["a", "b", "c"])
    expect(fetchBpmnXml).toHaveBeenCalledTimes(3)
    // "b" and "c" are still kept; "a" went first and is read again.
    await namesFor(["b", "c"])
    expect(fetchBpmnXml).toHaveBeenCalledTimes(3)
    await namesFor(["a"])
    expect(fetchBpmnXml).toHaveBeenCalledTimes(4)
  })

  it("keeps a re-read answer as the newest, so the next to go is the oldest read", async () => {
    let now = 0
    const fetchBpmnXml = vi.fn<FetchBpmnXml>(() => Promise.resolve(null))
    const namesFor = createNameLookup(fetchBpmnXml, { maxEntries: 2, ttlMs: 1000, now: () => now })
    await namesFor(["a", "b"])
    now = 1000
    // "a" expired and is read again: now the newest, "b" the oldest.
    await namesFor(["a"])
    await namesFor(["c"])
    expect(fetchBpmnXml).toHaveBeenCalledTimes(4)
    // "b" went for "c"; "a" is still kept.
    await namesFor(["a"])
    expect(fetchBpmnXml).toHaveBeenCalledTimes(4)
    await namesFor(["b"])
    expect(fetchBpmnXml).toHaveBeenCalledTimes(5)
  })

  it("never reads an inherited entry for a key such as constructor", async () => {
    const fetchBpmnXml = vi.fn<FetchBpmnXml>(() =>
      Promise.resolve('<process id="constructor" name="Odd"><task id="T" name="Step"/></process>'),
    )
    const index = await createNameLookup(fetchBpmnXml)(["constructor"], {
      elementIds: {},
      enginesByKey: {},
    })
    expect(index.constructor).toEqual({ name: "Odd", elements: { T: "Step" } })
    expect(fetchBpmnXml.mock.calls).toEqual([["constructor", undefined]])
  })
})

// A process may run on any configured engine, not only the default one (#322 review).
describe("createNameLookup on several engines", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  function fleet(models: Record<string, Record<string, string>>, down: string[] = []) {
    return vi.fn<FetchBpmnXml>((key, engine) => {
      if (engine && down.includes(engine)) return Promise.reject(new Error("503"))
      return Promise.resolve(models[engine ?? "default"]?.[key] ?? null)
    })
  }

  it("reads a key on the view's engines in order until one has its model", async () => {
    const fetchBpmnXml = fleet({ "prod-c": { miraveloLeasing: LEASING } }, ["prod-a"])
    const index = await createNameLookup(fetchBpmnXml)(["miraveloLeasing"], {
      engines: ["prod-a", "prod-b", "prod-c", "prod-d"],
    })
    expect(processNameOf(index, "miraveloLeasing")).toBe("Bike Leasing")
    expect(fetchBpmnXml.mock.calls.map((c) => c[1])).toEqual(["prod-a", "prod-b", "prod-c"])
  })

  it("prefers a key's own engines over the view's, and the default engine without either", async () => {
    const fetchBpmnXml = fleet({
      "prod-b": { miraveloLeasing: LEASING },
      default: { other: '<process id="other" name="Other"/>' },
    })
    const namesFor = createNameLookup(fetchBpmnXml)
    const index = await namesFor(["miraveloLeasing"], {
      enginesByKey: { miraveloLeasing: ["prod-b"] },
      engines: ["prod-a"],
    })
    expect(processNameOf(index, "miraveloLeasing")).toBe("Bike Leasing")
    expect(processNameOf(await namesFor(["other"]), "other")).toBe("Other")
    expect(fetchBpmnXml.mock.calls).toEqual([
      ["miraveloLeasing", "prod-b"],
      ["other", undefined],
    ])
  })

  it("takes an empty engine list as none: the view's engines, else the default engine", async () => {
    const fetchBpmnXml = fleet({ "prod-a": { miraveloLeasing: LEASING } })
    const namesFor = createNameLookup(fetchBpmnXml)
    const index = await namesFor(["miraveloLeasing"], {
      enginesByKey: { miraveloLeasing: [] },
      engines: ["prod-a"],
    })
    expect(processNameOf(index, "miraveloLeasing")).toBe("Bike Leasing")
    expect(await namesFor(["other"], { engines: [] })).toEqual({})
    expect(fetchBpmnXml.mock.calls).toEqual([
      ["miraveloLeasing", "prod-a"],
      ["other", undefined],
    ])
  })

  it("keeps each engine's answer apart", async () => {
    const fetchBpmnXml = fleet({ "prod-b": { miraveloLeasing: LEASING } })
    const namesFor = createNameLookup(fetchBpmnXml)
    // Not on prod-a: kept as "no such model" there, and prod-b still asked.
    expect(await namesFor(["miraveloLeasing"], { engines: ["prod-a"] })).toEqual({})
    const index = await namesFor(["miraveloLeasing"], { engines: ["prod-a", "prod-b"] })
    expect(processNameOf(index, "miraveloLeasing")).toBe("Bike Leasing")
    expect(fetchBpmnXml.mock.calls.map((c) => c[1])).toEqual(["prod-a", "prod-b"])
  })

  it("stops at the view's time budget, not one budget per engine", async () => {
    vi.useFakeTimers()
    const fetchBpmnXml = vi.fn<FetchBpmnXml>((_key, engine) =>
      engine === "prod-a" ? new Promise(() => {}) : Promise.resolve(LEASING),
    )
    const pending = createNameLookup(fetchBpmnXml, { timeoutMs: 50 })(["miraveloLeasing"], {
      engines: ["prod-a", "prod-b"],
    })
    await vi.advanceTimersByTimeAsync(50)
    expect(await pending).toEqual({})
    expect(fetchBpmnXml.mock.calls.map((c) => c[1])).toEqual(["prod-a"])
    expect(vi.getTimerCount()).toBe(0)
  })
})

// Passthrough auth answers with each caller's own permissions (#322 review).
describe("createNameLookup per caller", () => {
  const ALICE = { authUserId: "alice", authorization: "Bearer token-alice" }
  const BOB = { authUserId: "bob", authorization: "Bearer token-bob" }

  /** A passthrough engine: only Alice's token may read the model. */
  const passthrough = () =>
    vi.fn<FetchBpmnXml>(() =>
      Promise.resolve(getMcpRequestInfo()?.authorization === ALICE.authorization ? LEASING : null),
    )

  it("never hands one caller's names to another", async () => {
    const fetchBpmnXml = passthrough()
    const namesFor = createNameLookup(fetchBpmnXml)
    const alice = await runWithMcpRequestInfo(ALICE, () => namesFor(["miraveloLeasing"]))
    expect(processNameOf(alice, "miraveloLeasing")).toBe("Bike Leasing")
    const bob = await runWithMcpRequestInfo(BOB, () => namesFor(["miraveloLeasing"]))
    expect(bob).toEqual({})
    expect(fetchBpmnXml).toHaveBeenCalledTimes(2)
  })

  it("never hides the names from a caller because another was refused", async () => {
    const fetchBpmnXml = passthrough()
    const namesFor = createNameLookup(fetchBpmnXml)
    expect(await runWithMcpRequestInfo(BOB, () => namesFor(["miraveloLeasing"]))).toEqual({})
    // A request without a token is a caller of its own too.
    expect(await namesFor(["miraveloLeasing"])).toEqual({})
    const alice = await runWithMcpRequestInfo(ALICE, () => namesFor(["miraveloLeasing"]))
    expect(processNameOf(alice, "miraveloLeasing")).toBe("Bike Leasing")
    // Each caller's own answer is still kept.
    await runWithMcpRequestInfo(ALICE, () => namesFor(["miraveloLeasing"]))
    await runWithMcpRequestInfo(BOB, () => namesFor(["miraveloLeasing"]))
    expect(fetchBpmnXml).toHaveBeenCalledTimes(3)
  })

  it("takes the partition from the injected caller when one is given", async () => {
    let caller = "a"
    const fetchBpmnXml = vi.fn<FetchBpmnXml>(() => Promise.resolve(LEASING))
    const namesFor = createNameLookup(fetchBpmnXml, { caller: () => caller })
    await namesFor(["miraveloLeasing"])
    await namesFor(["miraveloLeasing"])
    expect(fetchBpmnXml).toHaveBeenCalledTimes(1)
    caller = "b"
    await namesFor(["miraveloLeasing"])
    expect(fetchBpmnXml).toHaveBeenCalledTimes(2)
  })
})
