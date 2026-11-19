// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import { BPMN_LABEL_STYLE } from "@miragon/pulse-ui"
import TextRenderer from "bpmn-js/lib/draw/TextRenderer"
import { BpmnZoomControls } from "./bpmn-zoom-controls.js"
import { KEEP_CLEAR_GAP } from "./bpmn-fit.js"
import {
  DIAGRAM_MAX_HEIGHT,
  DIAGRAM_MIN_HEIGHT,
  diagramBoundsFromXml,
  diagramHeight,
  useBpmnViewer,
} from "./use-bpmn-viewer.js"

// bpmn-js needs a real SVG engine happy-dom lacks; the full lifecycle suite runs in the engine connector.
const mock = vi.hoisted(() => {
  /** Viewbox cached on first read and dropped only by `resized()` (Canvas.js 15.27). */
  type Box = { x: number; y: number; width: number; height: number }
  class FakeCanvas {
    static inner = { x: 150, y: 80, width: 400, height: 700 }
    cached: { outer: { width: number; height: number } } | null = null
    level = 1
    fits: Array<{ outerHeight: number; scale: number; box: Box }> = []
    constructor(private readonly container: HTMLElement) {}
    private size() {
      return {
        width: this.container.clientWidth,
        height: Number.parseFloat(this.container.style.height) || 0,
      }
    }
    viewbox(box?: Box) {
      if (box) {
        // As diagram-js sets it: the box on the whole canvas, at the scale that fits it.
        const { outer } = this.read()
        this.level = Math.min(outer.width / box.width, outer.height / box.height)
        this.fits.push({ outerHeight: outer.height, scale: this.level, box })
        this.cached = { outer: this.size() }
        return box
      }
      return this.read()
    }
    private read() {
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
    getContainer() {
      return this.container.querySelector(".djs-container") ?? this.container
    }
    resized() {
      this.cached = null
    }
    zoom(arg?: number): number {
      if (arg !== undefined) this.level = arg
      return this.level
    }
  }

  class MockViewer {
    static containers: HTMLElement[] = []
    static canvases: FakeCanvas[] = []
    static options: Array<Record<string, unknown>> = []
    canvas: FakeCanvas
    constructor(opts: { container: HTMLElement }) {
      MockViewer.containers.push(opts.container)
      MockViewer.options.push(opts)
      this.canvas = new FakeCanvas(opts.container)
      MockViewer.canvases.push(this.canvas)
      // bpmn-js's frame inside the container: the canvas is its focusable SVG, the drilldown
      // trail a list under it.
      opts.container.innerHTML =
        '<div class="bjs-container"><div class="djs-container"><svg tabindex="0"></svg>' +
        '<ul class="bjs-breadcrumbs"><li><span class="bjs-crumb"><a>Invoice Receipt</a></span></li></ul>' +
        "</div></div>"
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

/** The frame as the cockpit draws it: the viewer's container, the zoom bar beside it. */
function WithZoomBar({ xml }: { xml: string }) {
  const { containerRef, height, zoomIn, zoomOut, fit } = useBpmnViewer({ bpmnXml: xml })
  return (
    <div>
      <div ref={containerRef} data-testid="canvas" style={{ height: `${height}px` }} />
      <BpmnZoomControls onZoomIn={zoomIn} onZoomOut={zoomOut} onFit={fit} />
    </div>
  )
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
  mock.MockViewer.options.length = 0
  document.documentElement.classList.remove("dark")
})

describe("useBpmnViewer canvas (#339, N122)", () => {
  it("paints the container as the fixed light canvas in a dark document: no call site opts in", async () => {
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

describe("useBpmnViewer draws the labels as the modelers do (Arial, a named deviation)", () => {
  it("hands bpmn-js the kit's label style, the one object the webview of the editors hands it too", async () => {
    render(<Diagram xml={XML} />)

    await waitFor(() => expect(mock.MockViewer.options).toHaveLength(1))
    expect(mock.MockViewer.options[0]?.textRenderer).toBe(BPMN_LABEL_STYLE)
  })

  it("is bpmn-js's own default style, the one Camunda Modeler and bpmn.io size label boxes with", () => {
    const ours = new TextRenderer(BPMN_LABEL_STYLE)
    const modelers = new TextRenderer()

    expect(ours.getDefaultStyle()).toEqual(modelers.getDefaultStyle())
    expect(ours.getExternalStyle()).toEqual(modelers.getExternalStyle())
  })
})

function Named({ xml, label }: { xml: string; label?: string }) {
  const { containerRef } = useBpmnViewer({ bpmnXml: xml, ariaLabel: label })
  return <div ref={containerRef} data-testid="canvas" />
}

describe("useBpmnViewer names the canvas, never its frame (axe's nested-interactive)", () => {
  it("the canvas SVG is the image under the diagram's name, the frame of its controls none", async () => {
    const { rerender } = render(<Named xml={XML} label="BPMN process diagram" />)
    const image = await screen.findByRole("img", { name: "BPMN process diagram" })
    expect(image.tagName.toLowerCase()).toBe("svg")
    expect(canvas().hasAttribute("role")).toBe(false)

    rerender(<Named xml={XML} label="BPMN-Prozessdiagramm" />)
    expect(screen.getByRole("img", { name: "BPMN-Prozessdiagramm" })).toBe(image)
  })

  it("without a name the canvas stays as bpmn-js drew it", async () => {
    render(<Named xml={XML} />)
    await waitFor(() => expect(mock.MockViewer.containers).toEqual([canvas()]))
    expect(screen.queryByRole("img")).toBeNull()
    expect(canvas().querySelector("svg")?.hasAttribute("aria-label")).toBe(false)
  })

  it("hides bpmn-js's drilldown trail, never in sight under the canvas, so no list reads beside the image", async () => {
    render(<Named xml={XML} label="BPMN process diagram" />)
    await screen.findByRole("img", { name: "BPMN process diagram" })
    expect(canvas().querySelector(".bjs-breadcrumbs")?.hasAttribute("hidden")).toBe(true)
    expect(screen.queryByRole("list")).toBeNull()
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
    const [first] = mock.MockViewer.canvases[0].fits
    // The 265 px frame, not a cached size: 95 % of the 700 units tall diagram, its centre the canvas's.
    expect(first.outerHeight).toBe(265)
    expect(first.scale).toBeCloseTo((0.95 * 265) / 700, 9)
    const { inner } = mock.FakeCanvas
    expect(first.box.x + first.box.width / 2).toBeCloseTo(inner.x + inner.width / 2)
    expect(first.box.y + first.box.height / 2).toBeCloseTo(inner.y + inner.height / 2)
  })

  it("keeps the diagram clear of the zoom bar beside its container, measured as drawn", async () => {
    // A wide diagram fitted to 710 px would reach under the bar's corner: the room below the bar
    // holds it at the same scale.
    const bar = { left: 665, top: 11, width: 34, height: 100 }
    const rects = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      const box = this.matches('[data-slot="bpmn-zoom-controls"]')
        ? bar
        : { left: 0, top: 0, width: 0, height: 0 }
      return { ...box, right: box.left + box.width, bottom: box.top + box.height } as DOMRect
    })
    const inner = mock.FakeCanvas.inner
    mock.FakeCanvas.inner = { x: 40, y: 60, width: 1400, height: 200 }
    try {
      render(<WithZoomBar xml={XML} />)
      await waitFor(() => expect(canvas().style.height).toBe("240px"))
      await act(async () => {})
      const last = mock.MockViewer.canvases[0].fits.at(-1)!
      expect(last.scale).toBeCloseTo((0.95 * 710) / 1400, 9)
      const top = (60 - last.box.y) * last.scale
      expect(top).toBeGreaterThanOrEqual(bar.top + bar.height + KEEP_CLEAR_GAP)
      expect(top + 200 * last.scale).toBeLessThanOrEqual(240)
    } finally {
      mock.FakeCanvas.inner = inner
      rects.mockRestore()
    }
  })

  it("never fits a hidden container (no layout box), so a drill's hidden origin view keeps its diagram", async () => {
    const rects = vi
      .spyOn(HTMLElement.prototype, "getClientRects")
      .mockReturnValue([] as unknown as DOMRectList)
    try {
      render(<Framed xml={INVOICE_DI} fitOnResize />)
      await act(async () => {})
      expect(mock.MockViewer.canvases[0]?.fits ?? []).toEqual([])
    } finally {
      rects.mockRestore()
    }
  })

  it("refits a heatmap-style viewer against the NEW frame once the drawn diagram sized it", async () => {
    // No DI: the import fits at 360 px (cached), then the drawn diagram makes it 560. The refit must see 560.
    mock.FakeCanvas.inner = { x: 150, y: 80, width: 400, height: 700 }
    render(<Framed xml={XML} />)
    expect(canvas().style.height).toBe("360px")
    await waitFor(() => expect(canvas().style.height).toBe("560px"))
    await act(async () => {})
    const fits = mock.MockViewer.canvases[0].fits
    expect(fits[0].outerHeight).toBe(360)
    expect(fits[0].scale).toBeCloseTo((0.95 * 360) / 700, 9)
    expect(fits.at(-1)!.outerHeight).toBe(560)
    expect(fits.at(-1)!.scale).toBeCloseTo(0.95 * 0.8, 9)
  })
})
