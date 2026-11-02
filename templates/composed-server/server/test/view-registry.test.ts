import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"
import type { RunningServer } from "@miragon/pulse-widget-shell/server"
import { ENGINE_HOST_WIDGET_REFS } from "@miragon/pulse-engine-connector/widgets"
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
})

/** A cross-module widget no module renders is dead code in every view's bundle. */
describe("the host widgets", () => {
  it("hold nothing but the cross-module widgets a module renders", () => {
    const refs: readonly string[] = ENGINE_HOST_WIDGET_REFS
    const stray = Object.keys(hostWidgets).filter((id) => !refs.includes(id))
    expect(stray).toEqual([])
    for (const ref of refs) expect(hostWidgets).toHaveProperty(ref)
  })
})
