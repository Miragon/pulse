import http from "node:http"
import type { AddressInfo } from "node:net"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { MCPServer } from "mcp-use"
import { createInMemoryProfileStore } from "@miragon/pulse-widget-shell/server"
import { createEngineRegistry } from "../lib/resolve-engine.js"
import { providerForEntry } from "../providers/index.js"
import { CAMUNDA7_SHOW_SETTINGS } from "../tool-names.js"
import { registerUserProfileTools } from "../tools/user-profile.js"
import { registerWidgetTools } from "../widget-tools.js"

/** #322 U3: a hard-coded English title would sit over a German view; sweeps every show tool. */

type ToolCallback = (args: Record<string, unknown>, ctx?: unknown) => Promise<unknown>
type ViewResult = { structuredContent?: { title?: unknown; layout?: unknown } }

const engine = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" })
  res.end(req.url?.includes("/count") ? '{"count":0}' : "[]")
})

let baseUrl = ""

beforeAll(async () => {
  await new Promise<void>((resolve) => engine.listen(0, "127.0.0.1", resolve))
  baseUrl = `http://127.0.0.1:${(engine.address() as AddressInfo).port}/engine-rest`
})

afterAll(async () => {
  engine.closeAllConnections()
  await new Promise<void>((resolve) => engine.close(() => resolve()))
})

const ARGS = {
  processDefinitionKey: "order",
  processDefinitionId: "order:1:abc",
  processInstanceId: "pi-1",
  incidentId: "inc-1",
  activityId: "task-1",
}

const callerCtx = (id: string) => ({ auth: { user: { id } } })

async function showTools() {
  const tools = new Map<string, ToolCallback>()
  const server = {
    tool: (definition: { name: string; view?: unknown }, callback: ToolCallback) => {
      if (definition.view) tools.set(definition.name, callback)
    },
  } as unknown as MCPServer
  const registry = createEngineRegistry([{ id: "prod-a", baseUrl }], (e) =>
    providerForEntry(e).createClient(e, { type: "none" }, { timeoutMs: 2000 }),
  )
  const profileStore = createInMemoryProfileStore()
  await profileStore.save("de-user", { language: "de" })
  await profileStore.save("en-user", { language: "en" })
  await profileStore.save("system-user", { language: "system" })
  registerWidgetTools(server, registry, { toolset: "read-only", profileStore })
  registerUserProfileTools(server, profileStore, registry, "read-only")
  return tools
}

async function titlesFor(tools: Map<string, ToolCallback>, ctx: unknown) {
  const titles = new Map<string, unknown>()
  for (const [name, call] of tools) {
    const result = (await call(ARGS, ctx)) as ViewResult
    if (result.structuredContent?.layout) titles.set(name, result.structuredContent.title)
  }
  return titles
}

describe("show tools title their view only in a language the profile names", () => {
  it("no title for an anonymous caller or one whose profile follows the host", async () => {
    const tools = await showTools()
    for (const ctx of [undefined, callerCtx("system-user"), callerCtx("nobody-saved-yet")]) {
      const titles = await titlesFor(tools, ctx)
      // Not vacuous.
      expect(titles.size).toBeGreaterThanOrEqual(9)
      expect(titles.has(CAMUNDA7_SHOW_SETTINGS)).toBe(true)
      expect(Object.fromEntries([...titles].filter(([, title]) => title !== undefined))).toEqual({})
    }
  })

  // Some views set no title in any language.
  it("a named language titles the same views, each in that language", async () => {
    const tools = await showTools()
    const de = await titlesFor(tools, callerCtx("de-user"))
    const en = await titlesFor(tools, callerCtx("en-user"))
    const titled = (titles: Map<string, unknown>) =>
      [...titles]
        .filter(([, title]) => title !== undefined)
        .map(([name]) => name)
        .sort()
    expect(titled(de)).toEqual(titled(en))
    expect(titled(de).length).toBeGreaterThanOrEqual(8)
    expect(de.get(CAMUNDA7_SHOW_SETTINGS)).toBe("Engines und Dashboards")
    expect(en.get(CAMUNDA7_SHOW_SETTINGS)).toBe("Engines and dashboards")
  })
})
