// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react"
import { useEffect, useRef } from "react"
import type * as Widgets from "@miragon/pulse-widget-shell/widgets"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { CallLinkData, MarkerData } from "@miragon/pulse-screens"
import {
  TestViewHost,
  type UseBpmnViewerOptions,
  type UseBpmnViewerResult,
} from "@miragon/pulse-widget-shell/widgets"
import { InstanceDiagram } from "../src/screens/instance/instance-diagram.js"

/**
 * The instance screen's diagram over a stand-in of the kit's BPMN viewer (bpmn-js draws in a real
 * browser alone, test:web): which marker each element gets, the element in focus selected and in
 * the middle, each call activity's way to what it called, the elements the drawing lacks left
 * alone, and a drawing that failed said so.
 */

interface Drawn {
  markers: Array<[string, string]>
  overlays: Array<{ id: string; position: object; html: HTMLElement }>
  viewboxes: object[]
}

const drawn: Drawn = { markers: [], overlays: [], viewboxes: [] }
let importError: string | null = null

/** The elements of the drawing, by id, with their boxes: what the canvas knows. */
const ELEMENTS = [
  { id: "Task_A", x: 100, y: 100, width: 100, height: 80 },
  { id: "Call_One", x: 300, y: 100, width: 100, height: 80 },
  { id: "Call_Many", x: 500, y: 100, width: 100, height: 80 },
  { id: "Call_Version", x: 700, y: 100, width: 100, height: 80 },
  { id: "Call_None", x: 900, y: 100, width: 100, height: 80 },
  { id: "Call_Missing", x: 1100, y: 100, width: 100, height: 80 },
  { id: "Call_Unnamed", x: 1300, y: 100, width: 100, height: 80 },
  { id: "Event_Point", x: 50, y: 60 },
  { id: "Flow_Unplaced" },
]

/** A drawing's services as bpmn-js hands them over, recording what the screen paints. */
function fakeViewer(layer: HTMLElement) {
  const known = (id: string) => ELEMENTS.some((element) => element.id === id)
  return {
    get: (service: string) => {
      switch (service) {
        case "canvas":
          return {
            addMarker: (id: string, marker: string) => {
              if (!known(id)) throw new Error(`no element ${id}`)
              drawn.markers.push([id, marker])
            },
            viewbox: (box?: object) => {
              if (box !== undefined) drawn.viewboxes.push(box)
              return { x: 0, y: 0, width: 1000, height: 500, scale: 1 }
            },
          }
        case "overlays":
          return {
            add: (id: string, overlay: { position: object; html: HTMLElement }) => {
              if (!known(id)) throw new Error(`no element ${id}`)
              layer.appendChild(overlay.html)
              drawn.overlays.push({ id, ...overlay })
            },
          }
        default:
          return { getAll: () => ELEMENTS }
      }
    },
  }
}

vi.mock("@miragon/pulse-widget-shell/widgets", async (original) => ({
  ...(await original<typeof Widgets>()),
  useBpmnViewer: (options: UseBpmnViewerOptions): UseBpmnViewerResult => {
    const containerRef = useRef<HTMLDivElement>(null)
    const { onImported, reimportKey } = options
    // Read at the drawing, as the kit's viewer reads it: drawn again where the screen's key moves.
    const imported = useRef(onImported)
    useEffect(() => {
      imported.current = onImported
    })
    useEffect(() => {
      const layer = containerRef.current
      if (layer === null) return undefined
      const cleanup = imported.current?.(fakeViewer(layer) as never)
      return typeof cleanup === "function" ? cleanup : undefined
    }, [reimportKey])
    return {
      containerRef,
      height: 320,
      importError,
      zoomIn: () => {},
      zoomOut: () => {},
      fit: () => {},
    }
  },
}))

afterEach(() => {
  cleanup()
  drawn.markers = []
  drawn.overlays = []
  drawn.viewboxes = []
  importError = null
})

const MARKERS: MarkerData[] = [
  { elementId: "Task_A", kind: "completed" },
  { elementId: "Call_One", kind: "incidentInCalledInstance" },
  { elementId: "Call_Many", kind: "waiting" },
  { elementId: "Call_Version", kind: "incident" },
  { elementId: "Gone_From_Diagram", kind: "waiting" },
]

const CALLS: CallLinkData[] = [
  {
    elementId: "Call_One",
    kind: "instances",
    instances: [
      { id: "child-1", bpmnProcessId: "pulse-label", state: "running", withIncident: true },
    ],
  },
  {
    elementId: "Call_Many",
    kind: "instances",
    instances: [
      { id: "child-2", bpmnProcessId: "pulse-label", state: "running", withIncident: true },
      { id: "child-3", bpmnProcessId: "pulse-label", state: "completed", withIncident: false },
    ],
  },
  {
    elementId: "Call_Version",
    kind: "definition",
    definition: {
      id: "pulse-label:2",
      bpmnProcessId: "pulse-label",
      version: 2,
      name: "Print label",
    },
  },
  { elementId: "Call_None", kind: "instances", instances: [] },
  { elementId: "Call_Missing", kind: "missing", bpmnProcessId: "pulse-gone" },
  {
    elementId: "Call_Unnamed",
    kind: "definition",
    definition: { id: "pulse-ship:1", bpmnProcessId: "pulse-ship", version: 1 },
  },
  {
    elementId: "Gone_From_Diagram",
    kind: "definition",
    definition: { id: "pulse-label:2", bpmnProcessId: "pulse-label", version: 2 },
  },
]

function renderDiagram({ focus, fill = true }: { focus?: string; fill?: boolean } = {}) {
  const navigate = vi.fn<(url: string) => void>()
  render(
    <TestViewHost tools={{}} locale="en" writes={false} followUp="none">
      <InstanceDiagram
        engine="prod-a"
        xml="<bpmn/>"
        markers={MARKERS}
        calls={CALLS}
        {...(focus === undefined ? {} : { focus })}
        label="Diagram of Dispatch order v1"
        nameOf={(id) => `name of ${id}`}
        fill={fill}
        navigate={navigate}
        slots={{ Link: ({ children }) => <a href="#called">{children}</a> }}
      />
    </TestViewHost>,
  )
  return { navigate }
}

describe("the instance screen's diagram", () => {
  it("marks each element as the screen says, the drawing's own elements alone", () => {
    renderDiagram()
    expect(drawn.markers).toEqual([
      ["Task_A", "pulse-completed"],
      ["Call_One", "pulse-incident-called"],
      ["Call_Many", "highlight-running"],
      ["Call_Version", "highlight-incident"],
    ])
    expect(drawn.viewboxes).toEqual([])
  })

  it("gives each call activity its way to what it called: an instance, a menu of several, a version", () => {
    renderDiagram()
    expect(drawn.overlays.map(({ id, position }) => [id, position])).toEqual([
      ["Call_One", { bottom: 24, right: 24 }],
      ["Call_Many", { bottom: -6, left: 0 }],
      ["Call_Version", { bottom: 24, right: 24 }],
      ["Call_None", { bottom: 24, right: 24 }],
      ["Call_Missing", { bottom: 24, right: 24 }],
      ["Call_Unnamed", { bottom: 24, right: 24 }],
    ])
    const one = screen.getByRole("link", {
      name: "Open the instance child-1 that name of Call_One called",
    })
    expect(one.getAttribute("href")).toBe("/app/engines/prod-a/instances/child-1")
    expect(
      screen.getByRole("button", { name: "2 called instances at name of Call_Many" }),
    ).toBeTruthy()
    const version = screen.getByRole("link", {
      name: "Open Print label v2, called at name of Call_Version",
    })
    expect(version.getAttribute("href")).toBe("/app/engines/prod-a/processes/pulse-label")
    // A process the engine lacks has no way, nor has a call activity that called nothing yet.
    expect(
      screen.getByRole("link", { name: "Open pulse-ship v1, called at name of Call_Unnamed" }),
    ).toBeTruthy()
    expect(document.querySelectorAll("[data-part=call-button]")).toHaveLength(3)
  })

  it("selects the element in focus and puts it in the middle of the canvas", () => {
    renderDiagram({ focus: "Call_One" })
    expect(drawn.markers).toContainEqual(["Call_One", "pulse-selected"])
    expect(drawn.viewboxes).toEqual([{ x: -150, y: -110, width: 1000, height: 500 }])
  })

  it("centres a focus the drawing places as a point", () => {
    renderDiagram({ focus: "Event_Point" })
    expect(drawn.viewboxes).toEqual([{ x: -450, y: -190, width: 1000, height: 500 }])
  })

  it("leaves the canvas where it is for a focus the drawing does not place", () => {
    renderDiagram({ focus: "Flow_Unplaced", fill: false })
    expect(drawn.viewboxes).toEqual([])
    cleanup()
    renderDiagram({ focus: "Not_In_The_Drawing" })
    expect(drawn.viewboxes).toEqual([])
    cleanup()
    renderDiagram({ focus: "Flow_Unplaced", fill: false })
    expect(document.querySelector<HTMLElement>("[data-slot=instance-diagram]")?.style.height).toBe(
      "320px",
    )
  })

  it("says so where the drawing failed", () => {
    importError = "bad XML"
    renderDiagram()
    expect(screen.getByText("The diagram couldn't be drawn.")).toBeTruthy()
  })
})
