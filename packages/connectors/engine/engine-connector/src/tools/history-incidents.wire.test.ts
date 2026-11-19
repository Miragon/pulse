import { afterEach, describe, expect, it } from "vitest"
import { withToolErrors } from "@miragon/pulse-widget-shell/server"
import { registerTools } from "./index.js"
import {
  callTool,
  captureTools,
  registryFor,
  startFakeEngine,
  type FakeEngine,
  type FakeRoutes,
} from "./test-support/fake-engine.js"

/**
 * A history query by incident below history level FULL: the engine records no incident in its
 * history, so an empty answer is checked against the runtime and refused, never returned as "none"
 * (c7-core's with-incident rule; measured at AUDIT on Operaton and CIB seven).
 */

const tools = captureTools((register) => registerTools(register, { allowDeployments: false }))

const engines: FakeEngine[] = []
afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

const EMPTY = { body: [] }
const NONE = { body: { count: 0 } }

async function call(name: string, args: Record<string, unknown>, routes: FakeRoutes) {
  const engine = await startFakeEngine(routes, EMPTY)
  engines.push(engine)
  const config = tools.get(name)
  if (!config) throw new Error(`${name} is not registered`)
  const result = await withToolErrors(() => callTool(config, registryFor(engine), args))()
  return { result, paths: engine.requests.map((request) => request.path) }
}

const AT_AUDIT: FakeRoutes = {
  "GET /history/process-instance/count": NONE,
  "GET /history/incident/count": NONE,
  "GET /incident/count": { body: { count: 7 } },
}

describe("a history query by incident on an engine that keeps no incident history", () => {
  it("refuses the empty answer of the historic incidents, naming history level FULL", async () => {
    const { result, paths } = await call("engine_query_historic_incidents", {}, AT_AUDIT)

    expect(result).toMatchObject({
      isError: true,
      content: [
        {
          text: expect.stringMatching(
            /^\[INCIDENT_HISTORY_NOT_KEPT\] This engine's history holds none of its 7 open incidents: .*history level FULL/,
          ) as string,
        },
      ],
    })
    expect(paths.filter((path) => path === "/incident/count")).toHaveLength(1)
  })

  it("refuses the historic process instances filtered by their incidents", async () => {
    for (const filter of [{ withIncidents: true }, { incidentStatus: "resolved" }]) {
      const { result } = await call("engine_query_historic_process_instances", filter, {
        ...AT_AUDIT,
        "GET /incident/count": { body: { count: 1 } },
      })

      expect(result).toMatchObject({
        isError: true,
        content: [{ text: expect.stringContaining("none of its 1 open incident:") as string }],
      })
    }
  })

  it("answers none where the history holds the open incidents or the runtime holds none", async () => {
    const atFull: FakeRoutes = {
      ...AT_AUDIT,
      "GET /history/incident": (request) => ({
        body: request.query.open === "true" ? [{ id: "i1" }] : [],
      }),
    }
    const quiet = { ...AT_AUDIT, "GET /incident/count": NONE }
    for (const routes of [atFull, quiet]) {
      const { result } = await call("engine_query_historic_incidents", { resolved: true }, routes)

      expect(result).toEqual({ items: [], totalCount: 0, hasMore: false })
    }
  })

  it("checks nothing for a history query that reads no incident", async () => {
    const { result, paths } = await call("engine_query_historic_process_instances", {}, AT_AUDIT)

    expect(result).toEqual({ items: [], totalCount: 0, hasMore: false })
    expect(paths.sort()).toEqual(["/history/process-instance", "/history/process-instance/count"])
  })
})
