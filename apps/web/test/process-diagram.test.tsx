// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useDiagramDecorations } from "@miragon/pulse-blocks"
import type { ElementBadgeData, ProcessScreenData } from "@miragon/pulse-screens"
import { setFormatLocale } from "@miragon/pulse-ui"
import { TestViewHost } from "@miragon/pulse-widget-shell/widgets"
import { ProcessDiagram } from "../src/screens/process/process-diagram.js"
import { drawElements, drawn, failImports, reset } from "./bpmn-viewer.test-support.js"

/**
 * The process screen's diagram over a stand-in of bpmn-js's viewer (bpmn-js draws in a real browser
 * alone, test:web) under pulse-ui's `BpmnDiagram`: each element's counts apart as the blocks'
 * cluster with the kit's badge, the outline of an element with a root incident marked, each call
 * activity's button, the element the list is filtered to ringed and the ring moved without drawing
 * anew, the elements the drawing lacks left alone, and a drawing that failed said so.
 */

vi.mock("bpmn-js/lib/NavigatedViewer", async () => ({
  default: (await import("./bpmn-viewer.test-support.js")).FakeViewer,
}))

/** The elements of the drawing: what the canvas knows. */
const ELEMENTS = ["Task_Review", "Call_Label", "Call_Ship", "Task_Charge"].map((id) => ({
  id,
  type: id.startsWith("Call_") ? "bpmn:CallActivity" : "bpmn:Task",
}))

/** Lets the viewer's import land: bpmn-js imports a diagram asynchronously. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

afterEach(() => {
  cleanup()
  reset()
})

const BADGES: ElementBadgeData[] = [
  { elementId: "Task_Charge", running: 3, incidents: 2, incidentsInCalledInstances: 0 },
  { elementId: "Call_Label", running: 1, incidents: 0, incidentsInCalledInstances: 1 },
  { elementId: "Task_Gone", running: 4, incidents: 1, incidentsInCalledInstances: 0 },
  { elementId: "Task_Idle", running: 0, incidents: 0, incidentsInCalledInstances: 0 },
]

const SCREEN: Pick<ProcessScreenData, "badges" | "calls"> = {
  badges: BADGES,
  calls: [
    {
      elementId: "Call_Label",
      kind: "definition",
      definition: { id: "label:1", bpmnProcessId: "label", version: 1, name: "Print label" },
    },
    { elementId: "Call_Ship", kind: "missing", bpmnProcessId: "ship" },
    {
      elementId: "Call_Gone",
      kind: "definition",
      definition: { id: "gone:1", bpmnProcessId: "gone", version: 1 },
    },
  ],
}

interface Handlers {
  readonly onSelect: (elementId: string, scope: string) => void
  readonly onOpenCall: (href: string) => void
}

/** The diagram as the screen draws it, the element the list is filtered to its own state. */
function Diagram({
  screen: data,
  first,
  stale,
  handlers,
}: {
  readonly screen: Pick<ProcessScreenData, "badges" | "calls">
  readonly first: string | undefined
  readonly stale: boolean
  readonly handlers: Handlers
}) {
  const decorations = useDiagramDecorations(data)
  const [selected, setSelected] = useState(first)
  return (
    <>
      <button type="button" onClick={() => setSelected("Task_Review")}>
        Select review
      </button>
      <button type="button" onClick={() => setSelected(undefined)}>
        Select none
      </button>
      <ProcessDiagram
        engine="prod-a"
        xml="<definitions/>"
        decorations={decorations}
        badges={data.badges}
        selected={selected}
        stale={stale}
        label="Diagram of Order v2"
        nameOf={(id) => `name of ${id}`}
        fill={false}
        onSelect={handlers.onSelect}
        onOpenCall={handlers.onOpenCall}
      />
    </>
  )
}

async function renderDiagram(
  { first, stale = false }: { first?: string; stale?: boolean } = {},
  data: Pick<ProcessScreenData, "badges" | "calls"> = SCREEN,
) {
  setFormatLocale({ language: "en", locale: "en-u-hc-h23", timeZone: "UTC" })
  drawElements(ELEMENTS)
  const handlers = { onSelect: vi.fn(), onOpenCall: vi.fn() }
  const view = render(
    <TestViewHost tools={{}} writes={false} followUp="none" startPage="/app">
      <Diagram screen={data} first={first} stale={stale} handlers={handlers} />
    </TestViewHost>,
  )
  await settle()
  return { ...view, handlers }
}

describe("the process screen's diagram", () => {
  it("draws each element's counts apart, root incidents first, on the elements the drawing has", async () => {
    await renderDiagram()
    const clusters = [...document.querySelectorAll<HTMLElement>("[data-badge-for]")]
    expect(clusters.map((cluster) => cluster.dataset.badgeFor)).toEqual([
      "Task_Charge",
      "Call_Label",
    ])
    const counts = (id: string) =>
      [...document.querySelectorAll(`[data-badge-for=${id}] [data-part=canvas-badge]`)].map(
        (badge) => [badge.getAttribute("data-kind"), badge.textContent],
      )
    expect(counts("Task_Charge")).toEqual([
      ["incidents", "2"],
      ["running", "3"],
    ])
    expect(counts("Call_Label")).toEqual([
      ["incidentsInCalledInstances", "1"],
      ["running", "1"],
    ])
    // The incidents in called instances carry the incident's icon beside their count.
    expect(document.querySelector("[data-kind=incidentsInCalledInstances] svg")).not.toBeNull()
    expect(drawn.overlays.filter(({ id }) => id === "Task_Charge")[0]?.position).toEqual({
      top: -10,
      right: -6,
    })
    expect(screen.getByRole("group", { name: "name of Task_Charge" })).toBeTruthy()
    expect(
      screen.getByRole("button", {
        name: "name of Task_Charge: 2 incidents. Show the instances with an incident here.",
      }),
    ).toBeTruthy()
  })

  it("marks the outline of an element with a root incident, never one with incidents in called instances alone", async () => {
    await renderDiagram()
    expect(drawn.markers).toEqual([["Task_Charge", "highlight-incident", "add"]])
  })

  it("filters the list to an element and its count's scope on a count's click", async () => {
    const { handlers } = await renderDiagram()
    fireEvent.click(screen.getByRole("button", { name: /^name of Task_Charge: 2 incidents/ }))
    expect(handlers.onSelect).toHaveBeenLastCalledWith("Task_Charge", "withIncident")
    fireEvent.click(
      screen.getByRole("button", { name: /^name of Task_Charge: 3 instances running/ }),
    )
    expect(handlers.onSelect).toHaveBeenLastCalledWith("Task_Charge", "running")
  })

  it("gives each call activity its link to the version it calls, a process the engine lacks marked as missing", async () => {
    const { handlers } = await renderDiagram()
    const label = screen.getByRole("link", { name: "Open called process Print label" })
    expect(label.getAttribute("data-call-for")).toBe("Call_Label")
    expect(label.getAttribute("href")).toBe("/app/engines/prod-a/processes/label?version=1")
    fireEvent.click(label)
    expect(handlers.onOpenCall).toHaveBeenLastCalledWith(
      "/app/engines/prod-a/processes/label?version=1",
    )
    const ship = screen.getByRole("button", { name: /ship isn't deployed on prod-a/ })
    expect(ship.getAttribute("data-state")).toBe("missing")
    expect(ship.getAttribute("aria-disabled")).toBe("true")
    expect(drawn.overlays.find(({ id }) => id === "Call_Ship")?.position).toEqual({
      bottom: 22,
      right: 22,
    })
    // A call activity the drawing lacks gets no button.
    expect(document.querySelector("[data-call-for=Call_Gone]")).toBeNull()
  })

  it("rings the element the list is filtered to, and moves the ring without drawing anew", async () => {
    await renderDiagram({ first: "Task_Charge" })
    expect(drawn.markers).toContainEqual(["Task_Charge", "pulse-selected", "add"])
    fireEvent.click(screen.getByRole("button", { name: "Select review" }))
    expect(drawn.markers.slice(-2)).toEqual([
      ["Task_Charge", "pulse-selected", "remove"],
      ["Task_Review", "pulse-selected", "add"],
    ])
    fireEvent.click(screen.getByRole("button", { name: "Select none" }))
    expect(drawn.markers.at(-1)).toEqual(["Task_Review", "pulse-selected", "remove"])
    expect(drawn.imports).toBe(1)
  })

  it("leaves an element the drawing lacks unringed", async () => {
    await renderDiagram({ first: "Task_Gone" })
    expect(drawn.markers.filter(([, marker]) => marker === "pulse-selected")).toEqual([])
  })

  it("draws no counts on an element the screen's badges no longer hold", async () => {
    setFormatLocale({ language: "en", locale: "en-u-hc-h23", timeZone: "UTC" })
    drawElements(ELEMENTS)
    function Behind() {
      // The decorations of a read before the badges of the next: a count with no badge behind it.
      const decorations = useDiagramDecorations(SCREEN)
      return (
        <ProcessDiagram
          engine="prod-a"
          xml="<definitions/>"
          decorations={decorations}
          badges={BADGES.slice(1)}
          selected={undefined}
          stale={false}
          label="Diagram of Order v2"
          nameOf={(id) => `name of ${id}`}
          fill={false}
          onSelect={vi.fn()}
          onOpenCall={vi.fn()}
        />
      )
    }
    render(
      <TestViewHost tools={{}} writes={false} followUp="none" startPage="/app">
        <Behind />
      </TestViewHost>,
    )
    await settle()
    expect(
      [...document.querySelectorAll<HTMLElement>("[data-badge-for]")].map(
        (cluster) => cluster.dataset.badgeFor,
      ),
    ).toEqual(["Call_Label"])
  })

  it("draws its counts quiet while a refresh reads them", async () => {
    await renderDiagram({ stale: true })
    expect(
      [...document.querySelectorAll("[data-part=canvas-badge]")].every((badge) =>
        badge.classList.contains("pulse-badge-stale"),
      ),
    ).toBe(true)
  })

  it("says a drawing that failed in the page's words, at the diagram's own height", async () => {
    failImports("unparsable")
    await renderDiagram()
    expect(screen.getByText("The diagram couldn't be drawn.")).toBeTruthy()
    expect(screen.getByText("unparsable")).toBeTruthy()
    // No DI to size it by: the kit's default height.
    expect(document.querySelector<HTMLElement>("[data-slot=bpmn-diagram]")?.style.height).toBe(
      "360px",
    )
  })

  it("shows a count and a call target that changed in place, without drawing anew", async () => {
    const { rerender, handlers } = await renderDiagram()
    const changed: Pick<ProcessScreenData, "badges" | "calls"> = {
      badges: [
        { elementId: "Task_Charge", running: 4, incidents: 1, incidentsInCalledInstances: 0 },
        ...BADGES.slice(1),
      ],
      calls: [
        {
          elementId: "Call_Label",
          kind: "definition",
          definition: { id: "label:2", bpmnProcessId: "label", version: 2, name: "Parcel label" },
        },
        ...SCREEN.calls.slice(1),
      ],
    }
    act(() => {
      rerender(
        <TestViewHost tools={{}} writes={false} followUp="none" startPage="/app">
          <Diagram screen={changed} first={undefined} stale={false} handlers={handlers} />
        </TestViewHost>,
      )
    })
    await settle()
    expect(
      [...document.querySelectorAll("[data-badge-for=Task_Charge] [data-part=canvas-badge]")].map(
        (badge) => badge.textContent,
      ),
    ).toEqual(["1", "4"])
    expect(
      screen.getByRole("link", { name: "Open called process Parcel label" }).getAttribute("href"),
    ).toBe("/app/engines/prod-a/processes/label?version=2")
    expect(drawn.imports).toBe(1)
  })

  it("draws anew when the elements it decorates change, and takes its overlays down before", async () => {
    const { rerender, handlers } = await renderDiagram()
    act(() => {
      rerender(
        <TestViewHost tools={{}} writes={false} followUp="none" startPage="/app">
          <Diagram
            screen={{ badges: [], calls: [] }}
            first={undefined}
            stale={false}
            handlers={handlers}
          />
        </TestViewHost>,
      )
    })
    await settle()
    expect(drawn.imports).toBe(2)
    expect(document.querySelector("[data-badge-for]")).toBeNull()
  })
})
