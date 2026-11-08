// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { LocaleProvider, formatNumber } from "@miragon/pulse-ui"
import {
  TestViewHost,
  type HostAction,
  createTestQueryClient,
} from "@miragon/pulse-widget-shell/widgets"
import { EngineHealthVerdict } from "./engine-health.js"
import type { EngineHealthData } from "../view-models.js"
import { ENGINE_WIDGET_ACTIONS_DATA } from "../tool-names.js"
import { widgetActionsFeedFor } from "./lib/hand-off.test-support.js"

// One retry-free client per test; the test reads and pokes its cache.
let queryClient = createTestQueryClient()

afterEach(() => {
  cleanup()
  queryClient = createTestQueryClient()
})

/** The fix-or-diagnose offer follows the deployment's gate: these fixtures run as `operations`. */
let tools: Record<string, unknown>
beforeAll(async () => {
  tools = { [ENGINE_WIDGET_ACTIONS_DATA]: await widgetActionsFeedFor("operations") }
})

const RULE =
  "From the engine's open incidents, read live: critical at >=50 open incidents or >=25 of one cause, warning with any, else ok."

const DEGRADED: EngineHealthData = {
  status: "warning",
  statusRule: RULE,
  summary: {
    totalIncidents: 51,
    lastHourIncidents: 9,
    last24hIncidents: 12,
    affectedActivities: 3,
    affectedDefinitions: 2,
    runningInstances: 312,
    totalDefinitions: 8,
    started24h: 1240,
    completed24h: 1180,
  },
  clusters: [
    {
      id: "callWMS::failedExternalTask",
      activityId: "callWMS",
      activityName: null,
      incidentType: "failedExternalTask",
      messageSignature: "connection timeout to wms",
      incidentCount: 40,
      scannedIncidentCount: 40,
      last24hCount: 10,
      processDefinitionKeys: ["shipping"],
      processDefinitionName: null,
      representativeMessage: "Connection timeout to WMS",
      representativeIncidentId: "inc-1",
      latestIncident: "2026-06-11T14:00:00.000Z",
    },
    {
      id: "checkCustomer::failedJob",
      activityId: "checkCustomer",
      activityName: null,
      incidentType: "failedJob",
      messageSignature: "customerid is null",
      incidentCount: 8,
      scannedIncidentCount: 8,
      last24hCount: 2,
      processDefinitionKeys: ["onboarding", "shipping"],
      processDefinitionName: null,
      representativeMessage: "customerId is null",
      representativeIncidentId: "inc-2",
      latestIncident: "2026-06-11T13:00:00.000Z",
    },
  ],
  fetchedAt: "2026-06-11T14:05:00.000Z",
  engineId: "default",
}

const HEALTHY: EngineHealthData = {
  status: "ok",
  statusRule: RULE,
  summary: {
    totalIncidents: 0,
    lastHourIncidents: 0,
    last24hIncidents: 0,
    affectedActivities: 0,
    affectedDefinitions: 0,
    runningInstances: 312,
    totalDefinitions: 8,
    started24h: 1240,
    completed24h: 1180,
  },
  clusters: [],
  fetchedAt: "2026-06-11T14:05:00.000Z",
  engineId: "default",
}

/** The overview's verdict on the cockpit's engine, the fixtures' `default`. */
const Widget = ({ data }: { data: EngineHealthData }) => (
  <EngineHealthVerdict data={data} engine="default" />
)

describe("EngineHealthVerdict (fixture render)", () => {
  it("labels each view's clusters section by its own heading, two views on one page included", () => {
    const Two = () => (
      <>
        <EngineHealthVerdict data={DEGRADED} engine="default" />
        <EngineHealthVerdict data={{ ...DEGRADED, engineId: "other" }} engine="other" />
      </>
    )
    render(
      <TestViewHost tools={tools} client={queryClient}>
        <Two />
      </TestViewHost>,
    )
    const sections = screen.getAllByRole("region", { name: "Top failures, grouped by cause" })
    expect(sections).toHaveLength(2)
    const ids = sections.map((s) => s.getAttribute("aria-labelledby"))
    expect(new Set(ids).size).toBe(2)
  })

  it("renders the verdict header, KPIs and the incident clusters with drill + ask handoffs", async () => {
    render(
      <TestViewHost tools={tools} client={queryClient}>
        <Widget data={DEGRADED as never} />
      </TestViewHost>,
    )

    // Verdict header (#322 U4), the one primary next step and the AI hand-off.
    expect(screen.getByRole("heading", { name: "default · Overview" })).toBeTruthy()
    expect(screen.getByText("51 open incidents across 3 activities")).toBeTruthy()
    expect(screen.getByRole("button", { name: "View incidents" })).toBeTruthy()
    expect(await screen.findByText("Assess in chat")).toBeTruthy()

    expect(screen.getByText("Running instances")).toBeTruthy()

    // Freshness: the "as of" stamp; the cockpit's head holds the one Refresh (#322 U27).
    expect(screen.getByText(/As of/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull()

    // Clustered incidents (cross-process, by activity + type).
    expect(screen.getByText("Top failures, grouped by cause")).toBeTruthy()
    expect(screen.getByText("callWMS")).toBeTruthy()
    expect(screen.getByText("failedExternalTask")).toBeTruthy()
    expect(screen.getByText("checkCustomer")).toBeTruthy()

    // A deterministic drill + the guarded remediation hand-off.
    expect(screen.getAllByText("Open")).toHaveLength(2)
    expect(await screen.findAllByText("Plan a fix in chat")).toHaveLength(2)
  })

  // A failed widget-actions feed keeps the hand-offs; the gate stays closed, so the clusters diagnose.
  it("offers the diagnosis until the widget-actions feed answers", async () => {
    // The shared client retries a failed query with backoff. Fail at once.
    queryClient.setQueryDefaults(["engine-widget-actions"], { retry: false })
    const actions: HostAction[] = []
    render(
      <TestViewHost tools={{}} onHostAction={(action) => actions.push(action)} client={queryClient}>
        <Widget data={DEGRADED as never} />
      </TestViewHost>,
    )
    fireEvent.click(await screen.findByRole("button", { name: /Assess in chat/ }))
    // Without a confirmed retry tool the clusters offer the diagnosis.
    expect(await screen.findAllByRole("button", { name: /Explain error in chat/ })).toHaveLength(2)
    const prompts = actions.flatMap((a) => (a.type === "sendFollowUp" ? [a.prompt] : []))
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain('Ids: engine="default"')
    expect(prompts[0]).not.toMatch(/\bengine_[a-z0-9_]+/)
    queryClient.setQueryDefaults(["engine-widget-actions"], {})
  })

  // #322 U12: names before ids, the cause as the sub-line.
  it("titles each cluster by its activity's name, the cause under it", () => {
    const named: EngineHealthData = {
      ...DEGRADED,
      clusters: [
        {
          ...DEGRADED.clusters[0],
          activityName: "Call warehouse",
          processDefinitionName: "Shipping",
        },
      ],
    }
    render(
      <TestViewHost client={queryClient}>
        <Widget data={named as never} />
      </TestViewHost>,
    )
    const cluster = screen.getByText("Call warehouse").closest("li")!
    // The BPMN id is the quiet second line; the cause and the process follow.
    expect(within(cluster).getByText("callWMS")).toBeTruthy()
    expect(within(cluster).getByText("Connection timeout to WMS")).toBeTruthy()
    expect(within(cluster).getByText(/· Shipping$/)).toBeTruthy()
    // The type is a neutral chip, not a red badge on every row.
    expect(within(cluster).getByText("failedExternalTask").closest("[data-tone]")).toBeNull()
  })

  it("a stable engine's badge is the table's healthy: neutral, never green", () => {
    render(
      <TestViewHost client={queryClient}>
        <Widget data={HEALTHY as never} />
      </TestViewHost>,
    )
    const badge = screen.getByText("Stable").closest("[data-slot='status-badge']")!
    expect(badge.getAttribute("data-tone")).toBe("neutral")
  })

  it("an engine with nothing deployed is neutral: no green 'stable' over an empty engine", () => {
    const empty: EngineHealthData = {
      ...HEALTHY,
      summary: { ...HEALTHY.summary, runningInstances: 0, totalDefinitions: 0 },
    }
    render(
      <TestViewHost client={queryClient}>
        <Widget data={empty as never} />
      </TestViewHost>,
    )
    const badge = screen.getByText("Empty").closest("[data-slot='status-badge']")!
    expect(badge.getAttribute("data-tone")).toBe("neutral")
    expect(screen.getByText("No processes deployed")).toBeTruthy()
    // No open incidents: no primary to look at them.
    expect(screen.queryByRole("button", { name: "View incidents" })).toBeNull()
  })

  it("renders the stable verdict with no cluster list when there are no incidents", () => {
    render(
      <TestViewHost client={queryClient}>
        <Widget data={HEALTHY as never} />
      </TestViewHost>,
    )

    expect(screen.getByText("No open incidents, 312 running instances")).toBeTruthy()
    expect(screen.queryByText("Top failures, grouped by cause")).toBeNull()

    // The healthy state still earns the screen: throughput is visible.
    expect(screen.getByText(/Throughput \(24h\)/)).toBeTruthy()
    expect(screen.getByText(/started/)).toBeTruthy()
  })

  it("shows a capped scan's cluster as the lower bound it is, never as its size", () => {
    const capped: EngineHealthData = {
      ...DEGRADED,
      clusters: [
        {
          ...DEGRADED.clusters[0],
          incidentCount: null,
          scannedIncidentCount: 1400,
          last24hCount: null,
        },
      ],
    }
    render(
      <TestViewHost client={queryClient}>
        <Widget data={capped as never} />
      </TestViewHost>,
    )

    expect(screen.getByText(`≥ ${formatNumber(1400)} affected`, { exact: false })).toBeTruthy()
    // An unknown 24h count is left out, not rendered as "0 new in 24h".
    expect(screen.queryByText(/new in 24h/)).toBeNull()
  })
})

/** The verdict travels as data and the widget words it in the view's language (#322 U3). */
describe("the verdict line and the hand-offs speak the view's language", () => {
  function renderIn(locale: string, data: EngineHealthData) {
    return render(
      <LocaleProvider locale={locale}>
        <TestViewHost tools={tools} client={queryClient}>
          <Widget data={data as never} />
        </TestViewHost>
      </LocaleProvider>,
    )
  }

  const ONE: EngineHealthData = {
    ...DEGRADED,
    summary: { ...DEGRADED.summary, totalIncidents: 1, affectedActivities: 1 },
  }
  const CAPPED: EngineHealthData = {
    ...DEGRADED,
    summary: { ...DEGRADED.summary, affectedActivities: null },
  }
  const EMPTY_ENGINE: EngineHealthData = {
    ...HEALTHY,
    summary: { ...HEALTHY.summary, runningInstances: 0, totalDefinitions: 0 },
  }
  const ONE_RUNNING: EngineHealthData = {
    ...HEALTHY,
    summary: { ...HEALTHY.summary, runningInstances: 1 },
  }

  it.each([
    ["en", DEGRADED, "51 open incidents across 3 activities"],
    ["de", DEGRADED, "51 offene Incidents in 3 Aktivitäten"],
    ["en", ONE, "1 open incident across 1 activity"],
    ["de", ONE, "1 offener Incident in 1 Aktivität"],
    // A capped scan leaves the activity count out instead of guessing it.
    ["en", CAPPED, "51 open incidents"],
    ["de", CAPPED, "51 offene Incidents"],
    ["en", HEALTHY, "No open incidents, 312 running instances"],
    ["de", HEALTHY, "Keine offenen Incidents bei 312 laufenden Instanzen"],
    ["de", ONE_RUNNING, "Keine offenen Incidents bei 1 laufender Instanz"],
    // An engine with nothing deployed says so, not "no open incidents".
    ["en", EMPTY_ENGINE, "No processes deployed"],
    ["de", EMPTY_ENGINE, "Keine Prozesse bereitgestellt"],
  ] as const)("%s: %s", (locale, data, line) => {
    renderIn(locale, data)
    expect(screen.getByText(line)).toBeTruthy()
  })

  it("a German view: German title, verdict, status badge and chat hand-offs, no English left", async () => {
    const { container } = renderIn("de", DEGRADED)
    expect(screen.getByRole("heading", { name: "default · Übersicht" })).toBeTruthy()
    expect(screen.getByText("Beeinträchtigt")).toBeTruthy()
    // The hand-offs name the chat and draw the icon of their function.
    const assess = await screen.findByRole("button", { name: "Im Chat bewerten" })
    expect(assess.querySelector("svg")!.getAttribute("class")).toContain("lucide-list-checks")
    const fixes = await screen.findAllByRole("button", { name: "Behebung im Chat planen" })
    expect(fixes).toHaveLength(2)
    expect(fixes[0].querySelector("svg")!.getAttribute("class")).toContain("lucide-wrench")
    for (const english of ["Engine overview", "open incidents", "Degraded", "Assess", "Refresh"]) {
      expect(container.textContent).not.toContain(english)
    }
    // No glyph icon and no sparkle anywhere in the view.
    expect(container.textContent).not.toMatch(/[✦↻⚠▶›]/)
  })

  it("a read-only deployment explains the cluster instead of planning a fix", async () => {
    render(
      <LocaleProvider locale="de">
        <TestViewHost
          tools={{ [ENGINE_WIDGET_ACTIONS_DATA]: await widgetActionsFeedFor("read-only") }}
          client={queryClient}
        >
          <Widget data={DEGRADED as never} />
        </TestViewHost>
      </LocaleProvider>,
    )
    const explain = await screen.findAllByRole("button", { name: "Fehler im Chat erklären" })
    expect(explain).toHaveLength(2)
    expect(explain[0].querySelector("svg")!.getAttribute("class")).toContain("lucide-file-search")
    expect(screen.queryByRole("button", { name: "Behebung im Chat planen" })).toBeNull()
  })
})
