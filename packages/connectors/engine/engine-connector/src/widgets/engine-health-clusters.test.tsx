// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { formatCount } from "@miragon/pulse-ui"
import { TestViewHost, createTestQueryClient } from "@miragon/pulse-widget-shell/widgets"
import { EngineHealthVerdict } from "./engine-health.js"
import type { EngineHealthData } from "../view-models.js"
import { ENGINE_WIDGET_ACTIONS_DATA } from "../tool-names.js"
import { DEGRADED } from "./engine-health.test-support.js"
import { widgetActionsFeedFor } from "./lib/hand-off.test-support.js"
import { NavProvider, type NavIntent } from "./navigation.js"

/**
 * The overview's top failures (V8, X11, A13, N12): one table, a row per cause that opens its
 * cluster on a click or Enter and copies its activity's id, the type as the kit's state label, the
 * counts neutral, the hand-off at the row's end, and no "Open" whose name says another thing.
 */

let queryClient = createTestQueryClient()

afterEach(() => {
  cleanup()
  queryClient = createTestQueryClient()
})

let tools: Record<string, unknown>
beforeAll(async () => {
  tools = { [ENGINE_WIDGET_ACTIONS_DATA]: await widgetActionsFeedFor("operations") }
})

const Widget = ({ data }: { data: EngineHealthData }) => (
  <EngineHealthVerdict data={data} engine="default" />
)

describe("the overview's top failures", { timeout: 15_000 }, () => {
  it("names each view's top failures table by its heading, one region each, two views included", () => {
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
    // The table's region carries the heading's name: one landmark per view, never a section and
    // a region of the same name nested in it.
    const regions = screen.getAllByRole("region", { name: "Top failures, grouped by cause" })
    expect(regions).toHaveLength(2)
    for (const region of regions) {
      expect(within(region).getAllByRole("row", { name: /^Failures at / })).toHaveLength(2)
    }
  })

  it("opens a cluster from its row on a click or Enter and copies its activity's id", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
    const go = vi.fn<(intent: NavIntent) => void>()
    render(
      <TestViewHost tools={tools} client={queryClient}>
        <NavProvider value={go}>
          <Widget data={DEGRADED as never} />
        </NavProvider>
      </TestViewHost>,
    )
    const row = screen.getByRole("row", { name: "Failures at callWMS" })
    fireEvent.click(within(row).getByText("callWMS"))
    fireEvent.keyDown(row, { key: "Enter" })
    const cluster = {
      type: "cluster-detail",
      activityId: "callWMS",
      incidentType: "failedExternalTask",
      messageSignature: "connection timeout to wms",
      label: undefined,
    }
    expect(go.mock.calls.map(([intent]) => intent)).toEqual([cluster, cluster])
    // The hand-off at the row's end opens nothing.
    fireEvent.click((await within(row).findAllByRole("button"))[0])
    expect(go).toHaveBeenCalledTimes(2)
    fireEvent.keyDown(row, { key: "c", ctrlKey: true })
    expect(await screen.findByText("ID copied")).toBeTruthy()
    expect(writeText).toHaveBeenCalledWith("callWMS")
  })

  // A failed widget-actions feed keeps the hand-offs; the gate stays closed, so the clusters diagnose.
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
    const cluster = screen.getByRole("row", { name: "Failures at Call warehouse" })
    // The BPMN id quiet beside the name; the cause and the process follow.
    expect(within(cluster).getByText("callWMS")).toBeTruthy()
    expect(within(cluster).getAllByText("Connection timeout to WMS").length).toBeGreaterThan(0)
    expect(within(cluster).getByText("Shipping")).toBeTruthy()
    // The type is the kit's state label, the row's one alarm sign, never a chip built by hand.
    const type = within(cluster).getByText("Failed external task").closest("[data-slot]")!
    expect(type.getAttribute("data-slot")).toBe("state-label")
    // The counts stay neutral numbers beside it.
    expect(within(cluster).getByText("40").closest("[data-tone]")).toBeNull()
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

    const row = screen.getByRole("row", { name: "Failures at callWMS" })
    // Every cell, the ones a narrow region hides included (happy-dom measures no region).
    const cells = row.querySelectorAll("td")
    expect(cells[2].textContent).toBe(formatCount({ atLeast: 1400 }))
    // An unknown 24h count is "—", never "0".
    expect(cells[3].textContent).toBe("—")
  })
})
