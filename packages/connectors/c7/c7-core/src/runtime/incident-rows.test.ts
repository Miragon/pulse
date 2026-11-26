import { RuntimeError } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { incidentRowOf, incidentRowsOf, recoveryIdOf } from "./incident-rows.js"

const REQUIRED = {
  id: "inc-1",
  incidentType: "failedJob",
  activityId: "Activity_Charge",
  incidentTimestamp: "2026-10-21T18:44:04.587+0000",
}
const FULL = {
  ...REQUIRED,
  processInstanceId: "p1",
  processDefinitionId: "order:1:x",
  incidentMessage: "boom",
  rootCauseIncidentId: "inc-1",
  configuration: "job-1",
}

function expectUnexpected(read: () => unknown, message: string): void {
  try {
    read()
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(RuntimeError)
    expect(error).toMatchObject({ failure: "unexpectedResponse", message })
    return
  }
  throw new Error("the read did not fail")
}

describe("incidentRowOf", () => {
  it("reads every field of an incident", () => {
    expect(incidentRowOf({ ...FULL, causeIncidentId: "inc-1" })).toStrictEqual(FULL)
  })

  it("leaves out what the incident does not name", () => {
    expect(
      incidentRowOf({ ...REQUIRED, processInstanceId: null, incidentMessage: null }),
    ).toStrictEqual(REQUIRED)
  })

  it.each([
    ["no object", [], "incident is not an object"],
    ["without its id", { ...FULL, id: undefined }, "id is missing"],
    ["without its type", { ...FULL, incidentType: null }, "incidentType is missing"],
    ["without its element", { ...FULL, activityId: undefined }, "activityId is missing"],
    ["without its time", { ...FULL, incidentTimestamp: null }, "incidentTimestamp is missing"],
    [
      "with an instance that is no text",
      { ...FULL, processInstanceId: 1 },
      "processInstanceId is not a string",
    ],
    [
      "with a version that is no text",
      { ...FULL, processDefinitionId: 1 },
      "processDefinitionId is not a string",
    ],
    [
      "with a message that is no text",
      { ...FULL, incidentMessage: 1 },
      "incidentMessage is not a string",
    ],
    [
      "with a root cause that is no text",
      { ...FULL, rootCauseIncidentId: 1 },
      "rootCauseIncidentId is not a string",
    ],
    [
      "with a configuration that is no text",
      { ...FULL, configuration: 1 },
      "configuration is not a string",
    ],
  ])("fails an incident %s as unexpected", (_kind, answer, message) => {
    expectUnexpected(() => incidentRowOf(answer), message)
  })
})

describe("incidentRowsOf", () => {
  it("reads every incident of a list", () => {
    expect(incidentRowsOf([FULL, REQUIRED])).toStrictEqual([FULL, REQUIRED])
    expect(incidentRowsOf([])).toStrictEqual([])
  })

  it.each([
    ["no list", { incidents: [] }, "incidents is not a list"],
    ["a row that is no object", [FULL, "inc-2"], "incidents[1] is not an object"],
  ])("fails %s as unexpected", (_kind, answer, message) => {
    expectUnexpected(() => incidentRowsOf(answer), message)
  })
})

describe("recoveryIdOf", () => {
  it("is the job a failed job names", () => {
    expect(recoveryIdOf({ incidentType: "failedJob", configuration: "job-1" })).toBe("job-1")
  })

  it("is the external task a failed external task names", () => {
    expect(recoveryIdOf({ incidentType: "failedExternalTask", configuration: "task-1" })).toBe(
      "task-1",
    )
  })

  it.each([
    ["a custom type", { incidentType: "invoiceMismatch", configuration: "inv-1" }],
    ["a failed job without a configuration", { incidentType: "failedJob" }],
    ["an empty configuration", { incidentType: "failedExternalTask", configuration: "" }],
  ])("is none for %s", (_name, incident) => {
    expect(recoveryIdOf(incident)).toBeUndefined()
  })
})
