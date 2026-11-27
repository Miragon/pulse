/**
 * The element of the contract's incidents: an incident at a multi-instance body lies at the
 * activity it repeats, the diagram's element, and one outside any process (a batch's failed job,
 * which names neither element nor instance) never fails the engine-wide search and is no incident
 * of the contract.
 */

import { describe, expect, it } from "vitest"
import { fakePort, type Route } from "../testing/fake-port.js"
import { DefinitionReader } from "./definition-reader.js"
import { IncidentSearch } from "./incident-search.js"

const ORDER_1 = { id: "order:1:a", key: "order", version: 1, name: "Order" }

const ROOT = {
  id: "inc-1",
  incidentType: "failedJob",
  activityId: "Activity_Charge",
  incidentTimestamp: "2026-10-21T18:44:04.554+0000",
  processInstanceId: "p1",
  processDefinitionId: ORDER_1.id,
  incidentMessage: "boom",
  rootCauseIncidentId: "inc-1",
  configuration: "job-1",
}

/** A batch's job without retries, as the engine answers its incident: no process, no element. */
const BATCH_JOB = {
  id: "inc-batch",
  incidentType: "failedJob",
  activityId: null,
  failedActivityId: null,
  incidentTimestamp: "2026-10-21T18:44:05.000+0000",
  processInstanceId: null,
  processDefinitionId: null,
  executionId: null,
  incidentMessage: null,
  rootCauseIncidentId: "inc-batch",
  configuration: "job-batch",
}

/** The incidents of the window a request asks for, in the order given. */
function incidentsOf(rows: readonly object[]): Route {
  return (input) => {
    const first = Number(input.query.firstResult)
    return rows.slice(first, first + Number(input.query.maxResults))
  }
}

function searchOver(rows: readonly object[]) {
  const port = fakePort({
    getIncidents: incidentsOf(rows),
    getProcessDefinitionStatistics: () => [{ definition: ORDER_1, instances: 1 }],
  })
  return new IncidentSearch(port, new DefinitionReader(port))
}

describe("IncidentSearch.search, the element of an incident", () => {
  it("places an incident at a multi-instance body on the activity it repeats", async () => {
    const search = searchOver([{ ...ROOT, activityId: "Activity_Charge#multiInstanceBody" }])

    expect(await search.search({}, { limit: 50 })).toStrictEqual({
      items: [expect.objectContaining({ id: "inc-1", elementId: "Activity_Charge" })],
    })
  })

  it("passes over an incident outside any process and keeps the others", async () => {
    const search = searchOver([BATCH_JOB, ROOT])

    expect(await search.search({}, { limit: 50 })).toStrictEqual({
      items: [expect.objectContaining({ id: "inc-1", elementId: "Activity_Charge" })],
    })
  })

  it("fills the page past incidents outside any process", async () => {
    const outside = ["a", "b", "c"].map((id) => ({
      ...BATCH_JOB,
      id: `inc-batch-${id}`,
      rootCauseIncidentId: `inc-batch-${id}`,
    }))
    const search = searchOver([...outside, ROOT])

    expect(await search.search({}, { limit: 1 })).toStrictEqual({
      items: [expect.objectContaining({ id: "inc-1" })],
    })
  })

  it("leaves out an incident of an instance that names no element", async () => {
    const search = searchOver([{ ...ROOT, activityId: undefined }])

    expect(await search.search({}, { limit: 50 })).toStrictEqual({ items: [] })
  })
})
