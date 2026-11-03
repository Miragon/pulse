// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import type { ComponentType } from "react"
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react"
import { ENGINE_COCKPIT_OVERVIEW_DATA } from "../../tool-names.js"
import { useAnalyticsActive } from "./analytics-probe.js"
import { LandingChooser } from "./landing.js"
import { TestViewHost, createTestQueryClient } from "@miragon/pulse-widget-shell/widgets"

// One retry-free client per test; the test reads and pokes its cache.
let queryClient = createTestQueryClient()

// The query client is a singleton: restore it so no feed answer leaks across tests.

afterEach(() => {
  cleanup()
  queryClient = createTestQueryClient()
})

const ENGINES = [
  { id: "prod-a", environment: "prod" },
  { id: "prod-b", environment: "prod" },
  { id: "test-down", environment: "test" },
  { id: "test-empty", environment: "test" },
  { id: "test-slow", environment: "test" },
  { id: "test-stuck", environment: "test" },
]

/** prod-a incidents, prod-b healthy, test-down unreachable, test-empty empty, test-slow never answers, test-stuck no retries. */
function overviewFeed(args: Record<string, unknown>) {
  if (args.engine === "test-down") throw new Error("ECONNREFUSED")
  if (args.engine === "test-slow") return new Promise(() => {})
  return {
    summary: {
      totalDefinitions: args.engine === "test-empty" ? 0 : 2,
      totalRunningInstances: args.engine === "test-empty" ? 0 : 10,
      totalFailedJobs: args.engine === "test-stuck" ? 4 : 0,
      totalIncidents: args.engine === "prod-a" ? 18 : 0,
    },
    definitions: [],
    engineId: args.engine,
  }
}

function renderLanding(
  onOpenFleet?: () => void,
  engines: Array<{ id: string; environment?: string }> = ENGINES,
) {
  const Landing: ComponentType<Record<string, unknown>> = () => (
    <LandingChooser
      engines={engines}
      defaultEngineId="prod-b"
      onEnterEngine={() => {}}
      onOpenFleet={onOpenFleet}
    />
  )
  render(
    <TestViewHost tools={{ [ENGINE_COCKPIT_OVERVIEW_DATA]: overviewFeed }} client={queryClient}>
      <Landing />
    </TestViewHost>,
  )
}

// #322 U15: the landing is the product signature over a dense engine list.
describe("LandingChooser", () => {
  it("signs the app: Pulse over Operations Cockpit, with the Komet", () => {
    renderLanding()
    expect(screen.getByRole("heading", { level: 1, name: "Operations Cockpit" })).toBeTruthy()
    expect(screen.getByText("Pulse")).toBeTruthy()
    expect(document.querySelector("[data-brand-mark='komet']")).toBeTruthy()
  })

  it("offers the cross-engine view only when the cockpit passes it in", () => {
    renderLanding(() => {})
    expect(screen.getByRole("button", { name: "Cross-engine overview" })).toBeTruthy()
    cleanup()
    renderLanding(undefined)
    expect(screen.queryByRole("button", { name: "Cross-engine overview" })).toBeNull()
  })

  it("lists every engine at once, grouped by environment", () => {
    renderLanding()
    expect(screen.getByRole("region", { name: "Environment PROD" })).toBeTruthy()
    const test = screen.getByRole("region", { name: "Environment TEST" })
    expect(within(test).getAllByRole("button")).toHaveLength(4)
    expect(screen.getByText("6 engines in 2 environments. Pick one to work with.")).toBeTruthy()
  })

  it("names each engine's state in words inside its button", async () => {
    renderLanding()
    expect(await screen.findByRole("button", { name: /^prod-a\s*,\s*18 incidents$/ })).toBeTruthy()
    expect(
      await screen.findByRole("button", { name: /^test-down\s*,\s*unreachable$/ }),
    ).toBeTruthy()
    expect(await screen.findByRole("button", { name: /^test-empty\s*,\s*empty$/ })).toBeTruthy()
    expect(await screen.findByRole("button", { name: /^test-slow\s*,\s*loading…$/ })).toBeTruthy()
    expect(
      await screen.findByRole("button", { name: /^test-stuck\s*,\s*4 jobs without retries$/ }),
    ).toBeTruthy()
    expect(
      await screen.findByRole("button", { name: /^prod-b\s*default\s*,\s*no incidents$/ }),
    ).toBeTruthy()
  })

  it("no named environment: one flat list, no environment heading", () => {
    renderLanding(undefined, [{ id: "solo-a" }, { id: "solo-b" }])
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull()
    expect(screen.getByText("2 engines configured. Pick one to work with.")).toBeTruthy()
  })
})

describe("useAnalyticsActive", () => {
  function Probe() {
    return <span>{`analytics:${String(useAnalyticsActive())}`}</span>
  }
  const ProbeWidget = Probe as unknown as ComponentType<Record<string, unknown>>

  it("is true once the analytics landscape feed answers", async () => {
    render(
      <TestViewHost
        tools={{ analytics_engine_landscape_data: { engines: [] } }}
        client={queryClient}
      >
        <ProbeWidget />
      </TestViewHost>,
    )
    expect(screen.getByText("analytics:false")).toBeTruthy()
    expect(await screen.findByText("analytics:true")).toBeTruthy()
  })

  it("stays false when the module is not active (unknown tool)", async () => {
    render(
      <TestViewHost tools={{}} client={queryClient}>
        <ProbeWidget />
      </TestViewHost>,
    )
    await waitFor(() =>
      expect(
        queryClient.getQueryCache().find({ queryKey: ["analytics-probe"], exact: false })?.state
          .status,
      ).toBe("error"),
    )
    expect(screen.getByText("analytics:false")).toBeTruthy()
  })

  it("answers once per view: a later probe reads nothing, a failing re-read never flips it", async () => {
    let calls = 0
    let failing = false
    const tools = {
      analytics_engine_landscape_data: () => {
        calls += 1
        if (failing) throw new Error("Prometheus is down")
        return { engines: [] }
      },
    }
    const tree = (probes: number) => (
      <TestViewHost tools={tools} client={queryClient}>
        {Array.from({ length: probes }, (_, i) => (
          <ProbeWidget key={i} />
        ))}
      </TestViewHost>
    )
    const view = render(tree(1))
    expect(await screen.findByText("analytics:true")).toBeTruthy()

    view.rerender(tree(2))
    expect(screen.getAllByText("analytics:true")).toHaveLength(2)
    expect(calls).toBe(1)

    failing = true
    await act(() => queryClient.refetchQueries({ queryKey: ["analytics-probe"] }))
    expect(calls).toBe(2)
    expect(screen.getAllByText("analytics:true")).toHaveLength(2)
  })

  it("a failed probe stays false for the view: a later probe does not re-read", async () => {
    const calls: string[] = []
    const tree = (probes: number) => (
      <TestViewHost
        tools={{}}
        client={queryClient}
        onHostAction={(action) => {
          if (action.type === "callTool") calls.push(action.name)
        }}
      >
        {Array.from({ length: probes }, (_, i) => (
          <ProbeWidget key={i} />
        ))}
      </TestViewHost>
    )
    const view = render(tree(1))
    await waitFor(() =>
      expect(
        queryClient.getQueryCache().find({ queryKey: ["analytics-probe"], exact: false })?.state
          .status,
      ).toBe("error"),
    )
    view.rerender(tree(2))
    expect(screen.getAllByText("analytics:false")).toHaveLength(2)
    expect(calls).toEqual(["analytics_engine_landscape_data"])
  })
})
