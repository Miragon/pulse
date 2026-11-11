import { afterEach, describe, expect, it } from "vitest"
import { z } from "zod"
import { createToolRegistrar } from "@miragon/pulse-widget-shell/server"
import { recordingModuleServer } from "@miragon/pulse-widget-shell/testing"
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

/** #328: before this, no write tool had a handler test and the REST contract broke silently. */

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
  it("handle_external_task_failure requires retries: omitted, the engine reads 0", async () => {
    const engine = await engineWith()
    expect(() =>
      callTool(toolConfig("engine_handle_external_task_failure"), registryFor(engine), {
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
      callTool(toolConfig("engine_set_process_instance_variable"), registryFor(engine), {
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
      callTool(toolConfig("engine_complete_task"), registryFor(engine), {
        taskId: "t-1",
        variables: { due: { value: "next friday", type: "Date" } },
      }),
    ).rejects.toThrow(/Variable "due": Invalid date "next friday": expected ISO 8601/)
    expect(engine.requests).toHaveLength(0)
  })

  it("the batch due date is validated at the tool boundary", async () => {
    const engine = await engineWith()
    expect(() =>
      callTool(toolConfig("engine_set_job_retries_batch"), registryFor(engine), {
        jobIds: ["job-1"],
        retries: 1,
        dueDate: "01.10.2026",
      }),
    ).toThrow(/ISO 8601/)
    expect(engine.requests).toHaveLength(0)
  })
})

const NOT_FINITE =
  "a number that is not finite (a number beyond the range of a double, such as 1e400, reads as " +
  "Infinity)"
/** c7-core's refusal of such a number as the value. */
const REFUSAL =
  `Variable "amount": ${NOT_FINITE} would go out as null; ` +
  "send it as a variable of type String with its digits as text"
/** c7-core's refusal of a value that holds such a number. */
const HELD_REFUSAL =
  `Variable "amount": the value holds ${NOT_FINITE} that would go out as null; ` +
  "send the whole value as JSON text, which keeps its digits"

/**
 * The arguments as the SDK hands them over, parsed from the request's JSON: `1e400`, beyond the
 * range of a double, reads as Infinity, and `value: z.unknown()` lets it through. JSON would send
 * it as null, so the write stored null and reported success (final review S3). One case per tool
 * and input that takes a variable's value.
 */
const NOT_FINITE_WRITES: ReadonlyArray<
  readonly [toolName: string, input: string, argsJson: string, refusal: string]
> = [
  [
    "engine_set_process_instance_variable",
    "value",
    '{"processInstanceId":"pi-1","variableName":"amount","value":1e400,"type":"Double"}',
    REFUSAL,
  ],
  [
    "engine_set_process_instance_variable",
    "value",
    '{"processInstanceId":"pi-1","variableName":"amount","value":{"total":-1e400},"type":"Json"}',
    HELD_REFUSAL,
  ],
  [
    "engine_start_process_instance",
    "variables",
    '{"processDefinitionKey":"invoice","variables":{"amount":{"value":1e400,"type":"Double"}}}',
    REFUSAL,
  ],
  [
    "engine_complete_task",
    "variables",
    '{"taskId":"t-1","variables":{"amount":{"value":[1,1e400]}}}',
    HELD_REFUSAL,
  ],
  [
    "engine_complete_external_task",
    "variables",
    '{"externalTaskId":"ext-1","workerId":"w-1","variables":{"amount":{"value":1e400,"type":"Long"}}}',
    REFUSAL,
  ],
  [
    "engine_correlate_message",
    "correlationKeys",
    '{"messageName":"paid","correlationKeys":{"amount":{"value":1e400,"type":"Double"}}}',
    REFUSAL,
  ],
  [
    "engine_correlate_message",
    "processVariables",
    '{"messageName":"paid","processVariables":{"amount":{"value":-1e400,"type":"Double"}}}',
    REFUSAL,
  ],
  [
    "engine_throw_signal",
    "variables",
    '{"name":"alarm","variables":{"amount":{"value":1e400,"type":"Double"}}}',
    REFUSAL,
  ],
]

/** The parts of a zod schema's definition that hold further schemas. */
interface SchemaDef {
  type: string
  shape?: Record<string, z.ZodType>
  innerType?: z.ZodType
  valueType?: z.ZodType
  element?: z.ZodType
  options?: z.ZodType[]
  items?: z.ZodType[]
  in?: z.ZodType
  out?: z.ZodType
}

const defOf = (schema: z.ZodType) => schema._zod.def as unknown as SchemaDef

/** An object shape that takes a variable's value: `value: z.unknown()`, whatever its name. */
const takesAValue = (shape: Record<string, z.ZodType>) =>
  shape.value !== undefined && defOf(shape.value).type === "unknown"

/** Whether a schema holds, at any depth, an object that takes a variable's value. */
function holdsAValue(schema: z.ZodType): boolean {
  const def = defOf(schema)
  if (def.shape && takesAValue(def.shape)) return true
  const inner = [def.innerType, def.valueType, def.element, def.in, def.out]
  return [...inner, ...(def.options ?? []), ...(def.items ?? []), ...Object.values(def.shape ?? {})]
    .filter((child) => child !== undefined)
    .some(holdsAValue)
}

describe("a variable whose number is not finite is refused before any request", () => {
  it("covers every input of every tool that takes a variable's value", () => {
    // Found by the schema, not by a name: a variables map (variableSchema) or a value of its own.
    const taking = [...tools.values()].flatMap(({ name, inputSchema = {} }) => [
      ...(takesAValue(inputSchema) ? [`${name} value`] : []),
      ...Object.entries(inputSchema)
        .filter(([, schema]) => holdsAValue(schema))
        .map(([input]) => `${name} ${input}`),
    ])
    const covered = new Set(NOT_FINITE_WRITES.map(([toolName, input]) => `${toolName} ${input}`))
    expect(taking.length).toBeGreaterThanOrEqual(7)
    expect([...covered].sort()).toEqual([...new Set(taking)].sort())
  })

  it.each(NOT_FINITE_WRITES)("%s refuses it in %s", async (toolName, _input, argsJson, refusal) => {
    const engine = await engineWith()
    const recording = recordingModuleServer()
    registerTools(createToolRegistrar(recording.server, registryFor(engine)), {
      allowDeployments: true,
    })
    // Validated as the SDK validates a call's arguments before the registrar's callback runs.
    const args = z
      .strictObject(toolConfig(toolName).inputSchema ?? {})
      .parse(JSON.parse(argsJson)) as Record<string, unknown>

    const result = await recording.tool(toolName).call(args)

    expect(result.isError).toBe(true)
    expect(result.content.map((part) => part.text)).toEqual([refusal])
    expect(engine.requests).toEqual([])
  })
})

describe("complete_task never picks its endpoint on a guess", () => {
  const writes = (engine: FakeEngine) => engine.requests.filter((r) => r.method !== "GET")

  it("fails without a write when the task's BPMN cannot be read: a form could be hiding there", async () => {
    const engine = await engineWith({
      ...taskRoutes(TASK, FORM_BPMN),
      "GET /process-definition/def-1/xml": { status: 403, body: { message: "not authorized" } },
    })
    await expect(
      callTool(toolConfig("engine_complete_task"), registryFor(engine), { taskId: "t-1" }),
    ).rejects.toThrow(/^\[403\] not authorized/)
    expect(writes(engine)).toEqual([])
  })

  it("fails without a write when the values an omitted field would lose cannot be read", async () => {
    const engine = await engineWith({
      ...taskRoutes(TASK, FORM_BPMN),
      "GET /task/t-1/variables": { status: 500, body: { message: "Cannot deserialize object" } },
    })
    await expect(
      callTool(toolConfig("engine_complete_task"), registryFor(engine), {
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
      callTool(toolConfig("engine_complete_task"), registryFor(engine), { taskId: "t-1" }),
    ).rejects.toThrow(/No matching task with id t-1/)
    expect(writes(engine)).toEqual([])
  })
})
