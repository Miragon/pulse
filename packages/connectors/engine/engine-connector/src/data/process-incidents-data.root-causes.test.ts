import { describe, expect, it } from "vitest"
import { cibsevenProvider } from "../providers/index.js"
import { clientFor, startFakeEngine, type FakeRoutes } from "../tools/test-support/fake-engine.js"
import { ROOT_CAUSE_READS } from "./incident-scan.js"
import { buildActivityIncidentsData } from "./process-incidents-data.js"
import {
  build,
  closeEnginesAfterEach,
  definitionRoutes,
  engines,
  KEY,
  row,
  V1,
  V2,
} from "./process-incidents-data.test-support.js"

// A call activity's incidents are copies of its called instances' incidents: no message of their
// own, their root cause in the called instance.

closeEnginesAfterEach()

describe("buildProcessIncidentsData: a call activity's group says its root cause", () => {
  const copy = (n: number, root: string) => ({
    ...row(n, "assess", V2),
    incidentMessage: null,
    configuration: null,
    rootCauseIncidentId: root,
  })
  const root = {
    ...row(0, "checkBlacklist", "check:1:c1"),
    id: "root-a",
    processInstanceId: "called-a",
    incidentMessage: "Blacklist provider unreachable",
  }
  const scan = [copy(0, "root-a"), copy(1, "root-b"), row(2, "sendPolicy", V2)]

  it("takes the message of its newest copy's root, read once; a group with its own keeps it", async () => {
    const { data, requests } = await build({
      ...definitionRoutes(scan, scan.length),
      "GET /incident/root-a": { body: root },
    })

    const byId = Object.fromEntries(data.activities.map((a) => [a.activityId, a]))
    expect(byId.assess.representativeMessage).toBe("Blacklist provider unreachable")
    expect(byId.sendPolicy.representativeMessage).toBe("sendPolicy failed")
    // Only the newest copy's root: the group needs one message, not every root.
    expect(requests.filter((r) => r.path.startsWith("/incident/root")).map((r) => r.path)).toEqual([
      "/incident/root-a",
    ])
  })

  it("leaves the message empty where the root is unread, never a guess", async () => {
    const { data } = await build({
      ...definitionRoutes(scan, scan.length),
      "GET /incident/root-a": { status: 500, body: { message: "boom" } },
    })

    expect(data.activities.find((a) => a.activityId === "assess")?.representativeMessage).toBeNull()
  })
})

describe("buildActivityIncidentsData: a call activity's copies name their root cause", () => {
  const CHECK = "check:1:c1"
  const copy = (n: number, root: string) => ({
    ...row(n, "callCheck", V1),
    incidentMessage: null,
    configuration: null,
    rootCauseIncidentId: root,
  })
  const root = (id: string, instance: string) => ({
    ...row(0, "checkBlacklist", CHECK),
    id,
    processInstanceId: instance,
    incidentMessage: "Blacklist provider unreachable",
  })

  async function page(routes: FakeRoutes) {
    const engine = await startFakeEngine(
      {
        "GET /incident/count": { body: { count: 3 } },
        [`GET /process-definition/${CHECK}/xml`]: {
          body: {
            id: CHECK,
            bpmn20Xml:
              '<definitions><process id="check"><serviceTask id="checkBlacklist" name="Check blacklist"/></process></definitions>',
          },
        },
        ...routes,
      },
      { body: [] },
    )
    engines.push(engine)
    const data = await buildActivityIncidentsData(clientFor(engine), {
      baseUrl: engine.baseUrl,
      provider: cibsevenProvider,
      processDefinitionKey: KEY,
      activityId: "callCheck",
    })
    return { data, requests: engine.requests }
  }

  it("reads each root once and names where it failed", async () => {
    const { data, requests } = await page({
      "GET /incident": {
        body: [copy(0, "root-a"), copy(1, "root-a"), copy(2, "root-b"), row(3, "callCheck", V1)],
      },
      "GET /incident/root-a": { body: root("root-a", "called-a") },
      "GET /incident/root-b": { body: root("root-b", "called-b") },
    })

    expect(data.incidents.map((i) => i.rootCause?.processInstanceId ?? null)).toEqual([
      "called-a",
      "called-a",
      "called-b",
      // A root incident of its own carries none.
      null,
    ])
    expect(data.incidents[0].rootCause).toEqual({
      incidentId: "root-a",
      message: "Blacklist provider unreachable",
      activityId: "checkBlacklist",
      activityName: "Check blacklist",
      processInstanceId: "called-a",
    })
    const roots = requests.filter((r) => r.path.startsWith("/incident/root")).map((r) => r.path)
    expect(roots.sort()).toEqual(["/incident/root-a", "/incident/root-b"])
  })

  it("leaves a copy without its root where that read fails, never a guess", async () => {
    const { data } = await page({
      "GET /incident": { body: [copy(0, "root-a"), copy(1, "root-b")] },
      "GET /incident/root-a": { status: 500, body: { message: "boom" } },
      "GET /incident/root-b": { body: root("root-b", "called-b") },
    })

    expect(data.incidents.map((i) => i.rootCause?.processInstanceId ?? null)).toEqual([
      null,
      "called-b",
    ])
  })

  it("reads at most ROOT_CAUSE_READS roots for a page", async () => {
    const copies = Array.from({ length: ROOT_CAUSE_READS + 3 }, (_, n) => copy(n, `root-${n}`))
    const { requests } = await page({
      "GET /incident": { body: copies },
      ...Object.fromEntries(
        copies.map((_, n) => [`GET /incident/root-${n}`, { body: root(`root-${n}`, `c-${n}`) }]),
      ),
    })

    expect(requests.filter((r) => r.path.startsWith("/incident/root"))).toHaveLength(
      ROOT_CAUSE_READS,
    )
  })
})
