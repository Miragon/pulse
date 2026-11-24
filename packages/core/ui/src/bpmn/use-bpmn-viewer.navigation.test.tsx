// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { BpmnZoomControls } from "./bpmn-zoom-controls.js"
import { ZOOM_STEP, useBpmnViewer } from "./use-bpmn-viewer.js"

// bpmn-js needs a real SVG engine happy-dom lacks: a canvas that records what the hook sets.
const mock = vi.hoisted(() => {
  type Box = { x: number; y: number; width: number; height: number }
  class FakeCanvas {
    level = 1
    fits: Array<{ scale: number; box: Box }> = []
    scrolls: Array<{ dx: number; dy: number }> = []
    constructor(private readonly container: HTMLElement) {}
    private outer() {
      return { width: this.container.clientWidth, height: 265 }
    }
    viewbox(box?: Box) {
      const outer = this.outer()
      if (box) {
        // As diagram-js sets it: the box on the whole canvas, at the scale that fits it.
        this.level = Math.min(outer.width / box.width, outer.height / box.height)
        this.fits.push({ scale: this.level, box })
        return box
      }
      const inner = { x: 150, y: 80, width: 400, height: 700 }
      return { x: 0, y: 0, ...outer, scale: this.level, inner, outer }
    }
    getContainer() {
      return this.container
    }
    resized() {}
    zoom(arg?: number): number {
      if (arg !== undefined) this.level = arg
      return this.level
    }
    scroll(delta: { dx: number; dy: number }) {
      this.scrolls.push(delta)
    }
  }

  class MockViewer {
    static canvases: FakeCanvas[] = []
    /** What `elementRegistry.getAll()` gives: the drawn shapes. */
    static elements: Array<{
      id: string
      x?: number
      y?: number
      width?: number
      height?: number
    }> = []
    canvas: FakeCanvas
    constructor(opts: { container: HTMLElement }) {
      this.canvas = new FakeCanvas(opts.container)
      MockViewer.canvases.push(this.canvas)
      // bpmn-js's canvas: its focusable SVG.
      opts.container.innerHTML = '<div class="djs-container"><svg tabindex="0"></svg></div>'
    }
    importXML(): Promise<{ warnings: string[] }> {
      return Promise.resolve({ warnings: [] })
    }
    get(service: string): unknown {
      return service === "elementRegistry" ? { getAll: () => MockViewer.elements } : this.canvas
    }
    destroy() {}
  }
  return { MockViewer }
})

vi.mock("bpmn-js/lib/NavigatedViewer", () => ({ default: mock.MockViewer }))

const XML = "<bpmn:definitions/>"

/** The frame as the cockpit draws it: the viewer's container, the zoom bar beside it. */
function WithZoomBar({ markedIds }: { markedIds?: ReadonlyArray<string> }) {
  const { containerRef, height, zoomIn, zoomOut, fit } = useBpmnViewer({ bpmnXml: XML, markedIds })
  return (
    <div>
      <div ref={containerRef} data-testid="canvas" style={{ height: `${height}px` }} />
      <BpmnZoomControls onZoomIn={zoomIn} onZoomOut={zoomOut} onFit={fit} />
    </div>
  )
}

const canvas = () => screen.getByTestId("canvas")

afterEach(() => {
  cleanup()
  mock.MockViewer.canvases.length = 0
  mock.MockViewer.elements = []
})

describe("useBpmnViewer zoom and keyboard: a tool, not a thumbnail", () => {
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

  /** The viewer drawn and fitted, its zoom bar's buttons and its canvas. */
  async function drawn(markedIds?: ReadonlyArray<string>) {
    render(<WithZoomBar markedIds={markedIds} />)
    await waitFor(() => expect(mock.MockViewer.canvases[0]?.fits.length).toBeGreaterThan(0))
    const fake = mock.MockViewer.canvases[0]
    return {
      fake,
      zoomIn: () => fireEvent.click(screen.getByRole("button", { name: "Zoom in" })),
      zoomOut: () => fireEvent.click(screen.getByRole("button", { name: "Zoom out" })),
      fit: () => fireEvent.click(screen.getByRole("button", { name: "Fit to viewport" })),
      svg: () => canvas().querySelector("svg")!,
    }
  }

  it("zooms in and out a quarter at a time", async () => {
    const { fake, zoomIn, zoomOut } = await drawn()
    expect(ZOOM_STEP).toBe(1.25)
    fake.level = 1
    zoomIn()
    expect(fake.level).toBeCloseTo(1.25, 9)
    zoomOut()
    zoomOut()
    expect(fake.level).toBeCloseTo(0.8, 9)
  })

  it("never zooms in on a zoom out, below bpmn-js's floor where a phone fits a wide diagram", async () => {
    const { fake, zoomOut } = await drawn()
    fake.level = 0.19
    zoomOut()
    expect(fake.level).toBe(0.19)
  })

  it("centres the marked element on the first zoom after a fit, then zooms about the view", async () => {
    mock.MockViewer.elements = [
      { id: "Task_Check", x: 400, y: 100, width: 100, height: 80 },
      { id: "Task_Check_label", x: 0, y: 0, width: 10, height: 10 },
      { id: "Task_Other", x: 0, y: 0, width: 100, height: 80 },
    ]
    const { fake, zoomIn, fit } = await drawn(["Task_Check"])
    fake.level = 0.5
    const fitted = fake.fits.length
    zoomIn()
    // One box set on the canvas: the new scale, its middle the shape's middle (450, 140).
    expect(fake.fits).toHaveLength(fitted + 1)
    const centred = fake.fits.at(-1)!
    expect(centred.scale).toBeCloseTo(0.625, 9)
    expect(centred.box.x + centred.box.width / 2).toBeCloseTo(450)
    expect(centred.box.y + centred.box.height / 2).toBeCloseTo(140)
    // The next step keeps the view the reader has: no second jump.
    zoomIn()
    expect(fake.fits).toHaveLength(fitted + 1)
    expect(fake.level).toBeCloseTo(0.625 * 1.25, 9)
    // A fit shows the whole again, and the first zoom after it centres the element again.
    fit()
    const refitted = fake.fits.length
    zoomIn()
    expect(fake.fits).toHaveLength(refitted + 1)
  })

  it("zooms about the view where nothing is marked or the mark is not drawn", async () => {
    mock.MockViewer.elements = [{ id: "Task_Other", x: 0, y: 0, width: 100, height: 80 }]
    const { fake, zoomIn } = await drawn(["Task_Gone"])
    const fitted = fake.fits.length
    zoomIn()
    expect(fake.fits).toHaveLength(fitted)
  })

  it("pans the focused canvas with the arrow keys, further with Shift; Ctrl or Cmd stays bpmn-js's", async () => {
    const { fake, svg } = await drawn()
    fireEvent.keyDown(svg(), { key: "ArrowRight" })
    fireEvent.keyDown(svg(), { key: "ArrowUp" })
    fireEvent.keyDown(svg(), { key: "ArrowDown", shiftKey: true })
    expect(fireEvent.keyDown(svg(), { key: "ArrowLeft" })).toBe(false)
    fireEvent.keyDown(svg(), { key: "ArrowLeft", ctrlKey: true })
    fireEvent.keyDown(svg(), { key: "ArrowLeft", metaKey: true })
    fireEvent.keyDown(svg(), { key: "Enter" })
    expect(fake.scrolls).toEqual([
      { dx: -50, dy: 0 },
      { dx: 0, dy: 50 },
      { dx: 0, dy: -200 },
      { dx: 50, dy: 0 },
    ])
  })
})
