// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import {
  DIAGRAM_MAX_HEIGHT,
  DIAGRAM_MIN_HEIGHT,
  diagramBoundsFromXml,
  diagramHeight,
  useBpmnViewer,
} from "./use-bpmn-viewer.js"

// bpmn-js needs a real SVG engine happy-dom lacks; the full lifecycle suite runs in the camunda7 connector.
const mock = vi.hoisted(() => {
  /** Viewbox cached on first read and dropped only by `resized()` (Canvas.js 15.27). */
  class FakeCanvas {
    static inner = { x: 150, y: 80, width: 400, height: 700 }
    cached: { outer: { width: number; height: number } } | null = null
    level = 1
    fits: Array<{ outerHeight: number; scale: number; center: unknown }> = []
    constructor(private readonly container: HTMLElement) {}
    private size() {
      return {
        width: this.container.clientWidth,
        height: Number.parseFloat(this.container.style.height) || 0,
      }
    }
    viewbox() {
      this.cached ??= { outer: this.size() }
      return {
        x: 0,
        y: 0,
        width: this.cached.outer.width,
        height: this.cached.outer.height,
        scale: this.level,
        inner: FakeCanvas.inner,
        outer: this.cached.outer,
      }
    }
    resized() {
      this.cached = null
    }
    zoom(arg?: "fit-viewport" | number, center?: unknown): number {
      if (arg === undefined) return this.level
      if (arg === "fit-viewport") {
        const { outer, inner } = this.viewbox()
        this.level = Math.min(1, outer.width / inner.width, outer.height / inner.height)
        this.fits.push({ outerHeight: outer.height, scale: this.level, center })
        // Setting the viewbox re-reads the size and refills the cache.
        this.cached = { outer: this.size() }
        return this.level
      }
      this.level = arg
      return this.level
    }
  }

  class MockViewer {
    static containers: HTMLElement[] = []
    static canvases: FakeCanvas[] = []
    canvas: FakeCanvas
    constructor(opts: { container: HTMLElement }) {
      MockViewer.containers.push(opts.container)
      this.canvas = new FakeCanvas(opts.container)
      MockViewer.canvases.push(this.canvas)
    }
    importXML(): Promise<{ warnings: string[] }> {
      return Promise.resolve({ warnings: [] })
    }
    get(): unknown {
      return this.canvas
    }
    destroy() {}
  }
  return { MockViewer, FakeCanvas }
})

vi.mock("bpmn-js/lib/NavigatedViewer", () => ({ default: mock.MockViewer }))

const XML = "<bpmn:definitions/>"

/** The test-host's invoice diagram, reduced to its DI: x 129–590, y 102–319. */
const INVOICE_DI = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="d">
  <bpmn:process id="invoice" />
  <bpmndi:BPMNDiagram id="main">
    <bpmndi:BPMNPlane id="p" bpmnElement="invoice">
      <bpmndi:BPMNShape id="s1" bpmnElement="start">
        <dc:Bounds x="152" y="182" width="36" height="36" />
        <bpmndi:BPMNLabel><dc:Bounds x="129" y="225" width="83" height="14" /></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="s2" bpmnElement="paid">
        <dc:Bounds x="532" y="102" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="s3" bpmnElement="rejected">
        <bpmndi:BPMNLabel><dc:Bounds x="510" y="305" width="80" height="14" /></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="e1" bpmnElement="flow">
        <di:waypoint x="440" y="225" />
        <di:waypoint x="532" y="280" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
  <bpmndi:BPMNDiagram id="drilldown">
    <bpmndi:BPMNPlane id="p2" bpmnElement="sub">
      <bpmndi:BPMNShape id="far" bpmnElement="x"><dc:Bounds x="5000" y="5000" width="10" height="10" /></bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`

/** Starts with a themed card background, the way a new BPMN widget would. */
function Diagram({
  xml,
  element = "a",
  loading = false,
}: {
  xml: string
  element?: string
  /** Still loading: the container is not rendered, the ref stays unattached. */
  loading?: boolean
}) {
  const { containerRef } = useBpmnViewer({ bpmnXml: xml })
  if (loading) return <p>Loading…</p>
  return <div key={element} ref={containerRef} className="bg-card" data-testid="canvas" />
}

function Framed({ xml, fitOnResize = false }: { xml: string; fitOnResize?: boolean }) {
  const { containerRef, height } = useBpmnViewer({ bpmnXml: xml, fitOnResize })
  return <div ref={containerRef} data-testid="canvas" style={{ height: `${height}px` }} />
}

const canvas = () => screen.getByTestId("canvas")

function expectLightCanvas(el: HTMLElement) {
  expect(el.style.getPropertyValue("background-color")).toBe("var(--cd-weiss)")
  expect(el.getAttribute("data-theme-mode")).toBe("light")
  expect(el.style.getPropertyValue("color-scheme")).toBe("light")
}

afterEach(() => {
  cleanup()
  mock.MockViewer.containers.length = 0
  mock.MockViewer.canvases.length = 0
  document.documentElement.classList.remove("dark")
})

describe("useBpmnViewer canvas (#339, N122)", () => {
  it("paints the container as the fixed light canvas in a dark document — no call site opts in", async () => {
    document.documentElement.classList.add("dark")
    render(<Diagram xml={XML} />)

    await waitFor(() => expect(mock.MockViewer.containers).toEqual([canvas()]))
    expectLightCanvas(canvas())
  })

  it("paints before any viewer exists, and again when the ref moves to a new element", () => {
    const { rerender } = render(<Diagram xml="" />)
    expect(mock.MockViewer.containers).toEqual([])
    const first = canvas()
    expectLightCanvas(first)

    rerender(<Diagram xml="" element="b" />)
    expect(canvas()).not.toBe(first)
    expectLightCanvas(canvas())
  })

  it("waits for a container a loading widget has not rendered yet", () => {
    const { rerender } = render(<Diagram xml={XML} loading />)
    expect(screen.queryByTestId("canvas")).toBeNull()

    rerender(<Diagram xml={XML} />)
    expectLightCanvas(canvas())
  })
})

describe("diagramHeight (U20: the frame follows the diagram, 240–560 px)", () => {
  it("fits a diagram wider than the container at the container width, plus room for the zoom bar", () => {
    // Scaled to the container: 760 / 1600 of 600 is 285, plus 48.
    expect(diagramHeight({ width: 1600, height: 600 }, 760)).toBe(333)
    expect(diagramHeight({ width: 1520, height: 760 }, 760)).toBe(380 + 48)
  })

  it("never zooms a diagram narrower than the container past 1:1 (bpmn-js does not)", () => {
    // Drawn at 461 × 217, so the frame is 217 + 48, not a 400 px frame half empty.
    expect(diagramHeight({ width: 461, height: 217 }, 710)).toBe(265)
    // Fullscreen makes no difference to a diagram that already fits.
    expect(diagramHeight({ width: 461, height: 217 }, 1400)).toBe(265)
  })

  it("never a sliver, never more than a screenful", () => {
    expect(diagramHeight({ width: 2000, height: 100 }, 760)).toBe(DIAGRAM_MIN_HEIGHT)
    expect(diagramHeight({ width: 400, height: 1200 }, 760)).toBe(DIAGRAM_MAX_HEIGHT)
    expect([DIAGRAM_MIN_HEIGHT, DIAGRAM_MAX_HEIGHT]).toEqual([240, 560])
  })

  it("keeps the default until both the size and the width are known", () => {
    expect(diagramHeight(null, 760)).toBe(360)
    expect(diagramHeight({ width: 0, height: 100 }, 760)).toBe(360)
    expect(diagramHeight({ width: 100, height: Number.NaN }, 760)).toBe(360)
    expect(diagramHeight({ width: 461, height: 217 }, 0)).toBe(360)
  })
})

describe("diagramBoundsFromXml (the frame is sized before the import)", () => {
  it("reads the first diagram's shapes, labels and waypoints, whatever their prefix", () => {
    expect(diagramBoundsFromXml(INVOICE_DI)).toEqual({ width: 461, height: 217 })
    // Older modelers write the DC namespace as `omgdc:`; the namespace counts.
    const omg = INVOICE_DI.replaceAll("dc:Bounds", "omgdc:Bounds").replace(
      'xmlns:dc="',
      'xmlns:omgdc="',
    )
    expect(diagramBoundsFromXml(omg)).toEqual({ width: 461, height: 217 })
  })

  it("is null without readable DI", () => {
    expect(diagramBoundsFromXml("")).toBeNull()
    expect(diagramBoundsFromXml("<not xml")).toBeNull()
    expect(diagramBoundsFromXml(XML)).toBeNull()
  })
})

describe("useBpmnViewer frame and fit", () => {
  let clientWidth: PropertyDescriptor | undefined
  beforeEach(() => {
    clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth")
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: () => 710,
    })
  })
  afterEach(() => {
    if (clientWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", clientWidth)
    else Reflect.deleteProperty(HTMLElement.prototype, "clientWidth")
  })

  it("has the diagram's height on the first paint when the XML carries its DI", () => {
    render(<Framed xml={INVOICE_DI} />)
    // No await: sized in the first commit, before bpmn-js imported anything.
    expect(canvas().style.height).toBe("265px")
  })

  it("fits centred, after dropping diagram-js's cached viewbox", async () => {
    render(<Framed xml={INVOICE_DI} />)
    await waitFor(() => expect(mock.MockViewer.canvases[0]?.fits.length).toBeGreaterThan(0))
    expect(mock.MockViewer.canvases[0].fits[0]).toMatchObject({ center: "auto", outerHeight: 265 })
  })

  it("refits a heatmap-style viewer against the NEW frame once the drawn diagram sized it", async () => {
    // No DI: the import fits at 360 px (cached), then the drawn diagram makes it 560. The refit must see 560.
    mock.FakeCanvas.inner = { x: 150, y: 80, width: 400, height: 700 }
    render(<Framed xml={XML} />)
    expect(canvas().style.height).toBe("360px")
    await waitFor(() => expect(canvas().style.height).toBe("560px"))
    await act(async () => {})
    const fits = mock.MockViewer.canvases[0].fits
    expect(fits[0]).toMatchObject({ outerHeight: 360, scale: 360 / 700 })
    expect(fits.at(-1)).toMatchObject({ outerHeight: 560, scale: 0.8 })
  })
})
