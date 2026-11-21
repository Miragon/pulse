// @vitest-environment happy-dom
import { act, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { useHostLocation, type ViewComponent } from "@miragon/pulse-widget-shell/widgets"
import { WORLD_SCREENS } from "@miragon/pulse-screens/testing"
import { callsOf, engineList, start, stopPage } from "./page.test-support.js"

/**
 * The page's instance screen on the page (src/app.tsx, the router): an instance's address shows it
 * for an engine the page's screens serve, the cockpit's view for any other; the frame fills the
 * window for it; an incident the page knows by its id alone leads to the instance that holds its
 * root, the entry named anew.
 */

afterEach(stopPage)

const LIST = {
  engines: [
    { id: "prod-a", environment: "prod", dialect: "c7" },
    { id: "c8-dev", environment: "dev", dialect: "c8" },
  ],
  refused: [{ id: "legacy", environment: "dev", reason: "no url" }],
}

const INSTANCE_FEED = "engine_screen_instance_data"

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
        case INSTANCE_FEED:
          return result({ ...WORLD_SCREENS.instance, webApp: null, causes: null })
        case "engine_bpmn_xml_data":
          return result({ processDefinitionId: args?.processDefinitionId, bpmnXml: null })
        case "engine_incident_detail_data":
          return result({
            processInstanceId: "pi-caller",
            rootCause: { incidentId: "root-1", processInstanceId: "pi-called" },
          })
        default:
          return result({ args, engines: LIST.engines })
      }
    },
  }
}

const frame = () => document.querySelector<HTMLElement>("[data-slot=page-frame]")!

describe("the instance screen on the page", () => {
  it("shows an instance of an engine its screens serve, the frame filling the window", async () => {
    const env = await start("/app/engines/prod-a/instances/fake-DSP-3001", server(), VIEWS)
    expect(await screen.findByRole("heading", { level: 1, name: "DSP-3001" })).toBeTruthy()
    expect(frame().getAttribute("data-fill")).toBe("true")
    expect(callsOf(env.fetch, INSTANCE_FEED)).toEqual([
      { engine: "prod-a", instance: "fake-DSP-3001" },
    ])
    expect(callsOf(env.fetch, "engine_open_cockpit")).toEqual([])
  })

  it("names the entry anew with a tab the reader picks", async () => {
    const env = await start("/app/engines/prod-a/instances/fake-DSP-3001", server(), VIEWS)
    const variables = await screen.findByRole("tab", { name: /^Variables/ })
    await act(async () => {
      variables.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
    })
    await waitFor(() => {
      expect(env.browser.writes.at(-1)).toMatchObject({
        entry: "replace",
        url: "/app/engines/prod-a/instances/fake-DSP-3001?tab=variables",
      })
    })
    expect(screen.getByRole("tab", { name: /^Variables/ }).getAttribute("aria-selected")).toBe(
      "true",
    )
  })

  it("leaves an instance of an engine its screens do not serve to the cockpit, the page scrolling", async () => {
    const env = await start("/app/engines/legacy/instances/2251799813685367", server(), VIEWS)
    expect(
      await screen.findByRole("heading", { level: 1, name: "cockpit instance-detail legacy" }),
    ).toBeTruthy()
    expect(frame().hasAttribute("data-fill")).toBe(false)
    expect(callsOf(env.fetch, INSTANCE_FEED)).toEqual([])
  })

  it("shows a Camunda 8 engine's instance on its screen, never the cockpit's", async () => {
    const env = await start("/app/engines/c8-dev/instances/2251799813685367", server(), VIEWS)
    await waitFor(() => {
      expect(callsOf(env.fetch, INSTANCE_FEED)).toEqual([
        { engine: "c8-dev", instance: "2251799813685367" },
      ])
    })
    expect(callsOf(env.fetch, "engine_open_cockpit")).toEqual([])
  })

  it("leads an incident it knows by its id alone to the instance that holds its root", async () => {
    const env = await start(
      "/app/cockpit?view=incident-detail&engine=prod-a&incidentId=copy-1",
      server(),
      VIEWS,
    )
    await waitFor(() => {
      expect(env.browser.location.pathname).toBe(
        "/app/engines/prod-a/instances/pi-called/incidents/root-1",
      )
    })
    expect(env.browser.writes.at(-1)?.entry).toBe("replace")
    expect(callsOf(env.fetch, "engine_incident_detail_data")).toEqual([
      { engine: "prod-a", incidentId: "copy-1" },
    ])
    await waitFor(() => {
      expect(callsOf(env.fetch, INSTANCE_FEED)).toEqual([
        { engine: "prod-a", instance: "pi-called" },
      ])
    })
  })

  it("leaves an incident of an engine its screens do not serve to the cockpit", async () => {
    const env = await start(
      "/app/cockpit?view=incident-detail&engine=c8-dev&incidentId=1",
      server(),
      VIEWS,
    )
    expect(
      await screen.findByRole("heading", { level: 1, name: "cockpit incident-detail c8-dev" }),
    ).toBeTruthy()
    expect(callsOf(env.fetch, "engine_incident_detail_data")).toEqual([])
  })
})
