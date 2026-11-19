// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ComponentType } from "react"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { ENGINE_BPMN_XML_DATA } from "../tool-names.js"
import { BpmnDiagram } from "./bpmn-diagram.js"
import { TestViewHost, createTestQueryClient } from "@miragon/pulse-widget-shell/widgets"

// One retry-free client per test; the test reads and pokes its cache.
let queryClient = createTestQueryClient()

/** A view carries only `diagramDefinitionId` (#342); the diagram reads its XML once per (engine, definition). */

const imported = vi.hoisted(() => ({ xml: [] as string[] }))
vi.mock("bpmn-js/lib/NavigatedViewer", () => ({
  default: class {
    // bpmn-js's frame inside the container: the canvas is its SVG.
    constructor({ container }: { container: HTMLElement }) {
      container.innerHTML =
        '<div class="bjs-container"><div class="djs-container"><svg tabindex="0"></svg></div></div>'
    }
    importXML(xml: string): Promise<{ warnings: [] }> {
      imported.xml.push(xml)
      return Promise.resolve({ warnings: [] })
    }
    get(): unknown {
      return {
        zoom: () => 1,
        resized: () => undefined,
        viewbox: () => ({ inner: { width: 100, height: 100 } }),
        addMarker: () => undefined,
        add: () => undefined,
      }
    }
    destroy() {}
  },
}))

beforeEach(() => {
  imported.xml.length = 0
})

afterEach(() => {
  cleanup()
  queryClient = createTestQueryClient()
})

const DIAGRAM = '<definitions id="d"/>'

function renderDiagram(feed: (args: Record<string, unknown>) => unknown, copies = 1) {
  const calls: Array<Record<string, unknown>> = []
  const tools = {
    [ENGINE_BPMN_XML_DATA]: (args: Record<string, unknown>) => {
      calls.push(args)
      return feed(args)
    },
  }
  const View: ComponentType<Record<string, unknown>> = () => (
    <>
      {Array.from({ length: copies }, (_, i) => (
        <BpmnDiagram key={i} definitionId="order:2:d2" engineId="prod-b" />
      ))}
    </>
  )
  render(
    <TestViewHost tools={tools} client={queryClient}>
      <View />
    </TestViewHost>,
  )
  return calls
}

describe("BpmnDiagram reads its diagram by definition id", () => {
  it("asks the feed for the definition on the view's engine, once for every copy", async () => {
    const calls = renderDiagram(
      (args) => ({
        processDefinitionId: args.processDefinitionId,
        bpmnXml: DIAGRAM,
      }),
      2,
    )

    await waitFor(() => expect(imported.xml).toEqual([DIAGRAM, DIAGRAM]))
    expect(calls).toEqual([{ processDefinitionId: "order:2:d2", engine: "prod-b" }])
    // The canvas alone is the image, never the frame around its controls.
    const canvases = screen.getAllByRole("img", { name: "BPMN process diagram" })
    expect(canvases.map((canvas) => canvas.tagName.toLowerCase())).toEqual(["svg", "svg"])
  })

  it("says the engine has no diagram for the version when the feed has none", async () => {
    renderDiagram(() => ({ processDefinitionId: "order:2:d2", bpmnXml: null }))

    expect(await screen.findByText("The engine has no diagram for this version.")).toBeTruthy()
    expect(imported.xml).toEqual([])
  })

  it("says why a read failed, and reads again on retry", async () => {
    let fail = true
    const calls = renderDiagram(() => {
      if (fail) throw new Error("Engine prod-b is not reachable (HTTP 503)")
      return { processDefinitionId: "order:2:d2", bpmnXml: DIAGRAM }
    })

    const retry = await screen.findByRole("button", { name: "Try again" })
    expect(screen.getByRole("alert").textContent).toContain("Engine prod-b is not reachable")
    fail = false
    fireEvent.click(retry)

    await waitFor(() => expect(imported.xml).toEqual([DIAGRAM]))
    expect(calls).toHaveLength(2)
  })
})
