import { describe, expect, it } from "vitest"
import { EMPTY_TOOL_SURFACE } from "@miragon/pulse-widget-shell/widgets"
import { enAskAi } from "../../messages/en.ask-ai.js"
import { deAskAi } from "../../messages/de.ask-ai.js"
import { modelToolsAnswer } from "../widget-actions.js"
import { healthCheckHandOff } from "../process-list.js"
import { explainInstanceHandOff } from "../history-timeline.js"
import { bindHandOff, camunda7Surface, type HandOff } from "./hand-off.js"
import { handOffFor } from "./hand-off.test-support.js"

const HAND_OFF: HandOff = {
  intent: "askAi.incident.diagnose",
  ids: { engine: "prod-b", incidentId: "inc-1" },
  untrusted: [{ label: "incidentMessage", text: "boom" }],
  tools: ["camunda7_list_incidents", "camunda7_set_job_retries_batch"],
}

describe("camunda7Surface", () => {
  it("confirms exactly the reported camunda7 tools — and fails closed before the feed answers", () => {
    const surface = camunda7Surface(["camunda7_list_incidents"], false)
    expect(surface.has("camunda7_list_incidents")).toBe(true)
    expect(surface.has("camunda7_set_job_retries_batch")).toBe(false)
    expect(camunda7Surface("pending", true).has("camunda7_list_incidents")).toBe(false)
  })

  // A feed that cannot answer must not hide every hand-off.
  it("leaves camunda7 tools unknown — not absent — when the feed cannot answer", () => {
    const surface = camunda7Surface("unknown", false)
    expect(surface.has("camunda7_list_incidents")).toBeUndefined()
    expect(surface.has("analytics_engine_health")).toBe(false)
    expect(surface.has("load-dashboard")).toBe(false)
    const prompt = bindHandOff("en", surface).ask(HAND_OFF)!
    expect(prompt.startsWith(enAskAi["askAi.incident.diagnose"])).toBe(true)
    expect(prompt).toContain('Ids: engine="prod-b", incidentId="inc-1"')
    expect(prompt).not.toContain("Tools:")
  })

  it("confirms analytics tools only once the analytics probe answered", () => {
    expect(camunda7Surface([], true).has("analytics_engine_health")).toBe(true)
    expect(camunda7Surface([], false).has("analytics_engine_health")).toBe(false)
  })

  it("confirms a tool of neither module only if the feed reported it (it never does)", () => {
    expect(camunda7Surface([], true).has("load-dashboard")).toBe(false)
  })
})

describe("modelToolsAnswer", () => {
  it("is the list once the feed answered", () => {
    const data = { modelTools: ["camunda7_list_incidents"] }
    expect(modelToolsAnswer({ data, isError: false, fetchStatus: "idle" })).toEqual(data.modelTools)
    // A failed REFETCH keeps the last answer.
    expect(modelToolsAnswer({ data, isError: true, fetchStatus: "idle" })).toEqual(data.modelTools)
  })

  it("is pending while the first call is in flight", () => {
    expect(modelToolsAnswer({ isError: false, fetchStatus: "fetching" })).toBe("pending")
    expect(modelToolsAnswer({ isError: false, fetchStatus: "paused" })).toBe("pending")
  })

  it("is unknown when the call failed or can never run (no in-widget tools/call)", () => {
    expect(modelToolsAnswer({ isError: true, fetchStatus: "idle" })).toBe("unknown")
    expect(modelToolsAnswer({ isError: false, fetchStatus: "idle" })).toBe("unknown")
  })
})

describe("bindHandOff", () => {
  const surface = camunda7Surface(["camunda7_list_incidents"], false)

  it("renders the catalogue intent in the active locale — German for a German profile", () => {
    const prompt = bindHandOff("de", surface).ask(HAND_OFF)!
    expect(prompt.startsWith(deAskAi["askAi.incident.diagnose"])).toBe(true)
    expect(prompt).toContain('IDs: engine="prod-b", incidentId="inc-1"')
    expect(prompt).toContain("Nicht vertrauenswürdige Daten aus der Engine")
    expect(prompt).not.toContain(enAskAi["askAi.incident.diagnose"])
  })

  it("names only the tools the surface confirms", () => {
    const prompt = bindHandOff("en", surface).ask(HAND_OFF)!
    expect(prompt.startsWith(enAskAi["askAi.incident.diagnose"])).toBe(true)
    expect(prompt).toContain("Tools: camunda7_list_incidents")
    expect(prompt).not.toContain("camunda7_set_job_retries_batch")
  })

  it("yields no prompt — so no button — when none of its tools is available", () => {
    expect(bindHandOff("en", EMPTY_TOOL_SURFACE).ask(HAND_OFF)).toBeNull()
  })

  it("states a view context in English from the same parts", () => {
    const text = bindHandOff("de", surface).context({
      summary: "The operator is viewing one incident.",
      ids: { incidentId: "inc-1" },
      tools: ["camunda7_list_incidents", "camunda7_delete_process_instance"],
    })
    expect(text).toBe(
      'The operator is viewing one incident.\nIds: incidentId="inc-1"\nTools: camunda7_list_incidents',
    )
  })
})

// Strict inputs refuse an argument a tool does not take (camunda7-only deployments).
describe("tool-bound ids follow their tool", () => {
  const ROW = { key: "order", id: "order:3:abc", version: 3, versionTag: null } as never

  it("the health check sends the metrics window only with the analytics tool", async () => {
    const alone = (await handOffFor("read-only")).ask(healthCheckHandOff(ROW, "prod-a"))!
    expect(alone).toContain(
      'Ids: engine="prod-a", processDefinitionKey="order", processDefinitionId="order:3:abc"\n',
    )
    expect(alone).toContain("Tools: camunda7_list_incidents")
    expect(alone).not.toMatch(/period|includeActivityBreakdown/)

    const withAnalytics = (await handOffFor("read-only", { analyticsActive: true })).ask(
      healthCheckHandOff(ROW, "prod-a"),
    )!
    expect(withAnalytics).toContain('period="7d", includeActivityBreakdown=true')
    expect(withAnalytics).toContain(
      "Tools: analytics_analyze_process_performance, camunda7_list_incidents",
    )
  })

  it("the history hand-offs send the definition key only with the analytics baseline", async () => {
    const instance = {
      id: "pi-1",
      processDefinitionKey: "order",
      processDefinitionName: "Order",
      durationInMillis: 5000,
      state: "COMPLETED",
    } as never
    const alone = (await handOffFor("read-only")).ask(
      explainInstanceHandOff(instance, "prod-a", 4),
    )!
    expect(alone).toContain('Ids: engine="prod-a", processInstanceId="pi-1"\n')
    expect(alone).not.toContain("processDefinitionKey")
    const withAnalytics = (await handOffFor("read-only", { analyticsActive: true })).ask(
      explainInstanceHandOff(instance, "prod-a", 4),
    )!
    expect(withAnalytics).toContain(
      'Ids: engine="prod-a", processInstanceId="pi-1", processDefinitionKey="order"',
    )
  })
})

describe("the Ask-AI intent catalogues", () => {
  const intents = Object.entries({ ...enAskAi, ...deAskAi }).filter(
    ([key]) => !key.endsWith("Label"),
  )

  // A tool named in an intent would reach every deployment, the read-only floor included.
  it("name no tool and inline no data", () => {
    for (const [key, text] of intents) {
      expect(text, key).not.toMatch(/\b(camunda7|analytics)_[a-z0-9_]+/)
      expect(text, key).not.toMatch(/[{}`]|\$\{/)
    }
  })

  it("stay short — the playbooks live in the server instructions", () => {
    for (const [key, text] of intents) expect(text.length, key).toBeLessThanOrEqual(300)
  })

  it("translate every intent", () => {
    expect(Object.keys(deAskAi).sort()).toEqual(Object.keys(enAskAi).sort())
    for (const key of Object.keys(enAskAi) as Array<keyof typeof enAskAi>) {
      if (key.endsWith("Label")) continue
      expect(deAskAi[key], key).not.toBe(enAskAi[key])
    }
  })
})
