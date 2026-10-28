// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ComponentType } from "react"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { queryClient } from "@miragon/mcp-toolkit-ui"
import { WidgetFixtureHost } from "@miragon/mcp-toolkit-ui/app"
import { CAMUNDA7_BPMN_XML_DATA } from "../tool-names.js"
import { BpmnDiagram } from "./bpmn-diagram.js"

/** A view carries only `diagramDefinitionId` (#342); the diagram reads its XML once per (engine, definition). */

const imported = vi.hoisted(() => ({ xml: [] as string[] }))
vi.mock("bpmn-js/lib/NavigatedViewer", () => ({
  default: class {
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

const toolkitDefaults = queryClient.getDefaultOptions()

beforeEach(() => {
  imported.xml.length = 0
  queryClient.setDefaultOptions({
    ...toolkitDefaults,
    queries: { ...toolkitDefaults.queries, retry: false },
  })
})

afterEach(() => {
  cleanup()
  queryClient.clear()
  queryClient.setDefaultOptions(toolkitDefaults)
})

const DIAGRAM = '<definitions id="d"/>'

function renderDiagram(feed: (args: Record<string, unknown>) => unknown, copies = 1) {
  const calls: Array<Record<string, unknown>> = []
  const tools = {
    [CAMUNDA7_BPMN_XML_DATA]: (args: Record<string, unknown>) => {
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
  render(<WidgetFixtureHost widget={View} data={{}} tools={tools} />)
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
    expect(screen.getAllByRole("img", { name: "BPMN process diagram" })).toHaveLength(2)
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
