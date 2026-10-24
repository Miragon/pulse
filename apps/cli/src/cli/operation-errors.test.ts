/** Operation commands through `run()`: `--verbose`, the errors, and their summaries and descriptions. */

import { describe, expect, it } from "vitest"
import { errorOf } from "../../test/support/cli-operation.js"
import {
  BASE_URL,
  connectionRefused,
  engineError,
  fakeServer,
  type FakeServer,
  json,
} from "../../test/support/fake-fetch.js"
import { execute, fakeRuntime, type FakeRuntimeOptions } from "../../test/support/fake-runtime.js"
import { findOperation, loadCatalog } from "../catalog/catalog.js"
import { operationDescription, operationSummary } from "./operation.js"
import { run } from "./run.js"

function cli(server: FakeServer, args: readonly string[], options: FakeRuntimeOptions = {}) {
  return execute(run, args, fakeRuntime({ fetch: server.fetch, ...options }))
}

describe("operation commands: --verbose", () => {
  it("traces request and response on stderr with masked secrets", async () => {
    let clock = 1000
    const server = fakeServer().on("GET", "/task", json([]))
    const result = await cli(
      server,
      ["task", "list", "--verbose", "-H", "Authorization: Bearer abc"],
      {
        now: () => (clock += 25),
      },
    )
    expect(result.stdout).toBe("[]\n")
    expect(result.stderr).toBe(
      [
        `> GET ${BASE_URL}/task`,
        "> Accept: application/json",
        "> Authorization: Bearer ***",
        "< 200 OK (25 ms, 2 bytes)",
        "",
      ].join("\n"),
    )
    const shown = await cli(server, [
      "task",
      "list",
      "--verbose",
      "--show-secrets",
      "-H",
      "Authorization: Bearer abc",
    ])
    expect(shown.stderr).toContain("> Authorization: Bearer abc\n")
  })
})

describe("operation commands: errors", () => {
  it("maps HTTP 404 to exit code 5 with the engine error as JSON", async () => {
    const server = fakeServer().on(
      "GET",
      "/process-instance/nope",
      engineError(404, "InvalidRequestException", "Process instance with id nope does not exist"),
    )
    const result = await cli(server, ["process-instance", "get", "nope"])
    expect(result.code).toBe(5)
    expect(result.stdout).toBe("")
    expect(errorOf(result.stderr)).toEqual({
      code: "NOT_FOUND",
      exitCode: 5,
      message: "HTTP 404 Not Found: Process instance with id nope does not exist",
      status: 404,
      engineType: "InvalidRequestException",
      engineMessage: "Process instance with id nope does not exist",
      hint: "Check the id or key. List the existing ones with `operate process-instance list`.",
      request: { method: "GET", url: `${BASE_URL}/process-instance/nope` },
    })
  })

  it("names the describe command in the hint of a rejected request", async () => {
    const server = fakeServer().on(
      "POST",
      "/process-definition/key/invoice/start",
      engineError(400, "InvalidRequestException", "Unsupported value type 'Integr'"),
    )
    const result = await cli(server, ["process-definition", "start", "invoice", "--var", "a=1"])
    expect(result.code).toBe(6)
    expect(errorOf(result.stderr)).toMatchObject({
      code: "HTTP_CLIENT_ERROR",
      message: "HTTP 400 Bad Request: Unsupported value type 'Integr'",
      hint: "The engine rejected the request. Check parameters and body with `operate describe process-definition start`.",
    })
  })

  it("names the command in the hints of every page request of --all", async () => {
    const server = fakeServer().on(
      "GET",
      "/process-instance",
      engineError(400, "InvalidRequestException", "bad"),
    )
    const result = await cli(server, ["process-instance", "list", "--all"])
    expect(errorOf(result.stderr)).toMatchObject({
      hint: "The engine rejected the request. Check parameters and body with `operate describe process-instance list`.",
    })
  })

  it("maps network errors to exit code 8", async () => {
    const server = fakeServer().on("GET", "/task", () => {
      throw connectionRefused()
    })
    const result = await cli(server, ["task", "list"])
    expect(result.code).toBe(8)
    expect(errorOf(result.stderr)).toMatchObject({
      code: "NETWORK",
      exitCode: 8,
      message: `Cannot reach ${BASE_URL}/task (ECONNREFUSED)`,
    })
  })

  it("renders config errors in the format given on the command line", async () => {
    const result = await cli(fakeServer(), ["task", "list", "--timeout", "soon", "-o", "table"])
    expect(result.code).toBe(3)
    expect(result.stderr).toMatch(/^Error: Timeout must be a positive number of milliseconds/)
  })

  it("renders later errors in the resolved format", async () => {
    const server = fakeServer().on(
      "GET",
      "/task",
      engineError(500, "ProcessEngineException", "boom"),
    )
    const result = await cli(server, ["task", "list"], { env: { OPERATE_OUTPUT: "table" } })
    expect(result.code).toBe(7)
    expect(result.stderr).toMatch(
      /^Error: HTTP 500 Internal Server Error: boom\n {2}Engine: ProcessEngineException\n/,
    )
  })
})

describe("operationSummary and operationDescription", () => {
  const catalog = loadCatalog()
  const operation = findOperation(catalog, "process-instance", "delete")!

  it("describes summary, method and path, effect and aliases", () => {
    expect(operationDescription(operation)).toBe(
      [
        operation.summary,
        "",
        "DELETE /process-instance/{id}",
        "Effect: delete (requires --yes)",
        "Aliases: delete-process-instance",
      ].join("\n"),
    )
    const claim = findOperation(catalog, "task", "claim")!
    expect(operationDescription(claim)).toBe(
      "Claim a task for a user\n\nPOST /task/{id}/claim\nEffect: write",
    )
  })

  it("marks deprecated operations and falls back to method and path", () => {
    expect(operationSummary({ ...operation, deprecated: true })).toBe(
      `[deprecated] ${operation.summary}`,
    )
    expect(operationSummary({ ...operation, summary: "" })).toBe("DELETE /process-instance/{id}")
    expect(operationDescription({ ...operation, effect: "bulk", aliases: [] })).toMatch(
      /\nEffect: bulk \(requires --yes\)$/,
    )
    expect(operationDescription({ ...operation, effect: "read", aliases: [] })).toMatch(
      /Effect: read$/,
    )
  })
})
