import { describe, expect, it } from "vitest"
import {
  BASE_URL,
  connectionRefused,
  fakeServer,
  json,
  text,
} from "../../../test/support/fake-fetch.js"
import {
  execute,
  fakeRuntime,
  type FakeRuntimeOptions,
} from "../../../test/support/fake-runtime.js"
import { loadCatalog } from "../../catalog/catalog.js"
import { camunda7 } from "../../engines/camunda7/adapter.js"
import { OperateError } from "../../errors.js"
import type { OperationResult } from "../../operation/result.js"
import { createProgram } from "../program.js"
import { run } from "../run.js"
import { checkEngine, engineNames, versionOf } from "./ping.js"

const REQUEST = { method: "GET", url: "http://h/version", headers: {} }

function server() {
  return fakeServer()
    .on("GET", "/version", json({ version: "7.24.0" }))
    .on("GET", "/engine", json([{ name: "default" }, { name: "second" }]))
}

function cli(args: readonly string[], options: FakeRuntimeOptions = {}) {
  const fake = server()
  let clock = 0
  const now = () => (clock += 7)
  return execute(run, args, fakeRuntime({ fetch: fake.fetch, now, ...options })).then(
    (outcome) => ({ ...outcome, requests: fake.requests }),
  )
}

describe("pulse-cli ping", () => {
  it("prints url, engine, version, engine names, latency and auth", async () => {
    const result = await cli(["ping"])
    expect(result).toMatchObject({ code: 0, stderr: "" })
    expect(result.stdout).toBe(
      `${JSON.stringify({
        url: BASE_URL,
        engine: null,
        reachable: true,
        version: "7.24.0",
        engines: ["default", "second"],
        latencyMs: 14,
        auth: "none",
      })}\n`,
    )
    expect(result.requests.map((request) => request.url)).toEqual([
      `${BASE_URL}/version`,
      `${BASE_URL}/engine`,
    ])
  })

  it("reports the configured engine without prefixing the engine independent paths", async () => {
    const result = await cli(["ping", "--engine", "second", "--fields", "engine,engines"])
    expect(result.stdout).toBe('{"engine":"second","engines":["default","second"]}\n')
    expect(result.requests.map((request) => request.path)).toEqual(["/version", "/engine"])
  })

  it("fails with a config error when the REST API does not serve the configured engine", async () => {
    const result = await cli(["ping", "--engine", "third"])
    expect(result.code).toBe(3)
    expect(result.stdout).toBe("")
    expect(JSON.parse(result.stderr)).toEqual({
      error: {
        code: "CONFIG",
        exitCode: 3,
        message: 'Process engine "third" does not exist',
        hint: "The REST API serves: default, second. Pass one of them with --engine (or PULSE_CLI_ENGINE, or the profile setting engine), or leave it unset for the default engine.",
      },
    })
  })

  it("prints a table on a terminal", async () => {
    const result = await cli(["ping", "--fields", "url,version"], { stdoutTTY: true })
    expect(result.stdout).toBe(`FIELD    VALUE\nurl      ${BASE_URL}\nversion  7.24.0\n`)
  })

  it("shows the first request with --dry-run", async () => {
    const result = await cli(["ping", "--dry-run"])
    expect(result.requests).toEqual([])
    expect(JSON.parse(result.stdout)).toMatchObject({ method: "GET", url: `${BASE_URL}/version` })
  })

  it("reports an unreachable engine as network error", async () => {
    const failing = fakeServer().on("GET", "/version", () => {
      throw connectionRefused()
    })
    const result = await execute(run, ["ping"], fakeRuntime({ fetch: failing.fetch }))
    expect(result.code).toBe(8)
    expect(result.stdout).toBe("")
    expect(JSON.parse(result.stderr)).toMatchObject({ error: { code: "NETWORK", exitCode: 8 } })
  })

  it("fails with an internal error when the catalog lacks an operation", async () => {
    const catalog = loadCatalog()
    const operations = catalog.operations.filter((operation) => operation.group !== "version")
    const context = {
      runtime: fakeRuntime(),
      engine: camunda7,
      catalog: { ...catalog, operations },
      state: {},
    }
    const parsing = createProgram(["ping"], context).parseAsync(["ping"], {
      from: "user",
    })
    await expect(parsing).rejects.toThrow(
      new OperateError("INTERNAL", "The catalog has no operation getRestAPIVersion"),
    )
  })

  it("shows its help with the global options", async () => {
    const result = await cli(["ping", "--help"])
    expect(result.stdout).toMatch(/^Usage: pulse-cli ping \[options\]\n\nCheck the connection/)
    expect(result.stdout).toContain("\nGlobal Options:\n  --url <url> ")
  })
})

describe("versionOf and engineNames", () => {
  const result = (value: unknown): OperationResult => ({
    kind: "json",
    status: 200,
    value,
    request: REQUEST,
  })

  it("reads the version of a VersionDto", () => {
    expect(versionOf(result({ version: "1.0" }))).toBe("1.0")
    expect(versionOf(result({ version: 1 }))).toBeNull()
    expect(versionOf(result([]))).toBeNull()
    expect(versionOf({ kind: "none", status: 204, statusText: "", request: REQUEST })).toBeNull()
  })

  it("reads the names of a ProcessEngineDto list", () => {
    expect(engineNames(result([{ name: "a" }, { name: 2 }, "x", { name: "b" }]))).toEqual([
      "a",
      "b",
    ])
    expect(engineNames(result({ name: "a" }))).toEqual([])
  })

  it("accepts any engine when none is set, it is served, or the engine list is unknown", () => {
    expect(() => {
      checkEngine(undefined, ["default"])
    }).not.toThrow()
    expect(() => {
      checkEngine("second", ["default", "second"])
    }).not.toThrow()
    expect(() => {
      checkEngine("third", [])
    }).not.toThrow()
    expect(() => {
      checkEngine("third", ["default"])
    }).toThrow('Process engine "third" does not exist')
  })

  it("copes with a text response", async () => {
    const odd = fakeServer()
      .on("GET", "/version", text("7", "text/plain"))
      .on("GET", "/engine", json([]))
    const outcome = await execute(run, ["ping"], fakeRuntime({ fetch: odd.fetch }))
    expect(JSON.parse(outcome.stdout)).toMatchObject({ version: null, engines: [] })
  })
})
