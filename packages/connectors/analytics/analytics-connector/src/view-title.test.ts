import { describe, expect, it } from "vitest"
import type { MCPServer } from "mcp-use"
import type { PrometheusClient } from "@miragon/pulse-analytics-client"
import { createInMemoryProfileStore } from "@miragon/pulse-widget-shell/server"
import { createEngineScope } from "./engine-ids.js"
import { registerSettingsTools } from "./settings-tools.js"
import { registerWidgetTools } from "./widget-tools.js"

/**
 * #322 U3: the server titles a view only in a language the caller's profile names. "system" follows
 * the host's locale, which the server never sees, so the widget's own heading names the view.
 * A new show tool that titles with `t(…)` instead of `title(…)` fails here.
 */

type ToolCallback = (args: Record<string, unknown>, ctx?: unknown) => Promise<unknown>
type ViewResult = {
  isError?: boolean
  content?: unknown
  structuredContent?: { title?: unknown; layout?: unknown }
}

/** Prometheus without samples: every view renders its empty state. */
const prometheus: PrometheusClient = { instant: () => Promise.resolve([]) }

/** The required arguments per show tool; the tool's own input schema fills in its defaults. */
const ARGS: Record<string, Record<string, unknown>> = {
  analytics_show_bpmn_heatmap: { processDefinitionKey: "order" },
  // Inside Prometheus' retention, with a post-deployment window to measure.
  analytics_show_cluster_compare: {
    deploymentTimestamp: new Date(Date.now() - 10 * 86_400_000).toISOString(),
  },
  analytics_show_version_compare: { processDefinitionKey: "order", versionA: 1, versionB: 2 },
  analytics_show_engine_compare: {
    processDefinitionKey: "order",
    engineA: "prod-a",
    engineB: "prod-b",
  },
}

const callerCtx = (id: string) => ({ auth: { user: { id } } })

interface ToolDefinition {
  name: string
  view?: unknown
  inputSchema: { parse: (args: unknown) => Record<string, unknown> }
}

/** The show tools, each called the way the server does: arguments parsed by its input schema. */
async function showTools() {
  const tools = new Map<string, ToolCallback>()
  const server = {
    tool: (definition: ToolDefinition, callback: ToolCallback) => {
      if (definition.view) {
        tools.set(definition.name, (args, ctx) => callback(definition.inputSchema.parse(args), ctx))
      }
    },
  } as unknown as MCPServer
  const profileStore = createInMemoryProfileStore()
  await profileStore.save("de-user", { language: "de" })
  await profileStore.save("en-user", { language: "en" })
  await profileStore.save("system-user", { language: "system" })
  registerWidgetTools(server, prometheus, {
    engineScope: createEngineScope(["prod-a", "prod-b"]),
    profileStore,
  })
  registerSettingsTools(server, profileStore, "standard")
  return tools
}

/** Each show tool's view title for one caller; every show tool must render its view. */
async function titlesFor(tools: Map<string, ToolCallback>, ctx: unknown) {
  const titles = new Map<string, unknown>()
  for (const [name, call] of tools) {
    const result = (await call(ARGS[name] ?? {}, ctx)) as ViewResult
    expect(result.isError, `${name}: ${JSON.stringify(result.content)}`).not.toBe(true)
    expect(result.structuredContent?.layout, name).toBeTruthy()
    titles.set(name, result.structuredContent?.title)
  }
  return titles
}

describe("analytics show tools title their view only in a language the profile names", () => {
  it("covers every analytics show tool (the sweep is not vacuous)", async () => {
    expect([...(await showTools()).keys()].sort()).toEqual([
      "analytics_show_bpmn_heatmap",
      "analytics_show_cluster_compare",
      "analytics_show_dashboard",
      "analytics_show_engine_compare",
      "analytics_show_engine_landscape",
      "analytics_show_failure_dashboard",
      "analytics_show_settings",
      "analytics_show_version_compare",
    ])
  })

  it("no title for an anonymous caller or one whose profile follows the host", async () => {
    const tools = await showTools()
    // `{}`: a handler ctx without a caller identity (no OAuth).
    for (const ctx of [{}, callerCtx("system-user"), callerCtx("nobody-saved-yet")]) {
      const titles = await titlesFor(tools, ctx)
      expect(Object.fromEntries([...titles].filter(([, title]) => title !== undefined))).toEqual({})
    }
  })

  it("a named language titles every view, each in that language", async () => {
    const tools = await showTools()
    const de = await titlesFor(tools, callerCtx("de-user"))
    const en = await titlesFor(tools, callerCtx("en-user"))
    for (const [name] of tools) {
      expect(de.get(name), name).toEqual(expect.any(String))
      expect(en.get(name), name).toEqual(expect.any(String))
      expect(de.get(name), name).not.toBe(en.get(name))
    }
    expect(de.get("analytics_show_settings")).toBe("Analyse-Einstellungen")
    expect(en.get("analytics_show_settings")).toBe("Analytics settings")
    expect(de.get("analytics_show_dashboard")).toBe("Prozessanalyse")
    expect(en.get("analytics_show_dashboard")).toBe("Process analytics")
  })
})
