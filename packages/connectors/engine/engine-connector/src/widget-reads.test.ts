import { beforeAll, describe, expect, it } from "vitest"
import { recordingModuleServer } from "@miragon/pulse-widget-shell/testing"
import { createPlugin } from "./plugin.js"
import {
  ENGINE_LIST_ENGINES,
  ENGINE_OPEN_COCKPIT,
  ENGINE_WIDGET_ACTIONS_DATA,
} from "./tool-names.js"
import { scanWidgets, type ToolReference } from "./widget-scan.test-support.js"

/**
 * Every tool a view reads is one a view may call: the view tool, an app-only feed, or a model tool
 * marked `forViews` (the engine list, an instance's history, a task's form), each a read with
 * `openai/widgetAccessible`. That mark is what an Apps SDK host
 * allows an in-widget call by, and what the web app's forward (`/app/api/call`) admits a page's
 * call by, so a read without it would fail on both.
 */

interface Registered {
  readonly annotations?: { readonly readOnlyHint?: boolean }
  readonly _meta?: Record<string, unknown>
}

/** Every tool the plugin registers on the widest toolset, as the boot records it. */
function registeredTools(): Map<string, Registered> {
  const recording = recordingModuleServer()
  createPlugin({
    engines: [{ id: "prod", baseUrl: "http://prod.example/engine-rest" }],
    toolset: "admin",
  }).register(recording.server)
  return new Map([...recording.tools.values()].map(({ name, config }) => [name, config]))
}

/** How a view may call a tool: as its view, as an app-only feed, or as a model tool for views. */
function kindOf({ _meta: meta = {} }: Registered): string | undefined {
  const ui = (meta.ui ?? {}) as { resourceUri?: unknown; visibility?: unknown }
  if (meta["openai/widgetAccessible"] !== true) return undefined
  if (typeof ui.resourceUri === "string") return "view"
  const visibility = JSON.stringify(ui.visibility)
  if (visibility === '["app"]') return "feed"
  return visibility === '["model","app"]' ? "for views" : undefined
}

let reads: ToolReference[]
let registered: Map<string, Registered>
beforeAll(() => {
  reads = scanWidgets().references.filter((ref) => ref.via === "read")
  registered = registeredTools()
})

describe("every read a view makes is one a view may call", () => {
  it("finds the views' reads, the engine list among them (the scan is not vacuous)", () => {
    const names = new Set(reads.map((ref) => ref.name))
    expect(names).toContain(ENGINE_LIST_ENGINES)
    expect(names).toContain(ENGINE_WIDGET_ACTIONS_DATA)
    expect(names.size).toBeGreaterThanOrEqual(15)
  })

  it("reads only a view tool, an app-only feed or a forViews tool, each a read", () => {
    const wrong = [...reads, { file: "the page root", line: 0, name: ENGINE_OPEN_COCKPIT }]
      .map((ref) => ({ ref, tool: registered.get(ref.name ?? "") }))
      .filter(
        ({ tool }) =>
          tool === undefined || tool.annotations?.readOnlyHint !== true || !kindOf(tool),
      )
      .map(({ ref }) => `${ref.file}:${ref.line} ${ref.name}`)
    expect(
      wrong,
      "a model tool a view reads takes forViews: true on the registrar (invariant 5)",
    ).toEqual([])
  })

  it("marks for views the model tools the cockpit reads: the engines, an instance's history, a task's form", () => {
    const kinds = new Map(reads.map((ref) => [ref.name, kindOf(registered.get(ref.name ?? "")!)]))
    const forViews = [...kinds].filter(([, kind]) => kind === "for views").map(([name]) => name)
    expect(forViews.sort()).toEqual([
      "engine_get_task_form",
      ENGINE_LIST_ENGINES,
      "engine_query_historic_activity_instances",
    ])
  })
})
