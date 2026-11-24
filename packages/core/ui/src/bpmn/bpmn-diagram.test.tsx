// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { LocaleProvider, setFormatLocale } from "../index.js"
import { BpmnDiagram, type BpmnDiagramProps } from "./bpmn-diagram.js"
import type { DiagramCount, DiagramDecoration } from "./diagram-marks.js"

// bpmn-js needs a real SVG engine happy-dom lacks: a stand-in viewer that records what the
// diagram asks of it, over the elements its drawing holds.
const mock = vi.hoisted(() => {
  class FakeViewer {
    static instances: FakeViewer[] = []
    static elements: Array<{ id: string; type: string }> = []
    markers: Array<[string, string]> = []
    overlays: Array<{ id: string; position: object }> = []
    destroyed = false
    constructor(private readonly opts: { container: HTMLElement }) {
      FakeViewer.instances.push(this)
      opts.container.innerHTML = '<div class="djs-container"><svg tabindex="0"></svg></div>'
    }
    private known(id: string) {
      if (!FakeViewer.elements.some((element) => element.id === id)) {
        throw new Error(`no element ${id}`)
      }
    }
    importXML(xml: string): Promise<{ warnings: string[] }> {
      return xml.includes("invalid")
        ? Promise.reject(new Error("unparsable BPMN"))
        : Promise.resolve({ warnings: [] })
    }
    get(service: string): unknown {
      if (service === "canvas") {
        return {
          addMarker: (id: string, marker: string) => {
            this.known(id)
            this.markers.push([id, marker])
          },
          viewbox: () => ({ x: 0, y: 0, width: 600, height: 300, scale: 1 }),
          zoom: () => 1,
          resized: () => {},
          getContainer: () => this.opts.container,
          scroll: () => {},
        }
      }
      if (service === "overlays") {
        return {
          add: (id: string, overlay: { position: object; html: HTMLElement }) => {
            this.known(id)
            this.opts.container.querySelector(".djs-container")?.appendChild(overlay.html)
            this.overlays.push({ id, position: overlay.position })
          },
        }
      }
      if (service === "elementRegistry") return { getAll: () => FakeViewer.elements }
      return { on: () => {}, off: () => {} }
    }
    destroy() {
      this.destroyed = true
    }
  }
  return { FakeViewer }
})

vi.mock("bpmn-js/lib/NavigatedViewer", () => ({ default: mock.FakeViewer }))

const XML = `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
  <bpmn:process id="order" name="Order">
    <bpmn:userTask id="Task_Approve" name="Approve order" />
    <bpmn:callActivity id="Call_Ship" name="Ship order" />
    <bpmn:serviceTask id="Task_Charge" name="Charge payment" />
  </bpmn:process>
</bpmn:definitions>`

const DRAWN = [
  { id: "Task_Approve", type: "bpmn:UserTask" },
  { id: "Call_Ship", type: "bpmn:CallActivity" },
  { id: "Task_Charge", type: "bpmn:ServiceTask" },
]

/** The screens' decorations of an order process, a count's scope riding along. */
const DECORATIONS: (DiagramDecoration<DiagramCount & { readonly scope: string }> & {
  readonly call: null
})[] = [
  {
    elementId: "Task_Approve",
    counts: [
      { kind: "running", count: 3, scope: "running" },
      { kind: "incidents", count: 2, scope: "withIncident" },
    ],
    incident: true,
    call: null,
  },
  {
    elementId: "Call_Ship",
    counts: [
      { kind: "incidentsInCalledInstances", count: 1, scope: "withIncident" },
      { kind: "running", count: 1, scope: "running" },
    ],
    incident: false,
    call: null,
  },
  // An element of another version, which this drawing lacks.
  {
    elementId: "Task_Gone",
    counts: [{ kind: "running", count: 4, scope: "running" }],
    incident: true,
    call: null,
  },
]

const viewer = () => mock.FakeViewer.instances.at(-1)!

/** The badges of an element as drawn: each badge's kind and its figure. */
const badgesOf = (id: string) =>
  [...document.querySelectorAll(`[data-badge-for=${id}] [data-part=canvas-badge]`)].map((badge) => [
    badge.getAttribute("data-kind"),
    badge.textContent,
  ])

async function drawn(props: Partial<BpmnDiagramProps> = {}) {
  setFormatLocale({ language: "en", locale: "en-u-hc-h23", timeZone: "UTC" })
  mock.FakeViewer.elements = DRAWN
  const view = render(
    <BpmnDiagram xml={XML} ariaLabel="Order, version 2" decorations={DECORATIONS} {...props} />,
  )
  await waitFor(() => {
    expect(document.querySelector(".pulse-badge-anchor > *")).not.toBeNull()
  })
  return view
}

afterEach(() => {
  cleanup()
  mock.FakeViewer.instances.length = 0
  setFormatLocale(undefined)
})

describe("BpmnDiagram: the counts in the one badge scheme", () => {
  it("draws each element's counts apart over its top right corner, root incidents first", async () => {
    await drawn()
    expect(badgesOf("Task_Approve")).toEqual([
      ["incidents", "2"],
      ["running", "3"],
    ])
    expect(badgesOf("Call_Ship")).toEqual([
      ["incidentsInCalledInstances", "1"],
      ["running", "1"],
    ])
    // The incidents in called instances carry the incident's icon beside their figure.
    expect(document.querySelector("[data-kind=incidentsInCalledInstances] svg")).not.toBeNull()
    expect(viewer().overlays).toEqual([
      { id: "Task_Approve", position: { top: -10, right: -6 } },
      { id: "Call_Ship", position: { top: -10, right: -6 } },
    ])
  })

  it("skips an element the drawing lacks without an error", async () => {
    await drawn()
    expect(document.querySelector("[data-badge-for=Task_Gone]")).toBeNull()
    expect(screen.queryByText("The diagram couldn't be drawn")).toBeNull()
  })

  it("outlines an own root incident only, never counts alone or the incidents in called instances", async () => {
    await drawn()
    expect(viewer().markers).toEqual([["Task_Approve", "highlight-incident"]])
  })

  it("draws the counts as a drawing without a click: hidden, no button, said in words elsewhere", async () => {
    await drawn()
    const cluster = document.querySelector("[data-badge-for=Task_Approve]")!
    expect(cluster.getAttribute("aria-hidden")).toBe("true")
    expect(screen.queryAllByRole("button").map((button) => button.getAttribute("title"))).toEqual([
      "Zoom in",
      "Fit to viewport",
      "Zoom out",
    ])
  })

  it("makes each count a button with a click, named by its element and its figure", async () => {
    const onSelect = vi.fn<NonNullable<BpmnDiagramProps["onSelect"]>>()
    await drawn({ onSelect })
    expect(screen.getByRole("group", { name: "Approve order" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Approve order: 2 incidents" }))
    expect(onSelect).toHaveBeenLastCalledWith(
      { id: "Task_Approve", type: "bpmn:UserTask" },
      { kind: "incidents", count: 2, scope: "withIncident" },
      { toSide: false },
    )
    fireEvent.click(screen.getByRole("button", { name: "Ship order: 1 instance running" }), {
      ctrlKey: true,
    })
    expect(onSelect).toHaveBeenLastCalledWith(
      { id: "Call_Ship", type: "bpmn:CallActivity" },
      { kind: "running", count: 1, scope: "running" },
      { toSide: true },
    )
    expect(
      screen.getByRole("button", { name: "Ship order: 1 incident in called instances" }),
    ).toBeTruthy()
  })

  it("draws a count that leads nowhere without a button, its words for a screen reader", async () => {
    await drawn({
      onSelect: () => {},
      selectable: (element, count) => count.kind !== "running" || element.type === "bpmn:UserTask",
    })
    expect(screen.getByRole("button", { name: "Approve order: 3 instances running" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /^Ship order: 1 instance running/ })).toBeNull()
    const plain = document.querySelector("[data-badge-for=Call_Ship] [data-part=badge-plain]")!
    expect(plain.getAttribute("title")).toBe("Ship order: 1 instance running")
    expect(plain.textContent).toContain("Ship order: 1 instance running")
  })

  it("leads a count's name with the figure its badge shows where the words lack it", async () => {
    await drawn({
      onSelect: () => {},
      decorations: [
        { elementId: "Task_Charge", counts: [{ kind: "running", count: 1234 }], incident: false },
      ],
    })
    expect(badgesOf("Task_Charge")).toEqual([["running", "1.2k"]])
    expect(
      screen.getByRole("button", { name: "1.2k, Charge payment: 1,234 instances running" }),
    ).toBeTruthy()
  })

  it("names an element by the page's reader where it brings one, else by its id", async () => {
    await drawn({ onSelect: () => {}, nameOf: (id) => `name of ${id}` })
    expect(screen.getByRole("group", { name: "name of Task_Approve" })).toBeTruthy()
    cleanup()
    await drawn({ onSelect: () => {}, xml: "<bpmn:definitions/>" })
    expect(screen.getByRole("group", { name: "Task_Approve" })).toBeTruthy()
  })

  it("speaks the locale's words", async () => {
    setFormatLocale({ language: "de", locale: "de-DE", timeZone: "UTC" })
    mock.FakeViewer.elements = DRAWN
    render(
      <LocaleProvider locale="de">
        <BpmnDiagram
          xml={XML}
          ariaLabel="Bestellung"
          decorations={DECORATIONS}
          onSelect={vi.fn()}
        />
      </LocaleProvider>,
    )
    expect(
      await screen.findByRole("button", { name: "Approve order: 3 Instanzen laufen" }),
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "Approve order: 2 Incidents" })).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Ship order: 1 Incident in aufgerufenen Instanzen" }),
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "Vergrößern" })).toBeTruthy()
  })

  it("draws its counts neutral while stale", async () => {
    await drawn({ stale: true })
    const badges = [...document.querySelectorAll("[data-part=canvas-badge]")]
    expect(badges.length).toBeGreaterThan(0)
    expect(badges.every((badge) => badge.classList.contains("pulse-badge-stale"))).toBe(true)
  })
})

describe("BpmnDiagram: markers without counts", () => {
  it("outlines a wait, an open task and an incident, the strongest one an element", async () => {
    mock.FakeViewer.elements = DRAWN
    render(
      <BpmnDiagram
        xml={XML}
        ariaLabel="Instance"
        markers={[
          { elementId: "Task_Approve", kind: "running" },
          { elementId: "Task_Approve", kind: "openTask" },
          { elementId: "Call_Ship", kind: "running" },
          { elementId: "Task_Charge", kind: "incident" },
          { elementId: "Task_Charge", kind: "running" },
          { elementId: "Task_Gone", kind: "incident" },
        ]}
      />,
    )
    await waitFor(() => {
      expect(viewer().markers).toHaveLength(3)
    })
    expect(viewer().markers).toEqual([
      ["Task_Approve", "highlight-open-user-task"],
      ["Call_Ship", "highlight-running"],
      ["Task_Charge", "highlight-incident"],
    ])
  })
})

describe("BpmnDiagram: drawing anew", () => {
  it("changes a count in place and draws anew only when the decorated elements change", async () => {
    const { rerender } = await drawn()
    expect(mock.FakeViewer.instances).toHaveLength(1)
    act(() => {
      rerender(
        <BpmnDiagram
          xml={XML}
          ariaLabel="Order, version 2"
          decorations={[
            {
              ...DECORATIONS[0],
              counts: [
                { kind: "running", count: 4, scope: "running" },
                { kind: "incidents", count: 1, scope: "withIncident" },
              ],
            },
            ...DECORATIONS.slice(1),
          ]}
        />,
      )
    })
    expect(badgesOf("Task_Approve")).toEqual([
      ["incidents", "1"],
      ["running", "4"],
    ])
    expect(mock.FakeViewer.instances).toHaveLength(1)
    act(() => {
      rerender(
        <BpmnDiagram xml={XML} ariaLabel="Order, version 2" decorations={DECORATIONS.slice(1)} />,
      )
    })
    await waitFor(() => {
      expect(mock.FakeViewer.instances).toHaveLength(2)
    })
    expect(mock.FakeViewer.instances[0].destroyed).toBe(true)
    await waitFor(() => {
      expect(document.querySelector("[data-badge-for=Call_Ship]")).not.toBeNull()
    })
    expect(document.querySelector("[data-badge-for=Task_Approve]")).toBeNull()
  })

  it("hands a surface the viewer after each drawing, its cleanup before the next, anew on its key", async () => {
    const cleanups: string[] = []
    const onDrawn = vi.fn(() => () => {
      cleanups.push("down")
    })
    const { rerender } = await drawn({ onDrawn, redrawKey: "a" })
    expect(onDrawn).toHaveBeenCalledTimes(1)
    expect(onDrawn.mock.calls[0]).toHaveLength(1)
    act(() => {
      rerender(
        <BpmnDiagram
          xml={XML}
          ariaLabel="Order, version 2"
          decorations={DECORATIONS}
          onDrawn={onDrawn}
          redrawKey="b"
        />,
      )
    })
    await waitFor(() => {
      expect(onDrawn).toHaveBeenCalledTimes(2)
    })
    expect(cleanups).toEqual(["down"])
  })

  it("draws a surface's own counts in each anchor, and lays its children over the canvas", async () => {
    await drawn({
      renderCounts: ({ element, counts, elementName, stale }) => (
        <span data-testid={`own-${element.id}`}>
          {`${elementName} ${element.type} ${counts.map((c: DiagramCount) => c.kind).join(",")} ${String(stale)}`}
        </span>
      ),
      children: <p>an overlay of the page</p>,
    })
    expect(screen.getByTestId("own-Task_Approve").textContent).toBe(
      "Approve order bpmn:UserTask incidents,running false",
    )
    expect(document.querySelector(".badge-cluster")).toBeNull()
    expect(screen.getByText("an overlay of the page")).toBeTruthy()
  })
})

describe("BpmnDiagram: its frame", () => {
  const frame = () => document.querySelector<HTMLElement>("[data-slot=bpmn-diagram]")!
  const canvas = () => document.querySelector<HTMLElement>("[data-slot=bpmn-canvas]")!

  it("takes the diagram's own height, capped by an inline budget, a fixed one, or its box's", async () => {
    const { rerender } = await drawn()
    expect(frame().style.height).toBe("360px")
    rerender(<BpmnDiagram xml={XML} ariaLabel="Order" decorations={DECORATIONS} maxHeight={320} />)
    expect(frame().style.height).toBe("320px")
    rerender(<BpmnDiagram xml={XML} ariaLabel="Order" decorations={DECORATIONS} height={318} />)
    expect(frame().style.height).toBe("318px")
    rerender(<BpmnDiagram xml={XML} ariaLabel="Order" decorations={DECORATIONS} height="fill" />)
    expect(frame().style.height).toBe("")
    expect(frame().className).toContain("h-full")
  })

  it("draws a border around its canvas unless the box it sits in draws one", async () => {
    const { rerender } = await drawn()
    expect(canvas().className).toContain("border")
    rerender(<BpmnDiagram xml={XML} ariaLabel="Order" decorations={DECORATIONS} framed={false} />)
    expect(canvas().className).not.toContain("border")
  })

  it("names its canvas as the image, the zoom bar beside it", async () => {
    await drawn()
    expect(screen.getByRole("img", { name: "Order, version 2" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Fit to viewport" })).toBeTruthy()
  })

  it("says a drawing that failed, bpmn-js's own text under Details", async () => {
    mock.FakeViewer.elements = DRAWN
    const { rerender } = render(<BpmnDiagram xml="invalid" ariaLabel="Order" />)
    expect(await screen.findByText("The diagram couldn't be drawn")).toBeTruthy()
    expect(screen.getByText("Open the model in your modeler to check it.")).toBeTruthy()
    expect(screen.getByText("unparsable BPMN")).toBeTruthy()
    rerender(<BpmnDiagram xml="invalid" ariaLabel="Order" drawFailed="The page's own words." />)
    expect(screen.getByText("The page's own words.")).toBeTruthy()
    expect(screen.queryByText("Open the model in your modeler to check it.")).toBeNull()
  })
})
