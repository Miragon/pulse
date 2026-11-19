import { describe, expect, it } from "vitest"
import { isRootIncident, rootIdOfCopy } from "./root-incident.js"

describe("the root incident rule", () => {
  it("reads an incident that names itself as its root incident as a root", () => {
    const incident = { id: "inc-1", rootCauseIncidentId: "inc-1" }
    expect(isRootIncident(incident)).toBe(true)
    expect(rootIdOfCopy(incident)).toBeUndefined()
  })

  it("reads an incident that names another incident as a copy of that one", () => {
    const incident = { id: "inc-2", rootCauseIncidentId: "inc-1" }
    expect(isRootIncident(incident)).toBe(false)
    expect(rootIdOfCopy(incident)).toBe("inc-1")
  })

  it.each([
    ["absent", { id: "inc-1" }],
    ["undefined", { id: "inc-1", rootCauseIncidentId: undefined }],
    ["null", { id: "inc-1", rootCauseIncidentId: null }],
    ["empty", { id: "inc-1", rootCauseIncidentId: "" }],
    ["no string", { id: "inc-1", rootCauseIncidentId: 7 }],
  ])("reads an incident whose root incident is %s as a root", (_kind, incident) => {
    expect(isRootIncident(incident)).toBe(true)
    expect(rootIdOfCopy(incident)).toBeUndefined()
  })

  it("reads an incident without an id that names a root as a copy of it", () => {
    for (const incident of [
      { rootCauseIncidentId: "inc-1" },
      { id: "", rootCauseIncidentId: "inc-1" },
      { id: null, rootCauseIncidentId: "inc-1" },
    ]) {
      expect(isRootIncident(incident)).toBe(false)
      expect(rootIdOfCopy(incident)).toBe("inc-1")
    }
  })

  it("reads an incident that names neither as a root", () => {
    expect(isRootIncident({})).toBe(true)
    expect(rootIdOfCopy({ id: "", rootCauseIncidentId: "" })).toBeUndefined()
  })

  it("compares the ids exactly, case and all", () => {
    expect(rootIdOfCopy({ id: "inc-1", rootCauseIncidentId: "INC-1" })).toBe("INC-1")
    expect(rootIdOfCopy({ id: "inc-1", rootCauseIncidentId: "inc-1 " })).toBe("inc-1 ")
  })

  it("reads an engine answer as it stands, its other fields aside", () => {
    const answer: Readonly<Record<string, unknown>> = {
      id: "inc-2",
      rootCauseIncidentId: "inc-1",
      causeIncidentId: "inc-2",
      incidentType: "failedJob",
    }
    expect(rootIdOfCopy(answer)).toBe("inc-1")
  })
})
