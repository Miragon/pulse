import { describe, expect, it } from "vitest"
import type { RecordedRequest } from "../tools/test-support/fake-engine.js"
import {
  at,
  atActivity,
  build,
  closeEnginesAfterEach,
  definitionRoutes,
  diagram,
  row,
  V2,
} from "./process-incidents-data.test-support.js"

// Camunda 7 raises a multi-instance activity's own incidents (its failed asynchronous body, say) at
// its body, `<id>#multiInstanceBody`, an id the diagram does not draw (#689 F136). The process view
// groups them on the activity, as its Running and the element statistics count them; the
// activity's page lists them with its items' incidents (activity-incidents-data.body.test.ts).

closeEnginesAfterEach()

const BODY = "assess#multiInstanceBody"

describe("buildProcessIncidentsData: a multi-instance body's root incidents on its activity", () => {
  it("groups a complete scan's body incident with its activity's, one activity of the diagram", async () => {
    const scan = [row(0, "assess", V2), row(1, BODY, V2)]
    const { data } = await build(definitionRoutes(scan, 2))

    expect(data.activities.map((a) => [a.activityId, a.activityName, a.incidentCount])).toEqual([
      ["assess", "Assess creditworthiness", 2],
    ])
    expect(data.affectedDiagramActivityCount).toBe(1)
    expect(data.totalActivityCount).toBe(2)
    // The group's facts hold the body's incident too: the scan holds the whole group.
    expect(data.activities[0]).toMatchObject({
      representativeMessage: "assess failed",
      latestIncident: scan[0].incidentTimestamp,
      firstSeen: scan[1].incidentTimestamp,
    })
  })

  it("takes a capped scan's rows of the body onto its activity, its count from the statistics", async () => {
    // The scan's 200 rows, its limit: the body's incident the newest, then sendPolicy's.
    const sendPolicy = Array.from({ length: 250 }, (_, n) => row(n + 1, "sendPolicy", V2))
    const scan = [row(0, BODY, V2), ...sendPolicy.slice(0, 199)]
    const byVersion = { [V2]: [row(0, BODY, V2), row(300, "assess", V2), ...sendPolicy] }
    const { data } = await build({
      ...definitionRoutes(scan, 252),
      "GET /incident": (r: RecordedRequest) => ({
        body: r.query.processDefinitionId ? atActivity(byVersion, r.query) : scan,
      }),
      [`GET /process-definition/${V2}/xml`]: diagram(
        V2,
        '<serviceTask id="assess" name="Assess creditworthiness"/><serviceTask id="sendPolicy"/>',
      ),
      [`GET /process-definition/${V2}/statistics`]: {
        body: [at("assess", 1), at(BODY, 1), at("sendPolicy", 250)],
      },
    })

    expect(
      data.activities.map((a) => [a.activityId, a.incidentCount, a.representativeMessage]),
    ).toEqual([
      ["sendPolicy", 250, "sendPolicy failed"],
      ["assess", 2, `${BODY} failed`],
    ])
    expect(data.activities[1]).toMatchObject({
      latestIncident: scan[0].incidentTimestamp,
      firstSeen: null,
    })
    expect(data.affectedDiagramActivityCount).toBe(2)
  })
})
