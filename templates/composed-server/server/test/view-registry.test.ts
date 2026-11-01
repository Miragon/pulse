import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"
import { settingsSections } from "@miragon/pulse-widget-shell/widgets"
import type { RunningServer } from "@miragon/pulse-widget-shell/server"
import { CAMUNDA7_HOST_WIDGET_REFS } from "@miragon/pulse-camunda7-connector/widgets"
import { createApp } from "../src/app.js"
import { hostWidgets, viewRegistry } from "../src/ui/view-registry.js"
import { stubNeutralEnv } from "./neutral-env.js"

const FIXTURE_JS = path.join(import.meta.dirname, "fixtures", "mcp-app.js")

type ToolEntry = { name: string; _meta?: { ui?: { resourceUri?: unknown } } }

/**
 * The bundle picks a view by its name (= the show tool's name). Both halves
 * fail SILENTLY: a view-bound tool without a view renders the "can't show this
 * view" state, and a view no tool opens is dead code in every view's bundle.
 * The tools come from the REAL composition (`createApp`), so every module this
 * server composes is covered without an edit here.
 */
describe("the view registry vs the view-bound tools", () => {
  let app: RunningServer
  let client: Client
  let viewTools: string[]

  beforeAll(async () => {
    // Every view-bound tool is a read, so the default boot (each module's floor) lists them all.
    stubNeutralEnv()
    const composed = await createApp(process.env, { bundle: { jsPath: FIXTURE_JS } })
    app = await composed.listen({ port: 0, host: "127.0.0.1" })
    client = new Client({ name: "view-registry-test", version: "0.0.0" })
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${app.port}/mcp`)),
    )
    const { tools } = (await client.listTools()) as { tools: ToolEntry[] }
    viewTools = tools.filter((t) => typeof t._meta?.ui?.resourceUri === "string").map((t) => t.name)
  })

  afterAll(async () => {
    await client?.close()
    await app?.shutdown()
    vi.unstubAllEnvs()
  })

  it("holds a view for every view-bound tool, and nothing else", () => {
    expect(viewTools).toContain("notes_show_notes")
    expect(Object.keys(viewRegistry).sort()).toEqual([...viewTools].sort())
  })

  it("holds a settings section for every module's settings view", () => {
    for (const name of viewTools) {
      const module = /^([a-z0-9-]+)_show_settings$/.exec(name)?.[1]
      if (module === undefined || module === "shell") continue
      expect(hostWidgets, `${name} has no section`).toHaveProperty(`${module}:settings`)
    }
  })
})

/**
 * The settings page (the shell's) leads with the UI language and then renders
 * every `<module>:settings` host widget, in registration order: YOUR module's
 * section included, with no edit in any package. A section that never reaches
 * `hostWidgets` is simply absent from the page.
 */
describe("the host widgets", () => {
  it("hold nothing but settings sections and the cross-module widgets a module renders", () => {
    const refs: readonly string[] = CAMUNDA7_HOST_WIDGET_REFS
    const stray = Object.keys(hostWidgets).filter(
      (id) => !id.endsWith(":settings") && !refs.includes(id),
    )
    expect(stray).toEqual([])
    for (const ref of refs) expect(hostWidgets).toHaveProperty(ref)
  })

  it("put the sections on the settings page in registration order", () => {
    expect(settingsSections(hostWidgets).map(([id]) => id)).toEqual([
      "camunda7:settings",
      "analytics:settings",
    ])
  })

  it("grow the page by a custom module's `<module>:settings` widget", () => {
    // The extension point: give your section the `<module>:settings` id and
    // spread it into `hostWidgets`; the settings page picks it up.
    const CustomSection = () => null
    const ids = settingsSections({ ...hostWidgets, "your-module:settings": CustomSection }).map(
      ([id]) => id,
    )
    expect(ids).toEqual(["camunda7:settings", "analytics:settings", "your-module:settings"])
  })
})
