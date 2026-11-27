import { ElementId, type Incident, type InstanceDetail } from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { InstanceScreen } from "../../src/builder/index.js"
import { Instances } from "./support/instances.js"

function headlineOf(changes: Partial<InstanceDetail>) {
  return InstanceScreen.of(Instances.facts(Instances.detail(changes))).headline
}

const HERE = Instances.incident("here", { elementId: ElementId("Activity_Charge") })
const DOWN = Instances.incident("down", {
  instanceId: Instances.GRANDCHILD,
  elementId: ElementId("Activity_Score"),
})

function instance(state: InstanceDetail["instance"]["state"]) {
  return { instance: Instances.summary({ state }) }
}

describe("the head strip of an instance", () => {
  test("stays away for a running instance without an incident", () => {
    expect(headlineOf({})).toBeUndefined()
  })

  test("says that an instance is suspended", () => {
    expect(headlineOf(instance("suspended"))).toEqual({ code: "suspended" })
  })

  test("says that an instance has ended, completed or cancelled", () => {
    expect(headlineOf(instance("completed"))).toEqual({ code: "ended", state: "completed" })
    expect(headlineOf(instance("terminated"))).toEqual({ code: "ended", state: "terminated" })
    expect(headlineOf({ ...instance("completed"), incidents: [HERE] })).toEqual({
      code: "ended",
      state: "completed",
    })
  })

  test("names the incident an instance waits at, where it is and since when", () => {
    expect(headlineOf({ incidents: [HERE] })).toEqual({
      code: "incident",
      incidentId: "here",
      elementId: "Activity_Charge",
      since: Instances.SINCE,
      suspended: false,
    })
  })

  test("names the call activity an instance waits at for an incident in a called instance", () => {
    expect(headlineOf({ ...Instances.chain(), incidents: [DOWN] })).toEqual({
      code: "incidentInCalledInstance",
      incidentId: "down",
      elementId: "Activity_Call",
      liesIn: { instanceId: Instances.GRANDCHILD, bpmnProcessId: "bureau" },
      since: Instances.SINCE,
      suspended: false,
    })
  })

  test("names no element for an incident in a called instance the tree does not lead to", () => {
    expect(headlineOf({ incidents: [DOWN] })).toEqual({
      code: "incidentInCalledInstance",
      incidentId: "down",
      elementId: null,
      liesIn: { instanceId: Instances.GRANDCHILD },
      since: Instances.SINCE,
      suspended: false,
    })
  })

  test("keeps a suspended instance's one incident and says it is suspended", () => {
    expect(headlineOf({ ...instance("suspended"), incidents: [HERE] })).toMatchObject({
      code: "incident",
      suspended: true,
    })
    expect(
      headlineOf({ ...instance("suspended"), ...Instances.chain(), incidents: [DOWN] }),
    ).toMatchObject({ code: "incidentInCalledInstance", suspended: true })
  })

  test("counts several incidents, here and in called instances, and says when it is suspended", () => {
    const incidents: Incident[] = [HERE, DOWN, Instances.incident("third")]

    expect(headlineOf({ incidents })).toEqual({ code: "incidents", count: 3, suspended: false })
    expect(headlineOf({ ...instance("suspended"), incidents: [HERE, DOWN] })).toEqual({
      code: "incidents",
      count: 2,
      suspended: true,
    })
    expect(headlineOf({ ...instance("terminated"), incidents: [HERE, DOWN] })).toEqual({
      code: "incidents",
      count: 2,
      suspended: false,
    })
  })

  test("counts the incidents of cut lists as at least so many, one included, never one named incident", () => {
    expect(headlineOf({ incidents: [HERE], truncated: true })).toEqual({
      code: "incidentsAtLeast",
      count: 1,
      suspended: false,
    })
    expect(
      headlineOf({ ...instance("suspended"), incidents: [HERE, DOWN], truncated: true }),
    ).toEqual({ code: "incidentsAtLeast", count: 2, suspended: true })
  })

  test("says nothing of incidents for cut lists that hold none", () => {
    expect(headlineOf({ truncated: true })).toBeUndefined()
    expect(headlineOf({ ...instance("suspended"), truncated: true })).toEqual({
      code: "suspended",
    })
  })
})
