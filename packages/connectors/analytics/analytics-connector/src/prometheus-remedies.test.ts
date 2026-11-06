import http from "node:http"
import type { AddressInfo } from "node:net"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { MCPServer } from "mcp-use"
import {
  PrometheusRequestError,
  type PrometheusClient,
  type PrometheusFailureKind,
} from "@miragon/pulse-analytics-client"
import { analyticsModule } from "./module.js"
import { withRemedies } from "./prometheus-remedies.js"

const failingWith = (error: Error): PrometheusClient => ({
  instant: () => Promise.reject(error),
})

async function messageOf(error: Error): Promise<string> {
  const caught = await withRemedies(failingWith(error))
    .instant("up")
    .then(
      () => {
        throw new Error("expected the query to fail")
      },
      (e: unknown) => e as Error,
    )
  return caught.message
}

const failure = (message: string, kind: PrometheusFailureKind) =>
  new PrometheusRequestError(message, kind)

const CHECK_TARGET =
  "Check PROMETHEUS_URL, which decides the target; a server without a Prometheus leaves analytics out of MCP_ACTIVE_MODULES."

describe("withRemedies", () => {
  it("answers a query that works untouched, with the caller's options", async () => {
    const samples = [{ metric: {}, value: 1 }]
    const seen: unknown[] = []
    const signal = AbortSignal.abort()
    const client = withRemedies({
      instant: (query, options) => {
        seen.push(query, options)
        return Promise.resolve(samples)
      },
    })
    expect(await client.instant("up", { signal })).toBe(samples)
    expect(seen).toEqual(["up", { signal }])
  })

  it.each<[PrometheusFailureKind, string, string]>([
    [
      "unreachable",
      "Prometheus unreachable (ECONNREFUSED)",
      `Prometheus unreachable (ECONNREFUSED). ${CHECK_TARGET}`,
    ],
    [
      "foreign-answer",
      "Prometheus query failed (404): 404 page not found",
      `Prometheus query failed (404): 404 page not found. ${CHECK_TARGET}`,
    ],
    [
      "foreign-answer",
      "Prometheus returned a non-JSON response (HTTP 200, text/html): is a proxy in front of it?",
      `Prometheus returned a non-JSON response (HTTP 200, text/html): is a proxy in front of it? ${CHECK_TARGET}`,
    ],
    [
      "foreign-answer",
      "Prometheus query failed (502): bad gateway yyy…",
      `Prometheus query failed (502): bad gateway yyy… ${CHECK_TARGET}`,
    ],
    [
      "timeout",
      "Prometheus did not respond within 60 ms (timeout)",
      "Prometheus did not respond within 60 ms (timeout). PROMETHEUS_TIMEOUT_MS sets this deadline, PROMETHEUS_URL the target.",
    ],
    [
      "unauthorized",
      "Prometheus query failed (401): denied",
      "Prometheus query failed (401): denied. Check the credentials: PROMETHEUS_BEARER_TOKEN, or PROMETHEUS_USERNAME and PROMETHEUS_PASSWORD.",
    ],
  ])("%s: names the setting and the way out", async (kind, message, expected) => {
    expect(await messageOf(failure(message, kind))).toBe(expected)
  })

  it.each<[PrometheusFailureKind, string]>([
    ["query", "Prometheus query failed (400 bad_data): parse error"],
    ["cancelled", "Prometheus query cancelled by the caller"],
  ])("%s: keeps the message as it is, the settings are not the cause", async (kind, message) => {
    expect(await messageOf(failure(message, kind))).toBe(message)
  })

  it("keeps the failure as the cause", async () => {
    const original = failure("Prometheus unreachable (ECONNREFUSED)", "unreachable")
    const caught = await withRemedies(failingWith(original))
      .instant("up")
      .catch((e: unknown) => e as Error)
    expect((caught as Error).cause).toBe(original)
  })

  it("leaves an error that is not the client's alone", async () => {
    const error = new TypeError("boom")
    await expect(withRemedies(failingWith(error)).instant("up")).rejects.toBe(error)
  })

  it("names only variables this module reads, and the boot's module list", async () => {
    const kinds: PrometheusFailureKind[] = [
      "unreachable",
      "foreign-answer",
      "timeout",
      "unauthorized",
    ]
    const texts = await Promise.all(kinds.map((kind) => messageOf(failure("x", kind))))
    const named = texts.join(" ").match(/\b[A-Z]+(?:_[A-Z]+)+\b/g) ?? []
    expect(named.length).toBeGreaterThan(0)
    const known: readonly string[] = [...analyticsModule.knownEnvVars, "MCP_ACTIVE_MODULES"]
    expect(named.filter((name) => !known.includes(name))).toEqual([])
  })
})

type ToolCallback = (
  args: Record<string, unknown>,
  ctx?: unknown,
) => Promise<{ isError?: boolean; content: Array<{ type: string; text: string }> }>

const PASSWORD = "hunter2-pass"

/** Plays what holds the port: another service, or a Prometheus that refuses the query. */
let answer: { status: number; type: string; body: string }

const service = http.createServer((_req, res) => {
  res.writeHead(answer.status, { "Content-Type": answer.type })
  res.end(answer.body)
})

let serviceUrl = ""
let closedUrl = ""

beforeAll(async () => {
  await new Promise<void>((resolve) => service.listen(0, "127.0.0.1", resolve))
  serviceUrl = `http://127.0.0.1:${(service.address() as AddressInfo).port}`
  const probe = http.createServer()
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve))
  closedUrl = `http://127.0.0.1:${(probe.address() as AddressInfo).port}`
  await new Promise<void>((resolve) => probe.close(() => resolve()))
})

afterAll(async () => {
  service.closeAllConnections()
  await new Promise<void>((resolve) => service.close(() => resolve()))
})

/** The tool's error text, booted from env the way the composition root does. */
async function toolError(prometheusUrl: string): Promise<string> {
  const tools = new Map<string, ToolCallback>()
  const server = {
    tool: (definition: { name: string }, callback: ToolCallback) => {
      tools.set(definition.name, callback)
    },
  } as unknown as MCPServer
  const plugin = analyticsModule.createPlugin(
    analyticsModule.configFromEnv({
      PROMETHEUS_URL: prometheusUrl,
      ANALYTICS_ENGINE_IDS: "prod-a",
    }),
    {},
  )
  plugin.register(server)
  const result = await tools.get("analytics_engine_health")!({})
  expect(result.isError).toBe(true)
  return result.content[0].text
}

describe("an analytics tool error, through the module", () => {
  const credentialed = (url: string) => url.replace("http://", `http://grafana:${PASSWORD}@`)

  it("nobody listening: names the variable and the way out, never its value", async () => {
    const text = await toolError(credentialed(closedUrl))
    expect(text).toBe(`Prometheus unreachable (ECONNREFUSED). ${CHECK_TARGET}`)
    expect(text).not.toContain(PASSWORD)
    expect(text).not.toContain("grafana")
    expect(text).not.toContain(new URL(closedUrl).port)
  })

  it("another service holds the port: no HTML, the variable and the way out", async () => {
    answer = {
      status: 404,
      type: "text/html",
      body: "<html><body><h1>Resource not found</h1></body></html>",
    }
    const text = await toolError(credentialed(serviceUrl))
    expect(text).toBe(
      `Prometheus query failed (404): the answer is a web page, so another service or a proxy holds that address. ${CHECK_TARGET}`,
    )
    expect(text).not.toContain("<")
    expect(text).not.toContain("Resource not found")
    expect(text).not.toContain(PASSWORD)
  })

  it("Prometheus answers as itself: its own message, no remedy", async () => {
    answer = {
      status: 422,
      type: "application/json",
      body: JSON.stringify({ status: "error", errorType: "execution", error: "too many samples" }),
    }
    expect(await toolError(serviceUrl)).toBe(
      "Prometheus query failed (422 execution): too many samples",
    )
  })
})
