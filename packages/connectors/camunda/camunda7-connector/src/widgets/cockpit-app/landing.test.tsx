// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { ComponentType } from "react"
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import { queryClient } from "@miragon/mcp-toolkit-ui"
import { WidgetFixtureHost } from "@miragon/mcp-toolkit-ui/app"
import { CAMUNDA7_COCKPIT_OVERVIEW_DATA } from "../../tool-names.js"
import { useAnalyticsActive } from "./analytics-probe.js"
import { LandingChooser } from "./landing.js"

// The query client is a singleton: restore it so no feed answer leaks across tests.
const toolkitDefaults = queryClient.getDefaultOptions()

beforeEach(() => {
  // The default three retries would hold a failed feed in "pending" for seconds.
  queryClient.setDefaultOptions({
    ...toolkitDefaults,
    queries: { ...toolkitDefaults.queries, retry: false },
  })
})

afterEach(() => {
  cleanup()
  queryClient.clear()
  queryClient.setDefaultOptions(toolkitDefaults)
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
    <WidgetFixtureHost
      widget={Landing}
      data={{}}
      tools={{ [CAMUNDA7_COCKPIT_OVERVIEW_DATA]: overviewFeed }}
    />,
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

  it("is true once the analytics settings feed answers", async () => {
    render(
      <WidgetFixtureHost
        widget={ProbeWidget}
        data={{}}
        tools={{ analytics_settings_data: { settings: {} } }}
      />,
    )
    expect(screen.getByText("analytics:false")).toBeTruthy()
    expect(await screen.findByText("analytics:true")).toBeTruthy()
  })

  it("stays false when the module is not active (unknown tool)", async () => {
    render(<WidgetFixtureHost widget={ProbeWidget} data={{}} tools={{}} />)
    await waitFor(() =>
      expect(
        queryClient.getQueryCache().find({ queryKey: ["analytics-probe"], exact: false })?.state
          .status,
      ).toBe("error"),
    )
    expect(screen.getByText("analytics:false")).toBeTruthy()
  })
})
