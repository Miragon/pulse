import { afterEach, describe, expect, it } from "vitest"
import {
  clientFor,
  startFakeEngine,
  type FakeEngine,
  type RecordedRequest,
} from "../tools/test-support/fake-engine.js"
import { buildJobBacklogData } from "./job-backlog-data.js"

const engines: FakeEngine[] = []
afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

/** Each count answers by its filter, so a swapped filter shows as a swapped figure. */
function jobCount(r: RecordedRequest) {
  if (r.query.executable === "true" && r.query.active === "true") return { body: { count: 7 } }
  if (r.query.suspended === "true") return { body: { count: 2 } }
  if (r.query.dueDates) return { body: { count: 5 } }
  return { status: 400, body: { type: "InvalidRequestException", message: "no filter" } }
}

async function build() {
  const engine = await startFakeEngine(
    {
      "GET /job/count": jobCount,
      "GET /external-task/count": { body: { count: 3 } },
    },
    { status: 404, body: { type: "InvalidRequestException", message: "unmapped" } },
  )
  engines.push(engine)
  const data = await buildJobBacklogData(clientFor(engine))
  return { data, requests: engine.requests }
}

describe("buildJobBacklogData", () => {
  it("counts the executable, suspended and later-due jobs and the external tasks", async () => {
    const { data } = await build()
    expect(data).toEqual({ executableJobs: 7, suspendedJobs: 2, jobsDueLater: 5, externalTasks: 3 })
  })

  it("reads executable jobs as engine_status does: retries left, due AND active", async () => {
    const { requests } = await build()
    const jobCounts = requests.filter((r) => r.path === "/job/count").map((r) => r.query)
    expect(jobCounts).toContainEqual({ executable: "true", active: "true" })
    expect(jobCounts).toContainEqual({ suspended: "true" })
  })

  it("asks for the jobs due after now, in the engine's date format", async () => {
    const before = Date.now()
    const { requests } = await build()
    const dueDates = requests.find((r) => r.query.dueDates)?.query.dueDates ?? ""
    const [, operator, date] = /^(gt)_(.+)$/.exec(dueDates) ?? []
    expect(operator).toBe("gt")
    expect(date).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}\+0000$/)
    expect(Date.parse(date.replace("+0000", "Z"))).toBeGreaterThanOrEqual(before - 1000)
  })
})
