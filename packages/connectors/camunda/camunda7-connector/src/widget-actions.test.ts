import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeAll, describe, expect, it, vi } from "vitest"
import type { MCPServer } from "mcp-use"
import { createPlugin } from "./plugin.js"
import { CAMUNDA7_SAVE_SETTINGS, CAMUNDA7_WIDGET_ACTIONS } from "./tool-names.js"
import { GATING_SITES } from "./widgets/action-gating.sites.js"
import { WRITE_POLICY } from "./widgets/lib/write-policy.js"
import {
  WIDGETS_DIR,
  scanText,
  scanWidgets,
  type ToolReference,
  type WidgetScan,
} from "./widget-scan.test-support.js"

/** THE in-widget write primitive — the one file allowed to hold a raw mutation and the gate. */
const PRIMITIVE = "lib/engine-action.ts"

/**
 * The files that may obtain a raw tool caller at all. Calls through one are
 * tracked by name (aliases and renames included), but a caller handed on as a
 * value — a parameter, a prop — leaves that reach, so every new holder is a
 * reviewed decision. Neither of these calls a tool through it.
 */
const RAW_CALLER_HOLDERS: Record<string, string> = {
  "navigation.ts": "posts a navigation intent as a chat follow-up; calls no tool",
}

/** Every tool the plugin registers on the widest toolset, with its read/write nature. */
function registeredTools(): Map<string, { readOnly: boolean }> {
  const register = vi.fn()
  const server = { tool: register, prompt: vi.fn() } as unknown as MCPServer
  const plugin = createPlugin({
    engines: [{ id: "prod", baseUrl: "http://prod.example/engine-rest" }],
    toolset: "admin",
  })
  plugin.register(server)
  const definitions = register.mock.calls.map(
    ([definition]) => definition as { name: string; annotations?: { readOnlyHint?: boolean } },
  )
  return new Map(
    definitions.map((d) => [d.name, { readOnly: d.annotations?.readOnlyHint === true }]),
  )
}

let scan: WidgetScan
let registered: Map<string, { readOnly: boolean }>
beforeAll(() => {
  scan = scanWidgets()
  registered = registeredTools()
})

const at = (ref: ToolReference) => `${ref.file}:${ref.line}`
const isWrite = (name: string | null) => name !== null && registered.get(name)?.readOnly === false
const actionRefs = () => scan.references.filter((r) => r.via === "action")

/** #341: a write that bypasses `useEngineAction` could skip its gate, confirmation or refresh. */
describe("every in-widget write goes through useEngineAction", () => {
  it("finds the widgets' tool calls and classifies them (the scan is not vacuous)", () => {
    expect(actionRefs().length).toBeGreaterThanOrEqual(CAMUNDA7_WIDGET_ACTIONS.length)
    expect(scan.references.some((r) => r.via === "read")).toBe(true)
    expect(registered.get("camunda7_set_job_retries")?.readOnly).toBe(false)
    expect(registered.get("camunda7_jobs_data")?.readOnly).toBe(true)
  })

  it("only the primitive holds the raw mutation and the deployment gate", () => {
    expect(scan.mutationImports).toEqual([PRIMITIVE])
    expect(scan.canRunCalls).toEqual([PRIMITIVE])
  })

  it("names every tool it calls literally (a string or a string constant)", () => {
    const dynamic = scan.references.filter((r) => r.name === null && r.file !== PRIMITIVE)
    expect(
      dynamic.map(at),
      "pass the tool name as a literal or a string constant, so this guard can classify it",
    ).toEqual([])
  })

  it("never calls a write tool except through useEngineAction", () => {
    const bypasses = scan.references.filter((r) => r.via !== "action" && isWrite(r.name))
    expect(
      bypasses.map((r) => `${at(r)} ${r.via}(${r.name})`),
      "run the write through useEngineAction — it gates, confirms, refreshes and resets",
    ).toEqual([])
  })

  it("runs only registered writes, each one listed in CAMUNDA7_WIDGET_ACTIONS (or self-gated)", () => {
    const listed = new Set<string>([...CAMUNDA7_WIDGET_ACTIONS, CAMUNDA7_SAVE_SETTINGS])
    for (const ref of actionRefs()) {
      expect(isWrite(ref.name), `${at(ref)}: ${ref.name} is not a registered write`).toBe(true)
      expect(
        listed.has(ref.name ?? ""),
        `${at(ref)}: add ${ref.name} to CAMUNDA7_WIDGET_ACTIONS (tool-names.ts) — the feed gates only listed writes`,
      ).toBe(true)
    }
  })

  it("leaves no listed widget action unused", () => {
    const used = new Set(actionRefs().map((r) => r.name))
    for (const action of CAMUNDA7_WIDGET_ACTIONS) {
      expect(used.has(action), `${action} is listed but no widget runs it`).toBe(true)
    }
  })

  it("has a render-level gating case for every call site", () => {
    const sites = new Set(actionRefs().map((r) => `${r.file}#${r.name}`))
    expect(new Set(GATING_SITES.map((entry) => entry.site))).toEqual(sites)
  })

  it("invalidates only query namespaces some view actually uses", () => {
    const roots = new Set(scan.keyRoots)
    for (const [write, policy] of Object.entries(WRITE_POLICY)) {
      for (const namespace of policy.invalidates) {
        expect(roots.has(namespace), `${write} invalidates ${namespace}, which no query uses`).toBe(
          true,
        )
      }
    }
  })

  it("obtains a raw tool caller only in the reviewed files", () => {
    expect(
      [...scan.callerHolders].sort(),
      "a widget write goes through useEngineAction; a read through a query hook",
    ).toEqual(Object.keys(RAW_CALLER_HOLDERS).sort())
  })
})

/** The guard's own blind spots, pinned on sources written to hit them. */
describe("the structural scan itself", () => {
  it("takes no query-key root from the policy it checks — a namespace never certifies itself", () => {
    const policy = scanText(
      "lib/write-policy.ts",
      readFileSync(join(WIDGETS_DIR, "lib/write-policy.ts"), "utf8"),
    )
    expect([...policy.keyRoots]).toEqual([])
  })

  it("takes a query-key root from every read-site shape, and from nothing else", () => {
    const { keyRoots } = scanText(
      "probe.tsx",
      `
      const NOT_A_KEY = ["test:list-of-namespaces", "test:other"]
      function feedKey(id: string) {
        return ["test:helper-key", id]
      }
      function feed(id: string) {
        return { key: ["test:option-helper", id], args: { id }, ready: true }
      }
      export function Probe({ id }: { id: string }) {
        useToolQuery(["test:tool-query"], "test_data", {})
        useViewData(null, ["test:view-data"], "test_data", {}, true)
        useToolQuery(feedKey(id), "test_data", {})
        useDetailView({ ...feed(id), tool: "test_data" })
        usePagedViewData({ key: ["test:paged", id], tool: "test_data" })
        return NOT_A_KEY.length
      }
      `,
    )
    expect([...keyRoots].sort()).toEqual([
      "test:helper-key",
      "test:option-helper",
      "test:paged",
      "test:tool-query",
      "test:view-data",
    ])
  })

  it("follows a raw tool caller through a rename, a destructuring and an alias", () => {
    const { references, callerHolders } = scanText(
      "probe.tsx",
      `
      export function Probe() {
        const host = useViewHost()
        const invoke = host.callTool
        invoke("camunda7_resolve_incident", { incidentId: "i" })
        const { callTool: run } = useViewHost()
        run("camunda7_set_job_retries", { jobId: "j", retries: 1 })
        const bridge = host
        const call = bridge?.callTool
        call?.("camunda7_delete_process_instance", { processInstanceId: "p" })
        const again = invoke
        again("camunda7_complete_task", { taskId: "t" })
      }
      `,
    )
    expect(references.map((r) => `${r.via}(${r.name})`)).toEqual([
      "callTool(camunda7_resolve_incident)",
      "callTool(camunda7_set_job_retries)",
      "callTool(camunda7_delete_process_instance)",
      "callTool(camunda7_complete_task)",
    ])
    expect(references.every((r) => isWrite(r.name))).toBe(true)
    expect([...callerHolders]).toEqual(["probe.tsx"])
  })
})
