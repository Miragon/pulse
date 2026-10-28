import { afterEach, describe, expect, it } from "vitest"
import { feedPayload } from "../tools/test-support/feed-payload.js"
import type { MCPServer } from "mcp-use"
import type { z } from "zod"
import type { PipelineStepDefinition } from "@miragon/mcp-toolkit-core"
import { definition } from "../definition.js"
import { createEngineRegistry, type Camunda7StepAppConfig } from "../lib/resolve-engine.js"
import { providerForEntry } from "../providers/index.js"
import {
  CAMUNDA7_COCKPIT_OVERVIEW_DATA,
  CAMUNDA7_SHOW_BPMN_VIEWER,
  CAMUNDA7_SHOW_HISTORY_TIMELINE,
  CAMUNDA7_SHOW_INCIDENTS_DASHBOARD,
  CAMUNDA7_SHOW_INSTANCE_DETAIL,
  CAMUNDA7_SHOW_JOB_PANEL,
  CAMUNDA7_SHOW_PROCESS_INCIDENTS,
  CAMUNDA7_SHOW_PROCESS_LIST,
} from "../tool-names.js"
import { startFakeEngine, type FakeEngine } from "../tools/test-support/fake-engine.js"
import { WORLD, worldReply } from "../tools/test-support/engine-world.js"
import { registerWidgetTools } from "../widget-tools.js"

/**
 * Requests are compared too, not only data: the small world answers most filters alike, so
 * equal payloads alone would let a step drop or misname a scoping key.
 */

const engines: FakeEngine[] = []
afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

interface Twin {
  /** The show tool (or, without one, the `*_data` feed) rendering the same data. */
  twinTool: string
  args: Record<string, unknown>
  keys: Record<string, unknown>
}

const instance = {
  args: { processInstanceId: WORLD.instanceId },
  keys: { "camunda7:processInstanceId": WORLD.instanceId },
}

const TWINS: Record<string, Twin> = {
  "camunda7:load-process-definitions": {
    twinTool: CAMUNDA7_SHOW_PROCESS_LIST,
    args: { processDefinitionKey: WORLD.key, nameLike: "Ord" },
    keys: { "camunda7:processDefinitionKey": WORLD.key, "camunda7:nameLike": "Ord" },
  },
  "camunda7:load-process-instance": { twinTool: CAMUNDA7_SHOW_INSTANCE_DETAIL, ...instance },
  "camunda7:load-incidents-dashboard": {
    twinTool: CAMUNDA7_SHOW_INCIDENTS_DASHBOARD,
    args: { processDefinitionKey: WORLD.key, incidentType: "failedJob" },
    keys: {
      "camunda7:incidentsProcessDefinitionKey": WORLD.key,
      "camunda7:incidentType": "failedJob",
    },
  },
  "camunda7:load-process-incidents": {
    twinTool: CAMUNDA7_SHOW_PROCESS_INCIDENTS,
    args: { processDefinitionKey: WORLD.key },
    keys: { "camunda7:processDefinitionKey": WORLD.key },
  },
  "camunda7:load-history-timeline": { twinTool: CAMUNDA7_SHOW_HISTORY_TIMELINE, ...instance },
  "camunda7:load-cockpit-dashboard": {
    twinTool: CAMUNDA7_COCKPIT_OVERVIEW_DATA,
    args: {},
    keys: {},
  },
  "camunda7:load-bpmn-viewer": { twinTool: CAMUNDA7_SHOW_BPMN_VIEWER, ...instance },
  "camunda7:load-jobs": { twinTool: CAMUNDA7_SHOW_JOB_PANEL, args: {}, keys: {} },
}

type ToolCallback = (args: Record<string, unknown>, ctx?: unknown) => Promise<unknown>
interface ToolResult {
  isError?: boolean
  structuredContent?: {
    context?: { stepData?: Record<string, { data: unknown }> }
  } & Record<string, unknown>
}

/** Pass `existing` for a second client on the same fake engine. */
async function world(reply = worldReply, existing?: FakeEngine) {
  const engine = existing ?? (await startFakeEngine({}, reply))
  if (!existing) engines.push(engine)
  const registry = createEngineRegistry([{ id: "prod-a", baseUrl: engine.baseUrl }], (e) =>
    providerForEntry(e).createClient(e, { type: "none" }),
  )
  const tools = new Map<string, { schema: z.ZodType; callback: ToolCallback }>()
  const server = {
    tool: (def: { name: string; inputSchema: z.ZodType }, callback: ToolCallback) => {
      tools.set(def.name, { schema: def.inputSchema, callback })
    },
  } as unknown as MCPServer
  registerWidgetTools(server, registry, { toolset: "read-only" })
  const appConfig: Camunda7StepAppConfig = { registry, engines: registry.engines }
  return { tools, appConfig, engine }
}

/** The two runs compute a recency cutoff moments apart. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/

function requestsOf(engine: FakeEngine, from: number): string[] {
  return engine.requests
    .slice(from)
    .map((r) => {
      const query = Object.entries(r.query)
        .map(([name, value]) => `${name}=${INSTANT.test(value) ? "<instant>" : value}`)
        .sort()
        .join("&")
      return `${r.method} ${r.path}?${query}`
    })
    .sort()
}

function twinData(result: ToolResult): unknown {
  expect(result.isError, JSON.stringify(result)).toBeFalsy()
  const payload = feedPayload<{ context?: { stepData?: Record<string, { data: unknown }> } }>(
    result,
  )
  const stepData = payload.context?.stepData
  return stepData ? Object.values(stepData)[0]?.data : payload
}

const steps = definition.steps as PipelineStepDefinition<Camunda7StepAppConfig>[]
const run = (
  step: PipelineStepDefinition<Camunda7StepAppConfig>,
  twin: Twin,
  appConfig: Camunda7StepAppConfig,
) => step.execute({ steps: {}, keys: twin.keys, errors: [] }, appConfig)

describe("camunda7 pipeline steps are thin adapters over their show tools' builders", () => {
  it("the twin table names every registered step", () => {
    expect(steps.map((s) => s.id).sort()).toEqual(Object.keys(TWINS).sort())
  })

  describe.each(steps.map((s) => [s.id, s] as const))("%s", (id, step) => {
    const twin = TWINS[id]

    it("renders exactly its twin's data from exactly its twin's requests, engineId stamped", async () => {
      const { tools, engine } = await world()
      const tool = tools.get(twin.twinTool)!
      const viaTool = twinData(
        (await tool.callback(
          tool.schema.parse(twin.args) as Record<string, unknown>,
          {},
        )) as ToolResult,
      )
      const toolRequests = requestsOf(engine, 0)

      // The XML read is cached per client, so a shared one would skip the diagram read.
      const stepStart = engine.requests.length
      const { appConfig } = await world(worldReply, engine)
      const output = await run(step, twin, appConfig)

      expect(output.data).toEqual(viaTool)
      expect(output.data).toMatchObject({ engineId: "prod-a" })
      expect(requestsOf(engine, stepStart)).toEqual(toolRequests)
    })

    it("fails — never a success-shaped empty payload — when the engine fails", async () => {
      const { appConfig } = await world(() => ({ status: 503, body: { message: "shutting down" } }))
      await expect(run(step, twin, appConfig)).rejects.toThrow()
    })

    it("declares what render-view needs to build it: a description and its optional keys", () => {
      expect(step.description).toMatch(/\w.{20,}/)
      const optional = (step.optionalKeys ?? []).map((k) => k.key)
      expect(optional).toContain("camunda7:engine")
      for (const key of Object.keys(twin.keys)) {
        expect([...step.requires, ...optional]).toContain(key)
      }
      for (const declared of step.optionalKeys ?? []) expect(declared.description).toBeTruthy()
    })
  })

  it("routes a step to the engine its `camunda7:engine` key names", async () => {
    const { appConfig } = await world()
    const jobs = steps.find((s) => s.id === "camunda7:load-jobs")!
    await expect(
      jobs.execute({ steps: {}, keys: { "camunda7:engine": "nope" }, errors: [] }, appConfig),
    ).rejects.toThrow(/Unknown engine id "nope"/)
  })

  it("every widget tells render-view what it shows and which step feeds it", () => {
    const stepTypes = new Set(steps.map((s) => s.dataType))
    for (const widget of definition.widgets) {
      expect({ id: widget.id, description: widget.description }).toEqual({
        id: widget.id,
        description: expect.stringMatching(/\w.{20,}/) as string,
      })
      for (const dataType of widget.consumes ?? []) expect(stepTypes).toContain(dataType)
    }
  })
})
