import { afterEach, describe, expect, it } from "vitest"
import { registerTools } from "./index.js"
import {
  callTool,
  captureTools,
  registryFor,
  startFakeEngine,
  type FakeEngine,
  type RecordedRequest,
} from "./test-support/fake-engine.js"
import { RUNTIME_WRITE_CASES, type WireRequest } from "./test-support/write-cases.js"
import { OPERATIONS_WRITE_CASES } from "./test-support/write-cases-operations.js"
import { FORM_BPMN, TASK, TASK_WRITE_CASES, taskRoutes } from "./test-support/write-cases-tasks.js"

/** #328: before this, no write tool had a handler test and the engine contract broke silently. */

const tools = captureTools((register) => registerTools(register, { allowDeployments: true }))
const CASES = [...RUNTIME_WRITE_CASES, ...TASK_WRITE_CASES, ...OPERATIONS_WRITE_CASES]

const engines: FakeEngine[] = []
afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

async function engineWith(routes?: Parameters<typeof startFakeEngine>[0]) {
  const engine = await startFakeEngine(routes)
  engines.push(engine)
  return engine
}

function toolConfig(name: string) {
  const config = tools.get(name)
  if (!config) throw new Error(`${name} is not registered`)
  return config
}

function asWire(request: RecordedRequest, expected: WireRequest | undefined): WireRequest {
  const wire: WireRequest = { method: request.method, path: request.path }
  if (Object.keys(request.query).length > 0) wire.query = request.query
  if (request.body !== undefined) {
    wire.body = expected?.body === "multipart" ? "multipart" : request.body
  }
  return wire
}

describe("every engine write tool has a wire case", () => {
  const writeTools = [...tools.values()]
    .filter((config) => config.annotations?.readOnlyHint !== true)
    .map((config) => config.name)

  it("finds the write tools (the guard is not vacuous)", () => {
    expect(writeTools.length).toBeGreaterThanOrEqual(20)
  })

  it.each(writeTools)("%s is pinned by at least one case", (name) => {
    expect(
      CASES.some((c) => c.toolName === name),
      `add a wire case for ${name} to src/tools/test-support/write-cases*.ts`,
    ).toBe(true)
  })

  it("every case names a registered write tool", () => {
    for (const { toolName } of CASES) expect(writeTools).toContain(toolName)
  })
})

describe.each(CASES)("$toolName on the wire", (writeCase) => {
  it(`${writeCase.title}`, async () => {
    const engine = await engineWith(writeCase.routes)
    const result = await callTool(
      toolConfig(writeCase.toolName),
      registryFor(engine),
      writeCase.args,
    )

    expect(engine.requests.map((r, i) => asWire(r, writeCase.wire[i]))).toEqual(writeCase.wire)
    if ("result" in writeCase) expect(result).toEqual(writeCase.result)
  })
})

describe("writes the engine would misread are refused before any request", () => {
  it("handle_external_task_failure requires retries — omitted, the engine reads 0", async () => {
    const engine = await engineWith()
    expect(() =>
      callTool(toolConfig("camunda7_handle_external_task_failure"), registryFor(engine), {
        externalTaskId: "ext-1",
        workerId: "w-1",
        retryTimeout: 300000,
      }),
    ).toThrow(/retries/)
    expect(engine.requests).toHaveLength(0)
  })

  it("an Object variable needs its objectTypeName", async () => {
    const engine = await engineWith()
    await expect(
      callTool(toolConfig("camunda7_set_process_instance_variable"), registryFor(engine), {
        processInstanceId: "pi-1",
        variableName: "obj",
        value: [1, 2],
        type: "Object",
      }),
    ).rejects.toThrow('Variable "obj": an Object value needs valueInfo.objectTypeName')
    expect(engine.requests).toHaveLength(0)
  })

  it("a Date the engine cannot parse is refused with the accepted forms", async () => {
    const engine = await engineWith()
    await expect(
      callTool(toolConfig("camunda7_complete_task"), registryFor(engine), {
        taskId: "t-1",
        variables: { due: { value: "next friday", type: "Date" } },
      }),
    ).rejects.toThrow(/Variable "due": Invalid date "next friday" — expected ISO 8601/)
    expect(engine.requests).toHaveLength(0)
  })

  it("the batch due date is validated at the tool boundary", async () => {
    const engine = await engineWith()
    expect(() =>
      callTool(toolConfig("camunda7_set_job_retries_batch"), registryFor(engine), {
        jobIds: ["job-1"],
        retries: 1,
        dueDate: "01.10.2026",
      }),
    ).toThrow(/ISO 8601/)
    expect(engine.requests).toHaveLength(0)
  })
})

describe("complete_task never picks its endpoint on a guess", () => {
  const writes = (engine: FakeEngine) => engine.requests.filter((r) => r.method !== "GET")

  it("fails without a write when the task's BPMN cannot be read — a form could be hiding there", async () => {
    const engine = await engineWith({
      ...taskRoutes(TASK, FORM_BPMN),
      "GET /process-definition/def-1/xml": { status: 403, body: { message: "not authorized" } },
    })
    await expect(
      callTool(toolConfig("camunda7_complete_task"), registryFor(engine), { taskId: "t-1" }),
    ).rejects.toThrow(/^\[403\] not authorized/)
    expect(writes(engine)).toEqual([])
  })

  it("fails without a write when the values an omitted field would lose cannot be read", async () => {
    const engine = await engineWith({
      ...taskRoutes(TASK, FORM_BPMN),
      "GET /task/t-1/variables": { status: 500, body: { message: "Cannot deserialize object" } },
    })
    await expect(
      callTool(toolConfig("camunda7_complete_task"), registryFor(engine), {
        taskId: "t-1",
        variables: { amount: { value: 5, type: "Long" } },
      }),
    ).rejects.toThrow(/Cannot deserialize object/)
    expect(writes(engine)).toEqual([])
  })

  it("fails for an unknown task", async () => {
    const engine = await engineWith({
      "GET /task/t-1": { status: 404, body: { message: "No matching task with id t-1" } },
    })
    await expect(
      callTool(toolConfig("camunda7_complete_task"), registryFor(engine), { taskId: "t-1" }),
    ).rejects.toThrow(/No matching task with id t-1/)
    expect(writes(engine)).toEqual([])
  })
})
