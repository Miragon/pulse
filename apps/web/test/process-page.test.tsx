// @vitest-environment happy-dom
import { act, fireEvent, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { useHostLocation, type ViewComponent } from "@miragon/pulse-widget-shell/widgets"
import { WORLD_SCREENS } from "@miragon/pulse-screens/testing"
import {
  callsOf,
  engineList,
  INSTANCES_FEED,
  PROCESS_SCREEN_FEED,
  settled,
  start,
  stopPage,
} from "./page.test-support.js"

/**
 * The page's process screen on the page (src/app.tsx, the router): a process's address shows it
 * for an engine the page's screens serve, the cockpit's view for any other; the old address of a
 * process's instances gives way to it; a filter names the entry anew and another version is a new
 * entry, which Back leaves again.
 */

afterEach(stopPage)

const LIST = {
  engines: [
    { id: "prod-a", environment: "prod", dialect: "c7" },
    { id: "c8-dev", environment: "dev", dialect: "c8" },
  ],
}

/** The cockpit's view as the page starts it: its arguments in its heading. */
const Cockpit: ViewComponent<{ args: Record<string, unknown> }> = ({ data }) => {
  const location = useHostLocation()
  const args = location?.start?.args ?? data.args
  return (
    <main>
      <h1>{`cockpit ${String(args.view)} ${String(args.engine)}`}</h1>
    </main>
  )
}
const VIEWS = { views: { engine_open_cockpit: Cockpit as ViewComponent } }

const result = (structuredContent: unknown) =>
  Response.json({ result: { content: [{ type: "text", text: "{}" }], structuredContent } })

function server() {
  return {
    call: ({ name, arguments: args }: { name: string; arguments?: Record<string, unknown> }) => {
      switch (name) {
        case "engine_list_engines":
          return Response.json(engineList(LIST))
        case PROCESS_SCREEN_FEED:
          return result(
            args?.version === 1
              ? { ...WORLD_SCREENS.olderVersion, webApp: null }
              : { ...WORLD_SCREENS.process, webApp: null },
          )
        case INSTANCES_FEED:
          return result(WORLD_SCREENS.instanceList)
        case "engine_bpmn_xml_data":
          return result({ processDefinitionId: args?.processDefinitionId, bpmnXml: null })
        default:
          return result({ args, engines: LIST.engines })
      }
    },
  }
}

const frame = () => document.querySelector<HTMLElement>("[data-slot=page-frame]")!

describe("the process screen on the page", () => {
  it("shows a process of an engine its screens serve, its version's list read after it", async () => {
    const env = await start("/app/engines/prod-a/processes/pulse-order", server(), VIEWS)
    expect(await screen.findByRole("heading", { level: 1, name: "Order fulfillment" })).toBeTruthy()
    expect(frame().getAttribute("data-fill")).toBe("true")
    await waitFor(() => {
      expect(callsOf(env.fetch, INSTANCES_FEED)).toEqual([
        { engine: "prod-a", definitionId: "pulse-order:2", scope: "running" },
      ])
    })
    expect(callsOf(env.fetch, PROCESS_SCREEN_FEED)).toEqual([
      { engine: "prod-a", process: "pulse-order" },
    ])
    expect(callsOf(env.fetch, "engine_open_cockpit")).toEqual([])
  })

  it("replaces the old address of a process's instances by the process's own", async () => {
    const env = await start("/app/engines/prod-a/instances?process=pulse-order", server(), VIEWS)
    expect(await screen.findByRole("heading", { level: 1, name: "Order fulfillment" })).toBeTruthy()
    expect(env.browser.location.pathname).toBe("/app/engines/prod-a/processes/pulse-order")
    expect(env.browser.location.search).toBe("")
  })

  it("names the entry anew with a scope, and opens another version in a new entry Back leaves", async () => {
    const env = await start("/app/engines/prod-a/processes/pulse-order", server(), VIEWS)
    const ended = await screen.findByRole("radio", { name: /^Ended/ })
    await act(async () => {
      fireEvent.click(ended)
    })
    await settled()
    expect(env.browser.writes.at(-1)).toMatchObject({
      entry: "replace",
      url: "/app/engines/prod-a/processes/pulse-order?scope=ended",
    })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show v1" }))
    })
    await settled()
    // Another version keeps the list's variable conditions alone, as in the editors.
    expect(env.browser.writes.at(-1)).toMatchObject({
      entry: "push",
      url: "/app/engines/prod-a/processes/pulse-order?version=1",
    })
    await waitFor(() => {
      expect(callsOf(env.fetch, PROCESS_SCREEN_FEED)).toContainEqual({
        engine: "prod-a",
        process: "pulse-order",
        version: 1,
      })
    })
    expect(await screen.findByRole("heading", { level: 1, name: "Order fulfillment" })).toBeTruthy()
    await env.browser.back("/app/engines/prod-a/processes/pulse-order?scope=ended")
    await waitFor(() => {
      expect(screen.getByRole("radio", { name: /^Ended/ }).getAttribute("aria-checked")).toBe(
        "true",
      )
    })
  })

  it("opens a version the picker picks in a new entry, the picker and its focus kept, the name too", async () => {
    const env = await start("/app/engines/prod-a/processes/pulse-order", server(), VIEWS)
    const picker = await screen.findByRole<HTMLSelectElement>("combobox", { name: "Version" })
    picker.focus()
    await act(async () => {
      fireEvent.change(picker, { target: { value: "pulse-order:1" } })
    })
    expect(env.browser.writes.at(-1)).toMatchObject({
      entry: "push",
      url: "/app/engines/prod-a/processes/pulse-order?version=1",
    })
    // While v1 reads, the bar keeps the process's name and the picker its place.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Order fulfillment")
    expect(document.activeElement).toBe(picker)
    await waitFor(() => {
      expect(callsOf(env.fetch, PROCESS_SCREEN_FEED)).toContainEqual({
        engine: "prod-a",
        process: "pulse-order",
        version: 1,
      })
    })
    await waitFor(() => {
      expect(picker.value).toBe("pulse-order:1")
    })
    expect(picker.isConnected).toBe(true)
    expect(document.activeElement).toBe(picker)
    await env.browser.back("/app/engines/prod-a/processes/pulse-order")
    await waitFor(() => {
      expect(picker.value).toBe("pulse-order:2")
    })
  })

  it("leaves a process of an engine its screens do not serve to the cockpit", async () => {
    const env = await start("/app/engines/c8-dev/processes/pulse-order", server(), VIEWS)
    expect(
      await screen.findByRole("heading", { level: 1, name: "cockpit process-detail c8-dev" }),
    ).toBeTruthy()
    expect(frame().hasAttribute("data-fill")).toBe(false)
    expect(callsOf(env.fetch, PROCESS_SCREEN_FEED)).toEqual([])
  })
})
