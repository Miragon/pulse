import http from "node:http"
import type { AddressInfo } from "node:net"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { MCPServer } from "mcp-use"
import { analyticsModule } from "./module.js"
import { ANALYTICS_ENGINE_LANDSCAPE_DATA } from "./tool-names.js"

/**
 * #325 through the module. A real local HTTP server plays Prometheus, so auth headers, deadline and
 * cancellation are observed on the wire.
 */

type ToolCallback = (
  args: Record<string, unknown>,
  ctx?: unknown,
) => Promise<{ isError?: boolean; content: Array<{ type: string; text: string }> }>

const seenAuth: Array<string | undefined> = []
const seenTenant: Array<string | string[] | undefined> = []
let hang = false

const prometheus = http.createServer((req, res) => {
  seenAuth.push(req.headers.authorization)
  seenTenant.push(req.headers["x-scope-orgid"])
  if (hang) return
  res.writeHead(200, { "Content-Type": "application/json" })
  res.end(JSON.stringify({ status: "success", data: { resultType: "vector", result: [] } }))
})

let url = ""

beforeAll(async () => {
  await new Promise<void>((resolve) => prometheus.listen(0, "127.0.0.1", resolve))
  url = `http://127.0.0.1:${(prometheus.address() as AddressInfo).port}`
})

afterAll(async () => {
  prometheus.closeAllConnections()
  await new Promise<void>((resolve) => prometheus.close(() => resolve()))
})

/** A standalone analytics boot names the engines it may read (`engine-ids.ts`). */
const ENGINES = { ANALYTICS_ENGINE_IDS: "prod-a,prod-b" }

/** Boots the module from env the way the composition root does; returns its tools. */
function boot(env: NodeJS.ProcessEnv) {
  const tools = new Map<string, ToolCallback>()
  const server = {
    tool: (definition: { name: string }, callback: ToolCallback) => {
      tools.set(definition.name, callback)
    },
    use: () => {},
  } as unknown as MCPServer
  const plugin = analyticsModule.createPlugin(
    {
      ...analyticsModule.configFromEnv({ PROMETHEUS_URL: url, ...ENGINES, ...env }),
      toolset: "read-only",
    },
    {},
  )
  plugin.registerTools?.(server)
  plugin.registerWidgetTools?.(server)
  return tools
}

describe("Prometheus config reaches the wire", () => {
  it("PROMETHEUS_BEARER_TOKEN authenticates every query of a registrar tool", async () => {
    hang = false
    seenAuth.length = 0
    const tools = boot({ PROMETHEUS_BEARER_TOKEN: "tok-123" })
    const result = await tools.get("analytics_engine_landscape")!({})
    expect(result.isError).toBeFalsy()
    expect(seenAuth.length).toBeGreaterThan(0)
    expect(seenAuth.every((auth) => auth === "Bearer tok-123")).toBe(true)
  })

  it("PROMETHEUS_HEADERS and PROMETHEUS_USERNAME/PROMETHEUS_PASSWORD reach every query", async () => {
    hang = false
    seenAuth.length = 0
    seenTenant.length = 0
    const tools = boot({
      PROMETHEUS_HEADERS: '{"X-Scope-OrgID":"tenant-a"}',
      PROMETHEUS_USERNAME: "grafana",
      PROMETHEUS_PASSWORD: "hunter2-pass",
    })
    const result = await tools.get("analytics_engine_landscape")!({})
    expect(result.isError).toBeFalsy()
    expect(seenTenant.length).toBeGreaterThan(0)
    expect(seenTenant.every((tenant) => tenant === "tenant-a")).toBe(true)
    const basic = `Basic ${Buffer.from("grafana:hunter2-pass").toString("base64")}`
    expect(seenAuth.every((auth) => auth === basic)).toBe(true)
  })

  it("PROMETHEUS_TIMEOUT_MS bounds a hung Prometheus", async () => {
    hang = true
    const tools = boot({ PROMETHEUS_TIMEOUT_MS: "60" })
    const result = await tools.get("analytics_engine_landscape")!({})
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe("Prometheus did not respond within 60 ms (timeout)")
  })

  it("EVERY widget tool and feed hands ctx.signal to its queries", async () => {
    hang = false
    const tools = new Map<string, ToolCallback>()
    const server = {
      tool: (definition: { name: string }, callback: ToolCallback) => {
        tools.set(definition.name, callback)
      },
    } as unknown as MCPServer
    analyticsModule
      .createPlugin(
        {
          ...analyticsModule.configFromEnv({ PROMETHEUS_URL: url, ...ENGINES }),
          toolset: "read-only",
        },
        {},
      )
      .registerWidgetTools?.(server)
    // Unsignalled a handler must reach Prometheus, with an already-aborted ctx.signal it must not:
    // a handler that drops ctx would still query.
    const args = {
      processDefinitionKey: "order",
      // Handlers called directly get no schema defaults: the compare windows.
      windowDays: 7,
      windowBeforeDays: 3,
      windowAfterDays: 3,
      // Relative to now: compare windows are held inside the retention.
      deploymentTimestamp: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      engineA: "prod-a",
      engineB: "prod-b",
    }
    const queriesOf = async (name: string, ctx: { signal?: AbortSignal }) => {
      const before = seenAuth.length
      await tools.get(name)!(args, ctx)
      return seenAuth.length - before
    }
    const neverQuery: string[] = []
    for (const name of tools.keys()) {
      if ((await queriesOf(name, {})) === 0) {
        neverQuery.push(name)
        continue
      }
      expect({ name, queries: await queriesOf(name, { signal: AbortSignal.abort() }) }).toEqual({
        name,
        queries: 0,
      })
    }
    // The settings and the heatmap's diagram (read from the engine) never ask Prometheus.
    expect(neverQuery.sort()).toEqual([
      "analytics_bpmn_xml_data",
      "analytics_settings_data",
      "analytics_show_settings",
    ])
    expect(tools.size - neverQuery.length).toBeGreaterThanOrEqual(11)
  })

  it("a widget feed's ctx.signal cancels its queries before the deadline", async () => {
    hang = true
    const tools = boot({ PROMETHEUS_TIMEOUT_MS: "10000" })
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 30)
    const started = Date.now()
    const result = await tools.get(ANALYTICS_ENGINE_LANDSCAPE_DATA)!(
      {},
      { signal: controller.signal },
    )
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe("Prometheus query cancelled by the caller")
  })
})
