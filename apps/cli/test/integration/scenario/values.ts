/**
 * The scenario's values and messages: date filters, string, binary and Long variables, --version,
 * raw paths, rejected requests, --fields and a profile written by config set.
 */

import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { expect, it } from "vitest"
import { argv, globalFlag } from "../support/catalog.js"
import { expectError, expectSuccess } from "../support/expect.js"
import { FIXTURES, PROCESS_KEY, USER_TASK_NAME } from "../support/fixtures.js"
import type {
  Count,
  DryRunOutput,
  OutFileSummary,
  PingOutput,
  ProcessDefinition,
  ProcessInstance,
  Task,
  TypedValue,
} from "../support/types.js"
import type { Scenario } from "./suite.js"

export function registerValues(scenario: Scenario): void {
  const { cli, engineUrl, startOrder, countInstances } = scenario

  it("normalizes date-only values of date-time parameters", async () => {
    const filter = { processInstanceBusinessKey: "B-1" }
    const recent = await cli(
      argv("historic-process-instance list", [], { ...filter, startedAfter: "2020-01-01" }),
    )
    expect(expectSuccess(recent).json<unknown[]>()).toHaveLength(1)
    const future = await cli(
      argv("historic-process-instance list", [], { ...filter, startedAfter: "2999-01-01" }),
    )
    expect(expectSuccess(future).json<unknown[]>()).toEqual([])

    const preview = await cli(
      argv("historic-process-instance list", [], { startedAfter: "2020-01-01", "dry-run": true }),
    )
    const { url } = expectSuccess(preview).json<DryRunOutput>()
    expect(new URL(url).searchParams.get("startedAfter")).toBe("2020-01-01T00:00:00.000+0000")
  })

  it("normalizes the task date filters the spec does not mark as date-time", async () => {
    const processInstanceId = await startOrder("TASK-DATES")
    const recent = await cli(
      argv("task list", [], { processInstanceId, createdAfter: "2020-01-01" }),
    )
    expect(expectSuccess(recent).json<Task[]>()).toEqual([
      expect.objectContaining({ name: USER_TASK_NAME }),
    ])
    const future = await cli(
      argv("task list", [], { processInstanceId, createdAfter: "2999-01-01" }),
    )
    expect(expectSuccess(future).json<Task[]>()).toEqual([])
    const count = await cli(
      argv("task count", [], { processInstanceId, createdAfter: "2020-01-01T00:00Z" }),
    )
    expect(expectSuccess(count).json<Count>()).toEqual({ count: 1 })
  })

  it("sets and reads a string variable", async () => {
    const instanceId = await startOrder("VARIABLES")
    const set = await cli(
      argv("process-instance set-variable", [instanceId, "note"], { value: "hello" }),
    )
    expect(expectSuccess(set).stdout).toBe("")
    const get = await cli(argv("process-instance get-variable", [instanceId, "note"]))
    expect(expectSuccess(get).json<TypedValue>()).toMatchObject({
      type: "String",
      value: "hello",
    })
  })

  it("uploads and downloads a binary variable", async () => {
    const instanceId = await startOrder("BINARY")
    const content = await readFile(FIXTURES.attachment)
    const upload = await cli(
      argv("process-instance set-variable-binary", [instanceId, "file"], {
        data: FIXTURES.attachment,
        valueType: "Bytes",
      }),
    )
    expect(expectSuccess(upload).stdout).toBe("")

    const outFile = join(scenario.workdir(), "downloaded.txt")
    const download = await cli(
      argv("process-instance get-variable-binary", [instanceId, "file"], { "out-file": outFile }),
    )
    expect(expectSuccess(download).json<OutFileSummary>()).toMatchObject({
      outFile,
      bytes: content.length,
      contentType: expect.stringContaining("application/octet-stream"),
    })
    expect(await readFile(outFile)).toEqual(content)

    const raw = await cli(argv("process-instance get-variable-binary", [instanceId, "file"]))
    expect(Buffer.from(expectSuccess(raw).stdoutBytes)).toEqual(content)
  })

  it("keeps Long variables beyond 2^53 exactly in both directions", async () => {
    const instanceId = await startOrder("LONG")
    const set = await cli(
      argv("process-instance set-variable", [instanceId, "big"], {
        value: "9223372036854775807",
        type: "Long",
      }),
    )
    expectSuccess(set)
    const get = await cli(argv("process-instance get-variable", [instanceId, "big"]))
    expect(expectSuccess(get).stdout).toMatch(/"value":9223372036854775807[,}]/)
    const viaVar = await cli(
      argv("process-definition start", [PROCESS_KEY], {
        businessKey: "LONG-VAR",
        variables: ["big=9007199254740993"],
      }),
    )
    const started = expectSuccess(viaVar).json<ProcessInstance>().id
    const stored = await cli(argv("process-instance get-variable", [started, "big"]))
    expect(expectSuccess(stored).stdout).toMatch(/"type":"Long"/)
    expect(stored.stdout).toMatch(/"value":9007199254740993[,}]/)
  })

  it("passes --version to the operation instead of printing the CLI version", async () => {
    const result = await cli(argv("process-definition list", [], { key: PROCESS_KEY, version: 1 }))
    expect(expectSuccess(result).json<ProcessDefinition[]>()).toEqual([
      expect.objectContaining({ key: PROCESS_KEY, version: 1 }),
    ])
    const none = await cli(argv("process-definition list", [], { key: PROCESS_KEY, version: 99 }))
    expect(expectSuccess(none).json<ProcessDefinition[]>()).toEqual([])
  })

  it("normalizes raw paths before the guards and the request", async () => {
    const count = await cli(["api", "GET", "/x/../process-definition/./count/"])
    expect(expectSuccess(count).json<Count>()).toEqual({ count: expect.any(Number) })

    const before = await countInstances({ processDefinitionKey: PROCESS_KEY })
    const refused = await cli([
      "api",
      "POST",
      "/process-instance/./delete",
      "--body",
      JSON.stringify({
        processInstanceQuery: { processDefinitionKey: PROCESS_KEY },
        deleteReason: "must not happen",
      }),
    ])
    expectError(refused, "CONFIRMATION_REQUIRED", 2)
    expect(await countInstances({ processDefinitionKey: PROCESS_KEY })).toBe(before)
  })

  it("explains rejected requests with the engine message, also for plain text bodies", async () => {
    const body = await cli([
      "api",
      "POST",
      `/process-definition/key/${PROCESS_KEY}/start`,
      "--body",
      '{"businessKey":["not","a","string"]}',
    ])
    const error = expectError(body, "HTTP_CLIENT_ERROR", 6)
    expect(error.status).toBe(400)
    // depending on which JAX-RS exception mapper wins at start-up, the engine answers with
    // Jackson's explanation as text/plain or with an ExceptionDto without message
    if (error.engineType === undefined) {
      expect(error.engineMessage).toMatch(/deserializ/i)
      expect(error.message).toContain(error.engineMessage)
    }

    const query = await cli(["api", "GET", "/process-instance", "--query", "maxResults=abc"])
    const queryError = expectError(query, "HTTP_CLIENT_ERROR", 6)
    expect(queryError.hint).toContain("A query parameter has a value the engine cannot read")

    const range = await cli(
      argv("historic-process-instance list", [], { maxResults: "2147483648" }),
    )
    expect(expectError(range, "USAGE", 2).message).toBe(
      '--max-results expects an integer between -2147483648 and 2147483647, got "2147483648"',
    )
  })

  it("warns about --fields that match nothing", async () => {
    const result = await cli([
      ...argv("process-definition list", [], { key: PROCESS_KEY }),
      globalFlag("fields"),
      "id,nme",
    ])
    expect(expectSuccess(result).stderr).toMatch(
      /^Warning: field "nme" not found in the response \(fields: id, key, /,
    )
  })

  it("uses a profile written by config set", async () => {
    const set = await cli(["config", "set", "it", globalFlag("url"), engineUrl()])
    expectSuccess(set)
    const stored = JSON.parse(await readFile(scenario.configFile(), "utf8")) as {
      profiles: Record<string, { url?: string }>
    }
    expect(stored.profiles.it?.url).toBe(engineUrl())

    const ping = await cli(["ping", globalFlag("profile"), "it"], {
      env: { OPERATE_URL: undefined },
    })
    expect(expectSuccess(ping).json<PingOutput>()).toMatchObject({
      url: engineUrl(),
      reachable: true,
    })
  })
}
