import { InstanceId } from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { matchingIn, page, problem } from "../../support/fake-transport.js"
import { aloneWaiting, detailWith, searchesOf } from "../../support/instance-tree.js"
import { element, instance, job } from "../../support/rows.js"

describe("the instance detail", () => {
  test("reads the job an incident names when no active element owns it", async () => {
    const incident = {
      incidentKey: "7",
      processInstanceKey: "1",
      processDefinitionKey: "100",
      elementId: "Charge",
      errorType: "JOB_NO_RETRIES",
      errorMessage: "card declined",
      creationTime: "2026-11-05T10:00:00.000Z",
    }
    const { camunda, reader } = detailWith(
      aloneWaiting({
        active: [],
        jobs: matchingIn([job("70", "10", { type: "charge", state: "FAILED", retries: 0 })]),
        incidents: page([
          { ...incident, jobKey: "70" },
          { ...incident, incidentKey: "8", errorType: "IO_MAPPING_ERROR", errorMessage: null },
        ]),
      }),
    )

    const detail = await reader.read(InstanceId("1"))

    expect(detail?.incidents).toEqual([
      expect.objectContaining({ id: "7", retriesLeft: 0, job: { id: "70", type: "charge" } }),
      expect.objectContaining({ id: "8", type: "IO_MAPPING_ERROR", message: "" }),
    ])
    expect(detail?.incidents[1]).not.toHaveProperty("job")
    expect(searchesOf(camunda, "POST /jobs/search").map((search) => search.filter)).toEqual([
      { processInstanceKey: "1", elementInstanceKey: { $in: ["1"] } },
      { jobKey: { $in: ["70"] } },
    ])
  })

  test("says so when it holds only part of the tree", async () => {
    const many = Array.from({ length: 50 }, (_, index) =>
      instance(String(100 + index), { state: "COMPLETED", endDate: "2026-11-05T11:00:00.000Z" }),
    )
    const { reader } = detailWith([
      {
        route: "GET /process-instances/1",
        answer: instance("1", { state: "COMPLETED", endDate: "2026-11-05T11:00:00.000Z" }),
      },
      { route: "POST /process-instances/search", answer: page(many) },
      { route: "POST /element-instances/search", answer: page([]) },
      { route: "POST /incidents/search", answer: page([]) },
      { route: "POST /variables/search", answer: page([]) },
    ])

    const detail = await reader.read(InstanceId("1"))

    expect(detail?.truncated).toBe(true)
    expect(detail?.waitStates).toEqual([])
    expect(detail?.calledInstances).toHaveLength(50)
  })

  test("reads a catching event it cannot name as other", async () => {
    const { reader } = detailWith([
      { route: "GET /process-instances/1", answer: instance("1") },
      { route: "POST /process-instances/search", answer: page([]) },
      {
        route: "POST /element-instances/search",
        answer: page([
          element("10", "Stop", "INTERMEDIATE_CATCH_EVENT"),
          element("11", "Plain", "INTERMEDIATE_CATCH_EVENT"),
        ]),
      },
      { route: "POST /jobs/search", answer: page([]) },
      { route: "POST /user-tasks/search", answer: page([]) },
      { route: "POST /message-subscriptions/search", answer: page([]) },
      { route: "POST /incidents/search", answer: page([]) },
      { route: "POST /variables/search", answer: page([]) },
      {
        route: "GET /process-definitions/100/xml",
        answer: `<bpmn:intermediateCatchEvent id="Stop"><bpmn:signalEventDefinition /></bpmn:intermediateCatchEvent>
           <bpmn:intermediateCatchEvent id="Plain"><bpmn:linkEventDefinition /></bpmn:intermediateCatchEvent>`,
      },
    ])

    const detail = await reader.read(InstanceId("1"))

    expect(detail?.waitStates.map((wait) => [wait.elementId, wait.kind])).toEqual([
      ["Stop", "signal"],
      ["Plain", "other"],
    ])
  })

  test("is undefined for an unknown instance and for free text, without a call for free text", async () => {
    const { camunda, reader } = detailWith([
      { route: "GET /process-instances/999", answer: problem(404, "NOT_FOUND", "missing") },
    ])

    expect(await reader.read(InstanceId("999"))).toBeUndefined()
    expect(await reader.read(InstanceId("ORD-1001"))).toBeUndefined()
    expect(camunda.requests.map((request) => request.route)).toEqual(["GET /process-instances/999"])
  })
})
