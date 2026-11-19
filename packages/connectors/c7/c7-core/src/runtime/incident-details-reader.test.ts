import { IncidentId, RuntimeError } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { fakeFailure, fakePort, type Route } from "../testing/fake-port.js"
import { IncidentDetailsReader } from "./incident-details-reader.js"

const ROOT = {
  id: "inc-1",
  incidentType: "failedJob",
  activityId: "Activity_Charge",
  incidentTimestamp: "2026-10-21T18:44:04.554+0000",
  processInstanceId: "p1",
  incidentMessage: "Customer service is down",
  rootCauseIncidentId: "inc-1",
  configuration: "job-1",
}
const TRACE =
  "org.example.Boom: outer\n\tat a.b.C.run(C.java:1)\nCaused by: java.net.ConnectException: refused\n\n"

function readerOver(routes: Readonly<Record<string, Route>>) {
  const port = fakePort(routes)
  return { port, reader: new IncidentDetailsReader(port) }
}

describe("IncidentDetailsReader.read", () => {
  it("delivers the whole stack trace of a failed job with its root cause", async () => {
    const { port, reader } = readerOver({
      getIncident: () => ROOT,
      getStacktrace: () => TRACE,
    })

    expect(await reader.read(IncidentId("inc-1"))).toStrictEqual({
      kind: "stacktrace",
      text: TRACE.trimEnd(),
      truncated: false,
      rootCause: "ConnectException: refused",
      rootCauseLine: 2,
    })
    expect(port.calls).toStrictEqual([
      { operationId: "getIncident", input: { pathArgs: ["inc-1"], query: {} } },
      { operationId: "getStacktrace", input: { pathArgs: ["job-1"], query: {} } },
    ])
  })

  it("delivers the error details of a failed external task", async () => {
    const { port, reader } = readerOver({
      getIncident: () => ({ ...ROOT, incidentType: "failedExternalTask", configuration: "task-1" }),
      getExternalTaskErrorDetails: () => "java.net.ConnectException: Connection refused\n",
    })

    expect(await reader.read(IncidentId("inc-1"))).toStrictEqual({
      kind: "stacktrace",
      text: "java.net.ConnectException: Connection refused",
      truncated: false,
      rootCause: "ConnectException: Connection refused",
    })
    expect(port.calls[1]).toStrictEqual({
      operationId: "getExternalTaskErrorDetails",
      input: { pathArgs: ["task-1"], query: {} },
    })
  })

  it.each([
    [
      "is gone",
      () => {
        throw fakeFailure(404, "InvalidRequestException")
      },
    ],
    ["is blank", () => " \n"],
  ])("delivers the incident's message when the job's text %s", async (_name, stacktrace) => {
    const { reader } = readerOver({ getIncident: () => ROOT, getStacktrace: stacktrace })

    expect(await reader.read(IncidentId("inc-1"))).toStrictEqual({
      kind: "errorMessage",
      text: "Customer service is down",
      truncated: false,
      rootCause: "Customer service is down",
    })
  })

  it.each([
    ["a custom type", { incidentType: "invoiceMismatch", configuration: "inv-1" }],
    ["no configuration", { configuration: "" }],
    ["a job id no engine assigns", { configuration: "job 1" }],
  ])("reads no engine text for %s", async (_name, fields) => {
    const { port, reader } = readerOver({ getIncident: () => ({ ...ROOT, ...fields }) })

    expect(await reader.read(IncidentId("inc-1"))).toMatchObject({
      kind: "errorMessage",
      text: "Customer service is down",
    })
    expect(port.calls.map((call) => call.operationId)).toStrictEqual(["getIncident"])
  })

  it.each([
    ["no message", { incidentMessage: undefined }],
    ["a blank message", { incidentMessage: "  " }],
  ])("has no details for an incident with %s and no engine text", async (_name, fields) => {
    const { reader } = readerOver({
      getIncident: () => ({ ...ROOT, ...fields, incidentType: "invoiceMismatch" }),
    })

    expect(await reader.read(IncidentId("inc-1"))).toBeUndefined()
  })

  it("has no details for an incident copied up from a called instance", async () => {
    const { port, reader } = readerOver({
      getIncident: () => ({ ...ROOT, id: "inc-2", rootCauseIncidentId: "inc-1" }),
    })

    expect(await reader.read(IncidentId("inc-2"))).toBeUndefined()
    expect(port.calls).toHaveLength(1)
  })

  it.each([
    ["missing", 404, "InvalidRequestException"],
    ["gone meanwhile", 500, "NullValueException"],
  ])("has no details for an incident that is %s", async (_name, status, type) => {
    const { reader } = readerOver({
      getIncident: () => {
        throw fakeFailure(status, type)
      },
    })

    expect(await reader.read(IncidentId("inc-1"))).toBeUndefined()
  })

  it("has no details for an id no engine assigns, without a request", async () => {
    const { port, reader } = readerOver({})

    expect(await reader.read(IncidentId("inc/1"))).toBeUndefined()
    expect(port.calls).toStrictEqual([])
  })

  it("fails on any other failure and on an answer it cannot use", async () => {
    const failing = readerOver({
      getIncident: () => {
        throw fakeFailure(500, "ProcessEngineException")
      },
    })
    await expect(failing.reader.read(IncidentId("inc-1"))).rejects.toThrow(
      "HTTP 500 ProcessEngineException",
    )
    const unusable = readerOver({ getIncident: () => ({ ...ROOT, id: undefined }) })
    const error = await unusable.reader.read(IncidentId("inc-1")).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(RuntimeError)
    expect(error).toMatchObject({ failure: "unexpectedResponse", message: "id is missing" })
  })
})
