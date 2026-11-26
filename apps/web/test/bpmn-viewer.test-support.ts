/**
 * A stand-in of bpmn-js's viewer for the page's diagrams in a DOM without an SVG engine (the real
 * drawing runs in test:web): pulse-ui's `BpmnDiagram` creates it, imports into it and decorates it,
 * and a suite reads what it was asked. A suite mocks the viewer with it:
 *
 * `vi.mock("bpmn-js/lib/NavigatedViewer", async () => ({ default: (await import("./bpmn-viewer.test-support.js")).FakeViewer }))`
 */

/** What the drawings were asked since the last `reset`. */
export interface Drawn {
  markers: Array<[string, string, "add" | "remove"]>
  overlays: Array<{ id: string; position: object; html: HTMLElement }>
  imports: number
}

export const drawn: Drawn = { markers: [], overlays: [], imports: 0 }

/** The drawing's elements, by id and type; `null`: every element is there. */
let elements: ReadonlyArray<{ id: string; type: string }> | null = null
/** The text an import fails with, or none. */
let failure: string | null = null

/** Sets the elements the next drawings hold; `null` for every element. */
export function drawElements(next: ReadonlyArray<{ id: string; type: string }> | null): void {
  elements = next
}

/** Makes the next imports fail with `message`, or succeed again (`null`). */
export function failImports(message: string | null): void {
  failure = message
}

export function reset(): void {
  drawn.markers = []
  drawn.overlays = []
  drawn.imports = 0
  elements = null
  failure = null
}

export class FakeViewer {
  private readonly container: HTMLElement

  constructor({ container }: { container: HTMLElement }) {
    this.container = container
    container.innerHTML = '<div class="djs-container"><svg tabindex="0"></svg></div>'
  }

  private known(id: string): void {
    if (elements !== null && !elements.some((element) => element.id === id)) {
      throw new Error(`no element ${id}`)
    }
  }

  importXML(): Promise<{ warnings: string[] }> {
    drawn.imports += 1
    return failure === null ? Promise.resolve({ warnings: [] }) : Promise.reject(new Error(failure))
  }

  get(service: string): unknown {
    const mark = (change: "add" | "remove") => (id: string, marker: string) => {
      this.known(id)
      drawn.markers.push([id, marker, change])
    }
    if (service === "canvas") {
      return {
        addMarker: mark("add"),
        removeMarker: mark("remove"),
        viewbox: () => ({ x: 0, y: 0, width: 600, height: 300, scale: 1 }),
        zoom: () => 1,
        resized: () => {},
        getContainer: () => this.container,
        scroll: () => {},
      }
    }
    if (service === "overlays") {
      return {
        add: (id: string, overlay: { position: object; html: HTMLElement }) => {
          this.known(id)
          this.container.querySelector(".djs-container")?.appendChild(overlay.html)
          drawn.overlays.push({ id, ...overlay })
        },
      }
    }
    if (service === "elementRegistry") return { getAll: () => elements ?? [] }
    return { on: () => {}, off: () => {} }
  }

  destroy(): void {}
}
