import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ToolConfig } from "@miragon/mcp-toolkit-core/tools"
import type { Client } from "@miragon/pulse-camunda7-client"

// The guards capture the full registrar surface; no handler may reach a real engine.
vi.mock("@miragon/pulse-camunda7-client/sdk", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return Object.fromEntries(Object.keys(actual).map((name) => [name, vi.fn()]))
})

import { z } from "zod"
import * as sdk from "@miragon/pulse-camunda7-client/sdk"
import { MAX_PAGE_SIZE } from "@miragon/pulse-camunda7-client/schemas"
import { paginatedListOutput } from "../lib/pagination.js"
import { createEngineRegistry, type EngineRegistry } from "../lib/resolve-engine.js"
import type { ProfileStore } from "@miragon/pulse-widget-shell/server"
import { registerTools } from "./index.js"
import { registerIncidentIssueTools } from "./incident-issue.js"
import { registerEngineTools } from "./engines.js"

type Register = Parameters<typeof registerTools>[0]
type Config = ToolConfig<EngineRegistry>

function captureTools(...registerFns: Array<(register: Register) => void>): Map<string, Config> {
  const tools = new Map<string, Config>()
  const register = Object.assign((config: Config) => tools.set(config.name, config), {
    getRegisteredTools: () => [],
  }) as unknown as Register
  for (const fn of registerFns) fn(register)
  return tools
}

/** Mirrors plugin.ts, so a new tool lands under the guards without touching this test. */
const tools = captureTools(
  (register) => registerEngineTools(register, {} as ProfileStore),
  (register) => registerTools(register, { allowDeployments: true }),
  (register) => registerIncidentIssueTools(register, {}),
)

const fakeClient = { fake: true } as unknown as Client

const registry: EngineRegistry = createEngineRegistry(
  [{ id: "default", baseUrl: "http://localhost:8080/engine-rest" }],
  () => fakeClient,
)

function callTool(name: string, args: Record<string, unknown>) {
  const config = tools.get(name)
  if (!config) throw new Error(`tool ${name} not registered`)
  return config.handler(registry, args)
}

/** `engineQuery` (default: the args) must reach BOTH the page and the count query. */
interface ListCase {
  tool: string
  list: (typeof sdk)[keyof typeof sdk]
  count: (typeof sdk)[keyof typeof sdk]
  filterArgs: Record<string, unknown>
  engineQuery?: Record<string, unknown>
}

const cases: readonly ListCase[] = [
  {
    tool: "camunda7_list_process_instances",
    list: sdk.getProcessInstances,
    count: sdk.getProcessInstancesCount,
    filterArgs: { processDefinitionKey: "invoice", active: true },
  },
  {
    tool: "camunda7_list_tasks",
    list: sdk.getTasks,
    count: sdk.getTasksCount,
    filterArgs: { assignee: "demo" },
  },
  {
    tool: "camunda7_list_jobs",
    list: sdk.getJobs,
    count: sdk.getJobsCount,
    filterArgs: { noRetriesLeft: true },
  },
  {
    tool: "camunda7_list_incidents",
    list: sdk.getIncidents,
    count: sdk.getIncidentsCount,
    filterArgs: { incidentType: "failedJob" },
  },
  {
    tool: "camunda7_query_historic_process_instances",
    list: sdk.getHistoricProcessInstances,
    count: sdk.getHistoricProcessInstancesCount,
    filterArgs: { processDefinitionKey: "invoice", finished: true },
  },
  {
    tool: "camunda7_query_historic_activity_instances",
    list: sdk.getHistoricActivityInstances,
    count: sdk.getHistoricActivityInstancesCount,
    filterArgs: { processInstanceId: "pi-1", activityType: "userTask" },
  },
  {
    tool: "camunda7_query_historic_task_instances",
    list: sdk.getHistoricTaskInstances,
    count: sdk.getHistoricTaskInstancesCount,
    filterArgs: { assignee: "demo" },
    engineQuery: { taskAssignee: "demo" },
  },
  {
    tool: "camunda7_query_historic_variable_instances",
    list: sdk.getHistoricVariableInstances,
    count: sdk.getHistoricVariableInstancesCount,
    filterArgs: { variableName: "amount" },
  },
  {
    tool: "camunda7_list_external_tasks",
    list: sdk.getExternalTasks,
    count: sdk.getExternalTasksCount,
    filterArgs: {
      topicName: "invoice-mail",
      workerId: "worker-1",
      locked: true,
      notLocked: false,
      withRetriesLeft: false,
      noRetriesLeft: true,
      processInstanceId: "pi-1",
      processDefinitionKey: "invoice",
      activityId: "send-mail",
    },
    // The engine ignores a false flag, so it becomes its complement.
    engineQuery: {
      topicName: "invoice-mail",
      workerId: "worker-1",
      locked: true,
      noRetriesLeft: true,
      processInstanceId: "pi-1",
      processDefinitionKey: "invoice",
      activityId: "send-mail",
    },
  },
  {
    tool: "camunda7_query_historic_incidents",
    list: sdk.getHistoricIncidents,
    count: sdk.getHistoricIncidentsCount,
    filterArgs: { activityId: "callWms", open: true },
  },
  {
    tool: "camunda7_list_process_definitions",
    list: sdk.getProcessDefinitions,
    count: sdk.getProcessDefinitionsCount,
    filterArgs: { processDefinitionKey: "invoice", latestVersion: true },
    engineQuery: { key: "invoice", latestVersion: true },
  },
  {
    tool: "camunda7_list_deployments",
    list: sdk.getDeployments,
    count: sdk.getDeploymentsCount,
    filterArgs: { nameLike: "invoice" },
    // A %-less LIKE value is a substring match (the engine would match it exactly).
    engineQuery: { nameLike: "%invoice%" },
  },
]

/** A list tool is whatever takes `maxResults`, so a new one is guarded without updating a list. */
describe("every list/query tool shares one pagination contract", () => {
  const listTools = [...tools.values()].filter(
    (c) => c.inputSchema && "maxResults" in c.inputSchema,
  )

  it("captures the whole registrar surface, every domain file included", () => {
    const categories = new Set([...tools.values()].map((c) => c.category))
    for (const category of [
      "engines",
      "messages-signals",
      "migrations",
      "batches",
      "tasks",
      "history",
    ]) {
      expect(categories, category).toContain(category)
    }
  })

  it("covers every case of the envelope table (the guard is not vacuous)", () => {
    expect(listTools.map((c) => c.name).sort()).toEqual(cases.map(({ tool }) => tool).sort())
  })

  it.each(listTools.map((c) => [c.name, c] as const))(
    "%s pages with the envelope and caps maxResults at MAX_PAGE_SIZE",
    (_name, config) => {
      expect(config.outputSchema).toBe(paginatedListOutput)
      const input = z.object(config.inputSchema)
      expect(input.shape).toHaveProperty("firstResult")
      expect(input.safeParse({ maxResults: MAX_PAGE_SIZE }).success).toBe(true)
      expect(input.safeParse({ maxResults: MAX_PAGE_SIZE + 1 }).success).toBe(false)
    },
  )

  it("caps at 100 — one turn's worth of rows", () => {
    expect(MAX_PAGE_SIZE).toBe(100)
  })
})

describe.each(cases)("$tool pagination envelope", ({ tool, list, count, filterArgs, ...c }) => {
  const engineQuery = c.engineQuery ?? filterArgs
  const mockedList = vi.mocked(list as typeof sdk.getProcessInstances)
  const mockedCount = vi.mocked(count as typeof sdk.getProcessInstancesCount)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("advertises the pagination envelope as outputSchema", () => {
    expect(tools.get(tool)?.outputSchema).toBe(paginatedListOutput)
  })

  it("returns { items, totalCount, hasMore, nextOffset } when more pages exist", async () => {
    const page = [{ id: "a" }, { id: "b" }]
    mockedList.mockResolvedValueOnce(page)
    mockedCount.mockResolvedValueOnce({ count: 7 })

    const result = await callTool(tool, { ...filterArgs, firstResult: 2, maxResults: 2 })

    expect(result).toEqual({ items: page, totalCount: 7, hasMore: true, nextOffset: 4 })
    expect(paginatedListOutput.safeParse(result).success).toBe(true)
    expect(mockedList).toHaveBeenCalledWith(
      expect.objectContaining({
        client: fakeClient,
        query: expect.objectContaining({ ...engineQuery, firstResult: 2, maxResults: 2 }),
      }),
    )
    expect(mockedCount).toHaveBeenCalledWith({ client: fakeClient, query: engineQuery })
    const countQuery = mockedCount.mock.calls[0][0]?.query as Record<string, unknown>
    expect(countQuery).not.toHaveProperty("firstResult")
    expect(countQuery).not.toHaveProperty("maxResults")
  })

  it("reports hasMore=false without nextOffset when the page is the full result", async () => {
    const page = [{ id: "a" }]
    mockedList.mockResolvedValueOnce(page)
    mockedCount.mockResolvedValueOnce({ count: 1 })

    const result = await callTool(tool, { ...filterArgs, firstResult: 0, maxResults: 20 })

    expect(result).toEqual({ items: page, totalCount: 1, hasMore: false })
    expect(result).not.toHaveProperty("nextOffset")
  })
})

/** The engine sorts only by a sortBy+sortOrder PAIR (either alone is a 400). */
describe("camunda7_list_external_tasks", () => {
  const EXTERNAL = "camunda7_list_external_tasks"
  const pageQuery = async (args: Record<string, unknown>) => {
    vi.mocked(sdk.getExternalTasks).mockResolvedValueOnce([])
    vi.mocked(sdk.getExternalTasksCount).mockResolvedValueOnce({ count: 0 })
    await callTool(EXTERNAL, { firstResult: 0, maxResults: 20, ...args })
    const query = vi.mocked(sdk.getExternalTasks).mock.calls[0][0]?.query as Record<string, unknown>
    const countQuery = vi.mocked(sdk.getExternalTasksCount).mock.calls[0][0]?.query as Record<
      string,
      unknown
    >
    return { query, countQuery }
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("is a read-only, paged query that says it never touches a task", () => {
    const config = tools.get(EXTERNAL)
    expect(config?.category).toBe("external-tasks")
    expect(config?.annotations).toEqual({
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
    })
    expect(config?.description).toContain("it never locks, completes or fails a task")
    expect(config?.description).toMatch(
      /If hasMore is true, call again with firstResult = nextOffset\.$/,
    )
  })

  it("defaults sortOrder to asc when only sortBy is given", async () => {
    const { query, countQuery } = await pageQuery({ sortBy: "lockExpirationTime" })
    expect(query).toMatchObject({ sortBy: "lockExpirationTime", sortOrder: "asc" })
    expect(countQuery).not.toHaveProperty("sortBy")
    expect(countQuery).not.toHaveProperty("sortOrder")
  })

  it("keeps an explicit sortOrder next to its sortBy", async () => {
    const { query } = await pageQuery({ sortBy: "taskPriority", sortOrder: "desc" })
    expect(query).toMatchObject({ sortBy: "taskPriority", sortOrder: "desc" })
  })

  it("drops a lone sortOrder — the engine rejects it without sortBy", async () => {
    const { query } = await pageQuery({ sortOrder: "desc" })
    expect(query).not.toHaveProperty("sortBy")
    expect(query).not.toHaveProperty("sortOrder")
  })
})

describe("envelope degradation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("falls back to firstResult + items.length (hasMore=false) when the count is unusable", async () => {
    vi.mocked(sdk.getJobs).mockResolvedValueOnce([{ id: "j1" }, { id: "j2" }] as never)
    vi.mocked(sdk.getJobsCount).mockResolvedValueOnce(undefined)

    const result = await callTool("camunda7_list_jobs", { firstResult: 3, maxResults: 2 })

    expect(result).toEqual({
      items: [{ id: "j1" }, { id: "j2" }],
      totalCount: 5,
      hasMore: false,
    })
  })

  it("treats a non-array list response as an empty page", async () => {
    vi.mocked(sdk.getIncidents).mockResolvedValueOnce(undefined)
    vi.mocked(sdk.getIncidentsCount).mockResolvedValueOnce({ count: 0 })

    const result = await callTool("camunda7_list_incidents", {})

    expect(result).toEqual({ items: [], totalCount: 0, hasMore: false })
  })
})

describe("camunda7_set_external_task_retries", () => {
  it("sets the retries on exactly the given external task and echoes them", async () => {
    vi.mocked(sdk.setExternalTaskResourceRetries).mockResolvedValue(undefined)

    const result = await callTool("camunda7_set_external_task_retries", {
      externalTaskId: "ext-1",
      retries: 3,
    })

    expect(sdk.setExternalTaskResourceRetries).toHaveBeenCalledWith({
      client: fakeClient,
      path: { id: "ext-1" },
      body: { retries: 3 },
    })
    expect(result).toEqual({ success: true, externalTaskId: "ext-1", retries: 3 })
  })

  it("is a non-destructive, idempotent operations write — never a read", () => {
    expect(tools.get("camunda7_set_external_task_retries")?.annotations).toEqual({
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    })
  })
})
