/**
 * The scenario's guards and request options: deletes, --read-only, the error codes, --dry-run,
 * --all, tables, raw requests and the request body validation.
 */

import { expect, it } from "vitest"
import { argv, globalFlag } from "../support/catalog.js"
import { expectError, expectExit, expectSuccess } from "../support/expect.js"
import { PROCESS_KEY } from "../support/fixtures.js"
import type { Count, DryRunOutput, ProcessDefinition, ProcessInstance } from "../support/types.js"
import type { Scenario } from "./suite.js"

const UNREACHABLE_URL = "http://127.0.0.1:1/engine-rest"

export function registerRequests(scenario: Scenario): void {
  const { cli, engineUrl, startOrder, countInstances } = scenario

  it("deletes only with --yes", async () => {
    const instanceId = await startOrder("DELETE-ME")

    const refused = await cli(argv("process-instance delete", [instanceId]))
    const error = expectError(refused, "CONFIRMATION_REQUIRED", 2)
    expect(error.hint).toContain("--yes")
    expect(refused.stdout).toBe("")
    expectSuccess(await cli(argv("process-instance get", [instanceId])))

    const deleted = await cli(argv("process-instance delete", [instanceId], { yes: true }))
    expect(expectSuccess(deleted).stdout).toBe("")
    expectExit(await cli(argv("process-instance get", [instanceId])), 5)
  })

  it("refuses writes but allows reads with --read-only", async () => {
    const refused = await cli(
      argv("process-definition start", [PROCESS_KEY], {
        businessKey: "READ-ONLY",
        "read-only": true,
      }),
    )
    expectError(refused, "READ_ONLY", 2)
    expect(await countInstances({ businessKey: "READ-ONLY" })).toBe(0)

    const read = await cli(
      argv("process-definition list", [], { key: PROCESS_KEY, "read-only": true }),
    )
    expect(expectSuccess(read).json<ProcessDefinition[]>()).toHaveLength(1)
  })

  it("maps a missing resource to NOT_FOUND with exit code 5", async () => {
    const result = await cli(argv("process-instance get", ["does-not-exist"]))
    const error = expectError(result, "NOT_FOUND", 5)
    expect(error).toMatchObject({ status: 404, engineType: "InvalidRequestException" })
    expect(error.message).toMatch(/^HTTP 404 Not Found: .*does-not-exist/)
    expect(error.hint).toContain("`operate process-instance list`")
    expect(result.stdout).toBe("")
  })

  it("reports a process engine name the REST API does not serve", async () => {
    const ping = await cli(["ping", globalFlag("engine"), "no-such-engine"])
    const pingError = expectError(ping, "CONFIG", 3)
    expect(pingError.message).toBe('Process engine "no-such-engine" does not exist')
    expect(pingError.hint).toContain("The REST API serves: default.")
    expect(ping.stdout).toBe("")

    const list = await cli([...argv("task list"), globalFlag("engine"), "no-such-engine"])
    // Camunda 7 and Operaton answer 400, CIB seven 404 (with a different message)
    const [code, exitCode] = list.code === 5 ? ["NOT_FOUND", 5] : ["HTTP_CLIENT_ERROR", 6]
    const listError = expectError(list, code, exitCode)
    expect(listError.request?.url).toBe(`${engineUrl()}/engine/no-such-engine/task`)
    expect(listError.hint).toContain("Run `operate ping` to list the engines")
  })

  it("maps an unreachable engine to NETWORK with exit code 8", async () => {
    const result = await cli(["ping", globalFlag("url"), UNREACHABLE_URL])
    expectError(result, "NETWORK", 8)
    expect(result.stdout).toBe("")
  })

  it("previews a request with --dry-run without sending it", async () => {
    const result = await cli(
      argv("process-definition start", [PROCESS_KEY], {
        businessKey: "DRY-RUN",
        variables: ["amount=1"],
        "dry-run": true,
      }),
    )
    const preview = expectSuccess(result).json<DryRunOutput>()
    expect(preview).toMatchObject({
      method: "POST",
      url: `${engineUrl()}/process-definition/key/${PROCESS_KEY}/start`,
      body: { businessKey: "DRY-RUN", variables: { amount: { value: 1, type: "Integer" } } },
    })
    expect(preview.curl).toMatch(/^curl /)
    expect(preview.curl).toContain(`/process-definition/key/${PROCESS_KEY}/start`)
    expect(await countInstances({ businessKey: "DRY-RUN" })).toBe(0)
  })

  it("fetches every page with --all", async () => {
    for (const businessKey of ["PAGE-1", "PAGE-2", "PAGE-3"]) await startOrder(businessKey)
    const filter = { processDefinitionKey: PROCESS_KEY }
    const total = await countInstances(filter)
    expect(total).toBeGreaterThanOrEqual(3)

    const firstPage = await cli(argv("process-instance list", [], { ...filter, maxResults: 1 }))
    expect(expectSuccess(firstPage).json<ProcessInstance[]>()).toHaveLength(1)

    const all = await cli(
      argv("process-instance list", [], { ...filter, maxResults: 1, all: true }),
    )
    const instances = expectSuccess(all).json<ProcessInstance[]>()
    expect(instances).toHaveLength(total)
    expect(new Set(instances.map((instance) => instance.id)).size).toBe(total)
  })

  it("renders a table with -o table", async () => {
    const result = await cli([
      ...argv("process-definition list", [], { key: PROCESS_KEY }),
      "-o",
      "table",
    ])
    const [header = "", ...rows] = expectSuccess(result).stdout.trimEnd().split("\n")
    expect(header).toMatch(/\bid\b/i)
    expect(header).toMatch(/\bkey\b/i)
    expect(rows.some((row) => row.includes(PROCESS_KEY))).toBe(true)
    expect(result.stdout.trimStart()).not.toMatch(/^[[{]/)
  })

  it("sends raw requests with operate api", async () => {
    const result = expectSuccess(await cli(["api", "GET", "/process-definition/count"]))
    const generated = expectSuccess(await cli(argv("process-definition count")))
    expect(result.json<Count>()).toEqual({ count: expect.any(Number) })
    expect(result.json<Count>()).toEqual(generated.json<Count>())
  })

  it("rejects an invalid request body before sending it", async () => {
    const result = await cli(
      argv("process-definition start", [PROCESS_KEY], { body: '{"businesKey":"x"}' }),
    )
    const error = expectError(result, "VALIDATION", 2)
    expect(error.message).toContain("businessKey")
    expect(await countInstances({ businessKey: "x" })).toBe(0)
  })
}
