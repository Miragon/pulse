import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"
import { createApp } from "../src/app.js"
import { viewRegistry } from "../src/ui/view-registry.js"
import { stubNeutralEnv } from "./neutral-env.js"
import { toolsetSelections } from "./toolset-selections.js"

const FIXTURE_JS = path.join(import.meta.dirname, "fixtures", "mcp-app.js")

interface WireTool {
  name: string
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }
  _meta?: { ui?: { resourceUri?: unknown } }
}

/** A view-bound tool as one boot lists it. */
interface ListedViewTool {
  tool: WireTool
  /** The `MCP_ACTIVE_MODULES` selection of that boot. */
  selection: string
}

/** Boot the composed server on `selection` and collect its view-bound tools. */
async function listViewTools(selection: string, into: ListedViewTool[]): Promise<void> {
  stubNeutralEnv({ MCP_ACTIVE_MODULES: selection })
  const composed = await createApp(process.env, { bundle: { jsPath: FIXTURE_JS } })
  const app = await composed.listen({ port: 0, host: "127.0.0.1" })
  const client = new Client({ name: "tool-annotations-test", version: "0.0.0" })
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${app.port}/mcp`)),
    )
    const tools = (await client.listTools()).tools as unknown as WireTool[]
    for (const tool of tools) {
      if (typeof tool._meta?.ui?.resourceUri === "string") into.push({ tool, selection })
    }
  } finally {
    await client.close()
    await app.shutdown()
  }
}

/**
 * Every view-bound tool is a read. On a host that strips `structuredContent`
 * (claude.ai), the view re-runs its own view tool ONCE by itself, without
 * asking and without reading its annotations (widget-shell's view runtime):
 * a show tool that writes would write a second time, unconfirmed. Booted on
 * every toolset each module declares (`toolsetSelections`, as the strict-input
 * guard does), so a show tool a toolset adds is covered too.
 */
describe("view-bound tools are reads (a stripped result re-runs them)", () => {
  const selections = toolsetSelections()
  const viewTools: ListedViewTool[] = []

  beforeAll(async () => {
    for (const selection of selections) await listViewTools(selection, viewTools)
  }, 30_000 * selections.length)

  afterAll(() => {
    vi.unstubAllEnvs()
  })

  it("checks the tool behind every view the registry holds (the guard is not vacuous)", () => {
    const checked = new Set(viewTools.map(({ tool }) => tool.name))
    const unchecked = Object.keys(viewRegistry).filter((name) => !checked.has(name))
    expect(unchecked, "views no boot listed a tool for").toEqual([])
  })

  it("binds a view only to tools with readOnlyHint: true and never destructiveHint: true", () => {
    const writes = viewTools
      .filter(
        ({ tool }) =>
          tool.annotations?.readOnlyHint !== true || tool.annotations.destructiveHint === true,
      )
      .map(({ tool, selection }) => `${tool.name} (${selection})`)
    expect(
      writes,
      "view-bound tools that are not reads: a host that strips structuredContent re-runs them once, unasked. " +
        "Move the write into a registrar tool (the create-module skill, Steps 4 and 5) and give the show tool readOnlyHint: true.",
    ).toEqual([])
  })
})
