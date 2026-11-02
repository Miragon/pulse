// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { useEffect } from "react"
import { cleanup, render, waitFor } from "@testing-library/react"
import { useBpmnViewer, type BpmnViewerWithGet } from "@miragon/pulse-widget-shell/widgets"

// bpmn-js replaced by a recording stub: it needs a real SVG engine, which happy-dom lacks.
const mock = vi.hoisted(() => {
  class MockCanvas {
    level = 1
    zoomCalls: Array<"fit-viewport" | number> = []
    zoom = (arg?: "fit-viewport" | number): number => {
      if (arg === undefined) return this.level
      this.zoomCalls.push(arg)
      this.level = arg === "fit-viewport" ? 0.8 : arg
      return this.level
    }
    addMarker = () => {}
    resizedCalls = 0
    resized = () => {
      this.resizedCalls++
    }
  }

  class MockViewer {
    static instances: MockViewer[] = []
    canvas = new MockCanvas()
    destroyed = false
    container: HTMLElement
    importedXml: string[] = []
    constructor(opts: { container: HTMLElement }) {
      this.container = opts.container
      MockViewer.instances.push(this)
    }
    importXML(xml: string): Promise<{ warnings: string[] }> {
      this.importedXml.push(xml)
      return xml.includes("invalid")
        ? Promise.reject(new Error("unparsable BPMN"))
        : Promise.resolve({ warnings: [] })
    }
    get(service: string): unknown {
      return service === "canvas" ? this.canvas : {}
    }
    destroy() {
      this.destroyed = true
    }
  }

  return { MockViewer }
})

vi.mock("bpmn-js/lib/NavigatedViewer", () => ({ default: mock.MockViewer }))

const XML = "<bpmn:definitions/>"

let latest: ReturnType<typeof useBpmnViewer>

function Harness({
  xml,
  reimportKey,
  onImported,
}: {
  xml: string
  reimportKey?: unknown
  onImported?: (viewer: BpmnViewerWithGet) => void | (() => void)
}) {
  const { containerRef, height, importError, zoomIn, zoomOut, fit } = useBpmnViewer({
    bpmnXml: xml,
    reimportKey,
    onImported,
  })
  // From an effect so the render stays pure.
  useEffect(() => {
    latest = { containerRef, height, importError, zoomIn, zoomOut, fit }
  })
  return <div ref={containerRef} />
}

afterEach(() => {
  cleanup()
  mock.MockViewer.instances.length = 0
})

describe("useBpmnViewer", () => {
  it("mounts a viewer on the container, imports the XML and applies the initial fit", async () => {
    const { container } = render(<Harness xml={XML} />)

    await waitFor(() => expect(mock.MockViewer.instances).toHaveLength(1))
    const viewer = mock.MockViewer.instances[0]
    expect(viewer.container).toBe(container.firstElementChild)
    expect(viewer.importedXml).toEqual([XML])
    // diagram-js recomputes the viewbox first (it caches the container size), then the 0.95 breathing room.
    await waitFor(() => expect(viewer.canvas.zoomCalls).toEqual(["fit-viewport", 0.8 * 0.95]))
    expect(viewer.canvas.resizedCalls).toBe(1)
    expect(latest.importError).toBeNull()
  })

  it("runs onImported after the fit; its cleanup and viewer.destroy run on unmount", async () => {
    const cleanupSpy = vi.fn()
    const onImported = vi.fn((viewer: BpmnViewerWithGet) => {
      // The fit already happened when the decoration callback runs.
      expect(mock.MockViewer.instances[0].canvas.zoomCalls[0]).toBe("fit-viewport")
      expect(viewer.get("canvas")).toBe(
        mock.MockViewer.instances[0].canvas as unknown as ReturnType<typeof viewer.get>,
      )
      return cleanupSpy
    })

    const { unmount } = render(<Harness xml={XML} onImported={onImported} />)
    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1))

    unmount()
    expect(cleanupSpy).toHaveBeenCalledTimes(1)
    expect(mock.MockViewer.instances[0].destroyed).toBe(true)
  })

  it("surfaces the import error message and skips onImported", async () => {
    const onImported = vi.fn()
    render(<Harness xml="invalid-bpmn" onImported={onImported} />)

    await waitFor(() => expect(latest.importError).toBe("unparsable BPMN"))
    expect(onImported).not.toHaveBeenCalled()
  })

  it("zoomIn/zoomOut multiply the current zoom by 1.1/0.9", async () => {
    render(<Harness xml={XML} />)
    await waitFor(() =>
      expect(mock.MockViewer.instances[0]?.canvas.zoomCalls.length).toBeGreaterThan(1),
    )
    const canvas = mock.MockViewer.instances[0].canvas

    const before = canvas.level
    latest.zoomIn()
    expect(canvas.level).toBeCloseTo(before * 1.1)
    latest.zoomOut()
    expect(canvas.level).toBeCloseTo(before * 1.1 * 0.9)
  })

  it("re-imports on reimportKey identity change, not on a stable key", async () => {
    const stableKey = ["highlights"]
    const { rerender } = render(<Harness xml={XML} reimportKey={stableKey} />)
    await waitFor(() => expect(mock.MockViewer.instances).toHaveLength(1))

    rerender(<Harness xml={XML} reimportKey={stableKey} />)
    expect(mock.MockViewer.instances).toHaveLength(1)

    rerender(<Harness xml={XML} reimportKey={["changed"]} />)
    await waitFor(() => expect(mock.MockViewer.instances).toHaveLength(2))
    expect(mock.MockViewer.instances[0].destroyed).toBe(true)
    expect(mock.MockViewer.instances[1].importedXml).toEqual([XML])
  })
})
