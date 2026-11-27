import { afterEach, describe, expect, it } from "vitest"
import {
  clientFor,
  startFakeEngine,
  type FakeEngine,
  type RecordedRequest,
} from "../tools/test-support/fake-engine.js"
import { buildProcessInstancesData, type ProcessInstancesArgs } from "./cockpit-data.js"

// The search box over the instance list and its chips (#717): the engine drops `withIncident`
// beside an OR query, so "With incident" under a search goes out as c7-core's two top-level
// halves (`searchedInstances`). Its law on a real engine is cockpit-search.test-support.ts.

/** An instance of the model engine. */
interface Instance {
  readonly id: string
  readonly businessKey: string
  readonly incident: boolean
  readonly suspended: boolean
}

/** A body as the SDK sends it, the search's OR query included. */
interface Body {
  readonly withIncident?: boolean
  readonly suspended?: boolean
  readonly businessKeyLike?: string
  readonly processInstanceIds?: string[]
  readonly orQueries?: { businessKeyLike: string; processInstanceIds: string[] }[]
}

const WORLD: readonly Instance[] = [
  { id: "p1", businessKey: "CUST-1", incident: true, suspended: false },
  { id: "p2", businessKey: "CUST-2", incident: false, suspended: true },
  { id: "p3", businessKey: "OTHER-1", incident: true, suspended: false },
  // A business key that holds another instance's id, as a child's may hold its parent's.
  { id: "p4", businessKey: "after-p3", incident: true, suspended: false },
  { id: "p5", businessKey: "before-p3", incident: false, suspended: false },
]

const holds = (pattern: string | undefined, key: string) =>
  pattern === undefined || key.includes(pattern.replaceAll("%", ""))

/** As the engine reads a body: beside an OR query its incident join is a left join (#717). */
function found(instance: Instance, body: Body): boolean {
  const [or] = body.orQueries ?? []
  return (
    (!body.withIncident || or !== undefined || instance.incident) &&
    (!body.suspended || instance.suspended) &&
    holds(body.businessKeyLike, instance.businessKey) &&
    (body.processInstanceIds?.includes(instance.id) ?? true) &&
    (or === undefined ||
      holds(or.businessKeyLike, instance.businessKey) ||
      or.processInstanceIds.includes(instance.id))
  )
}

const bodyOf = (request: RecordedRequest) => (request.body ?? {}) as Body

const matching = (request: RecordedRequest) =>
  WORLD.filter((instance) => found(instance, bodyOf(request))).sort((a, b) =>
    a.businessKey < b.businessKey ? -1 : 1,
  )

const engines: FakeEngine[] = []
afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

async function listed(args: ProcessInstancesArgs) {
  const engine = await startFakeEngine(
    {
      "POST /process-instance/count": (request) => ({ body: { count: matching(request).length } }),
      "POST /process-instance": (request) => {
        const first = Number(request.query.firstResult)
        const rows = matching(request).slice(first, first + Number(request.query.maxResults))
        return { body: rows.map((row) => ({ ...row, definitionId: "K1:1:d" })) }
      },
      "GET /process-definition": { body: [{ id: "K1:1:d", key: "K1", name: "Order", version: 1 }] },
    },
    { body: [] },
  )
  engines.push(engine)
  const data = await buildProcessInstancesData(clientFor(engine), "engine-a", args)
  const sent = engine.requests.filter((request) => request.path.startsWith("/process-instance"))
  return { data, bodies: sent.filter((r) => r.method === "POST").map(bodyOf) }
}

const idsOf = (data: { instances: { id: string }[] }) => data.instances.map(({ id }) => id)

describe("buildProcessInstancesData: With incident under a search (#717)", () => {
  it("counts and lists only the matches with an open incident, never every match", async () => {
    const { data, bodies } = await listed({ search: "CUST", withIncidents: true })

    expect(data).toMatchObject({
      totalCount: 1,
      allCount: 2,
      withIncidentCount: 1,
      suspendedCount: 1,
      filters: { search: "CUST" },
    })
    expect(idsOf(data)).toEqual(["p1"])
    // No body joins the flag and an OR query, which the engine would answer with every match.
    expect(bodies.filter((body) => body.withIncident && body.orQueries)).toEqual([])
  })

  it("finds an instance by its id beside the business keys holding it, in the engine's order", async () => {
    const { data } = await listed({ search: " p3 ", withIncidents: true })

    expect(data).toMatchObject({ totalCount: 2, allCount: 3, withIncidentCount: 2 })
    expect(idsOf(data)).toEqual(["p3", "p4"])
    expect(data.instances.every((row) => row.hasIncident)).toBe(true)
  })

  it.each([
    [0, ["p3"]],
    [1, ["p4"]],
    [2, []],
  ])("pages the union one row at a time from %i", async (firstResult, expected) => {
    const args = { search: "p3", withIncidents: true, firstResult, maxResults: 1 }
    expect(idsOf((await listed(args)).data)).toEqual(expected)
  })

  it("sends the search as the OR query on every other chip, and the halves for With incident", async () => {
    const term = "73059b49-c64b-11f1"
    const { data, bodies } = await listed({
      processDefinitionKey: "K1",
      businessKeyLike: "BK",
      search: ` ${term} `,
    })

    const orQueries = [{ businessKeyLike: `%${term}%`, processInstanceIds: [term] }]
    const scope = { processDefinitionKey: "K1" }
    const withIncident = { ...scope, withIncident: true }
    // The page, All and Suspended: the OR query; With incident: both halves and their overlap.
    expect(bodies).toHaveLength(6)
    expect(bodies).toEqual(
      expect.arrayContaining([
        { ...scope, orQueries, sorting: expect.any(Array) as unknown },
        { ...scope, orQueries },
        { ...scope, suspended: true, orQueries },
        { ...withIncident, businessKeyLike: `%${term}%` },
        { ...withIncident, processInstanceIds: [term] },
        { ...withIncident, businessKeyLike: `%${term}%`, processInstanceIds: [term] },
      ]),
    )
    // The search replaces the handed-in prefilter, as the box always did, and the echo names it.
    expect(bodies.map((body) => body.businessKeyLike)).not.toContain("%BK%")
    expect(data.filters).toEqual({
      active: undefined,
      suspended: undefined,
      withIncidents: undefined,
      search: term,
    })
  })
})
