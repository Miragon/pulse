import { afterEach, describe, expect, it } from "vitest"
import { recordingModuleServer } from "@miragon/pulse-widget-shell/testing"
import { DEFAULT_VERDICT_THRESHOLDS } from "@miragon/pulse-c7-core"
import { createPlugin } from "../plugin.js"
import { ENGINE_LIST_ENGINES } from "../tool-names.js"
import {
  ALL,
  closeFakeEngines,
  cockpitDown,
  cockpitOf,
  cockpitOn,
  dataOf,
  factsOf,
  textOf,
  THREE,
} from "./cockpit.test-support.js"

afterEach(closeFakeEngines)

describe("engine_open_cockpit: the cockpit bootstrap", () => {
  it("hands the app each engine's id, environment and dialect, never its internal REST baseUrl", async () => {
    const { handler, requests } = await cockpitOn([
      { id: "alpha", baseUrl: "http://alpha.internal:8410/engine-rest", environment: "prod" },
      { id: "beta", baseUrl: "http://beta.internal:8410/engine-rest" },
    ])
    const result = await handler({})
    expect(dataOf(result)).toEqual({
      engineId: null,
      engines: [
        { id: "alpha", environment: "prod", dialect: "c7" },
        { id: "beta", environment: "default", dialect: "c7" },
      ],
      start: null,
    })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain("engine-rest")
    expect(serialized).not.toContain(".internal")
    // The picker reads nothing: the user has not chosen an engine yet.
    expect(requests).toEqual([])
  })

  it("opens the overview on the only engine, with no REST baseUrl or internal host in the result", async () => {
    const { handler } = await cockpitOn([{ id: "solo" }])
    const result = await handler({})
    const data = dataOf(result)
    expect(data).toMatchObject({
      engineId: "solo",
      engines: [{ id: "solo", environment: "default" }],
      start: { view: { section: "overview" } },
    })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain("engine-rest")
    expect(serialized).not.toContain("127.0.0.1")
    expect(serialized).not.toContain(".internal")
  })
})

/** #341: the result never names an engine the user is not looking at. */
describe("engine_open_cockpit: the engine it opens on", () => {
  it("honours the `engine` argument", async () => {
    const result = await (await cockpitOn(THREE)).handler({ engine: "beta" })
    expect(result.isError).toBeUndefined()
    expect(dataOf(result)).toMatchObject({ engineId: "beta", engines: ALL })
    expect(factsOf(result)).toMatchObject({ engine: "beta", view: "overview" })
  })

  it("an unknown `engine` is a tool error, never a silent picker", async () => {
    const result = await (await cockpitOn(THREE)).handler({ engine: "delta" })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(
      '[UNKNOWN_ENGINE] Unknown engine id "delta". Available: alpha, beta, gamma.',
    )
  })

  it("opens on the default engine", async () => {
    const result = await (await cockpitOn(THREE, { defaultEngineId: "gamma" })).handler({})
    expect(dataOf(result)).toMatchObject({ engineId: "gamma", engines: ALL })
    expect(factsOf(result)).toMatchObject({ engine: "gamma", view: "overview" })
  })

  it("an explicit `engine` beats the default engine", async () => {
    const { handler } = await cockpitOn(THREE, { defaultEngineId: "gamma" })
    expect(dataOf(await handler({ engine: "alpha" }))).toMatchObject({ engineId: "alpha" })
  })

  it("several engines, no default: the picker, and the result lists the engines", async () => {
    const { handler, requests } = await cockpitOn(THREE)
    const result = await handler({})
    expect(dataOf(result)).toEqual({ engineId: null, engines: ALL, start: null })
    expect(textOf(result)).toBe('{"engine":null,"engines":["alpha","beta","gamma"]}')
    expect(requests).toEqual([])
  })

  it("a view with no engine to read is ENGINE_NOT_SELECTED, naming the engines", async () => {
    const { handler, requests } = await cockpitOn(THREE)
    const result = await handler({ view: "incidents" })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe(
      "[ENGINE_NOT_SELECTED] No engine specified and no default engine configured. Pass `engine`, one of: alpha, beta, gamma.",
    )
    expect(requests).toEqual([])
  })
})

describe("engine_open_cockpit and engine_list_engines", () => {
  it("the bootstrap lists exactly the engines engine_list_engines lists, in its order", async () => {
    const recording = recordingModuleServer()
    createPlugin({
      engines: [
        { id: "prod-b", baseUrl: "http://b.invalid/engine-rest", environment: "us" },
        { id: "prod-a", baseUrl: "http://a.invalid/engine-rest", environment: "eu" },
        { id: "prod-c", baseUrl: "http://c.invalid/engine-rest" },
      ],
    }).register(recording.server)
    const listed = JSON.parse(textOf(await recording.tool(ENGINE_LIST_ENGINES).call({}))) as {
      engines: Array<{ id: string }>
    }
    const opened = dataOf(await cockpitOf(recording).handler({})).engines as Array<{
      id: string
    }>
    expect(listed.engines.map((e) => e.id)).toHaveLength(3)
    expect(opened.map((e) => e.id)).toEqual(listed.engines.map((e) => e.id))
  })
})

describe("engine_open_cockpit: the start view", () => {
  it("returns the start view's data and its facts as compact JSON", async () => {
    const { handler } = await cockpitOn([{ id: "solo" }])
    const result = await handler({ view: "jobs", processDefinitionKey: "order", failedOnly: true })
    expect(dataOf(result)).toMatchObject({
      engineId: "solo",
      start: {
        view: { section: "jobs", processDefinitionKey: "order", failedOnly: true },
        data: { totalCount: 1, failedCount: 1 },
      },
    })
    expect(textOf(result)).toBe(
      '{"engine":"solo","view":"jobs","processDefinitionKey":"order","failedOnly":true,"totalCount":1,"failedCount":1}',
    )
  })

  it("leaves an id the view does not need out of the route", async () => {
    const { handler } = await cockpitOn([{ id: "solo" }])
    const result = await handler({ view: "process-instances", processDefinitionKey: "" })
    expect((dataOf(result).start as { view: object }).view).toEqual({
      section: "process-instances",
    })
  })

  it("a failed start read is a tool error, never a view of zeros", async () => {
    const result = await (await cockpitDown())({ engine: "solo" })
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toBeUndefined()
    expect(textOf(result)).toMatch(/^\[503\]/)
  })

  // #340: the deployment's OWN thresholds, so the model reads the rule the verdict followed.
  it("states the verdict rule with the deployment's thresholds", async () => {
    const { handler } = await cockpitOn([{ id: "solo" }], {
      healthThresholds: { ...DEFAULT_VERDICT_THRESHOLDS, criticalIncidents: 10 },
    })
    expect(factsOf(await handler({})).statusRule).toBe(
      "From the engine's open incidents, read live: critical at >=10 open incidents or >=25 of one cause, warning with any, else ok.",
    )
  })
})

describe("engine_open_cockpit: the input rules", () => {
  const parse = async (args: Record<string, unknown>) => {
    const { definition } = await cockpitOn([{ id: "solo" }])
    const parsed = definition.inputSchema.safeParse(args)
    return parsed.success ? [] : parsed.error.issues.map((i) => [i.path.join("."), i.message])
  }

  it.each([
    [{}, []],
    [{ view: "overview" }, []],
    [{ view: "process-detail", processDefinitionKey: "order", focus: "incidents" }, []],
    [{ view: "jobs", processDefinitionKey: "order", failedOnly: false }, []],
    [
      { view: "cluster-detail", activityId: "a", incidentType: "failedJob", messageSignature: "m" },
      [],
    ],
    [{ view: "history", processInstanceId: "pi-1", engine: "solo" }, []],
    [{ view: "board", board: "orders" }, []],
    [{ view: "landing" }, []],
  ])("accepts %j", async (args, issues) => {
    expect(await parse(args)).toEqual(issues)
  })

  it.each([
    [
      { view: "cluster-detail" },
      [
        ["activityId", 'view "cluster-detail" needs activityId.'],
        ["incidentType", 'view "cluster-detail" needs incidentType.'],
      ],
    ],
    [
      { view: "process-detail" },
      [["processDefinitionKey", 'view "process-detail" needs processDefinitionKey.']],
    ],
    [
      { view: "instance-detail" },
      [["processInstanceId", 'view "instance-detail" needs processInstanceId.']],
    ],
    [{ view: "incident-detail" }, [["incidentId", 'view "incident-detail" needs incidentId.']]],
    [{ view: "history" }, [["processInstanceId", 'view "history" needs processInstanceId.']]],
    // An empty id counts as missing.
    [
      { view: "history", processInstanceId: "" },
      [["processInstanceId", 'view "history" needs processInstanceId.']],
    ],
    [{ view: "board" }, [["board", 'view "board" needs board.']]],
  ])("refuses a missing id: %j", async (args, issues) => {
    expect(await parse(args)).toEqual(issues)
  })

  it.each([
    [
      { processDefinitionKey: "order" },
      [["processDefinitionKey", 'view "overview" takes no processDefinitionKey.']],
    ],
    [
      { view: "incidents", incidentId: "i" },
      [["incidentId", 'view "incidents" takes no incidentId.']],
    ],
    [
      { view: "instance-detail", processInstanceId: "pi-1", focus: "incidents" },
      [["focus", 'view "instance-detail" takes no focus (it takes processInstanceId).']],
    ],
    [
      { view: "jobs", activityId: "a" },
      [
        [
          "activityId",
          'view "jobs" takes no activityId (it takes processDefinitionKey, failedOnly).',
        ],
      ],
    ],
    [
      { view: "cluster-detail", activityId: "a", incidentType: "t", failedOnly: true },
      [
        [
          "failedOnly",
          'view "cluster-detail" takes no failedOnly (it takes activityId, incidentType, messageSignature).',
        ],
      ],
    ],
    [{ board: "orders" }, [["board", 'view "overview" takes no board.']]],
    [{ view: "landing", board: "orders" }, [["board", 'view "landing" takes no board.']]],
  ])("refuses an id the view does not take: %j", async (args, issues) => {
    expect(await parse(args)).toEqual(issues)
  })

  it("refuses an engine on an app route: a board reads the engines it names, the landing lists them", async () => {
    expect(await parse({ view: "board", board: "orders", engine: "solo" })).toEqual([
      ["engine", 'view "board" opens no single engine: it takes no engine.'],
    ])
    expect(await parse({ view: "landing", engine: "solo" })).toEqual([
      ["engine", 'view "landing" opens no single engine: it takes no engine.'],
    ])
  })

  it("refuses a board id the id rule refuses", async () => {
    const issues = await parse({ view: "board", board: "../orders" })
    expect(issues.map(([path]) => path)).toEqual(["board"])
  })

  it("still names every valid key for an unknown one", async () => {
    const issues = await parse({ processDefinitionId: "order:1:x" })
    expect(issues).toHaveLength(1)
    expect(issues[0][1]).toBe(
      'Unknown key "processDefinitionId". Valid keys: "view", "processDefinitionKey", "focus", "activityId", "incidentType", "messageSignature", "processInstanceId", "incidentId", "failedOnly", "board", "engine".',
    )
  })

  it("refuses an unknown view", async () => {
    const issues = await parse({ view: "process-list" })
    expect(issues.map(([path]) => path)).toEqual(["view"])
  })
})
