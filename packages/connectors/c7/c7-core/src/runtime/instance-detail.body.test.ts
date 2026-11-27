import {
  BpmnProcessId,
  DefinitionId,
  type DefinitionRef,
  IncidentId,
  InstanceId,
} from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { fakePort } from "../testing/fake-port.js"
import type { IncidentView, WaitState as InspectedWait } from "../types.js"
import { InstanceDetailReader } from "./instance-detail-reader.js"
import { instanceDetailOf } from "./instance-detail.js"
import type { InspectView } from "./instance-inspection.js"

/**
 * A multi-instance body in an instance's detail, as CIB seven 3.0 and Operaton 2.1.5 answer it: a
 * parallel multi-instance task whose body waits asynchronously reports its token, its job and its
 * incident under the body's own id (`<id>#multiInstanceBody`), which no shape of the diagram has.
 * The detail puts the body's wait state and root incident on the activity it repeats, so the
 * screens mark and name the element; the path keeps the body's run under its own id beside its
 * items' runs, which name the element; each root incident's cause keeps the id the engine raised it
 * at, which the cockpit's cause view reads.
 */

const T0 = "2026-11-27T03:46:21.600+0000"
const T1 = "2026-11-27T03:46:21.712+0000"
const APPROVE = "Activity_ApproveEach"
const BODY = `${APPROVE}#multiInstanceBody`
const ORDER: DefinitionRef = {
  id: DefinitionId("order:1:d1"),
  bpmnProcessId: BpmnProcessId("order"),
  tenantId: null,
  version: 1,
}
const MESSAGE = "Unknown property used in expression: ${copies}"
const BODY_INCIDENT: IncidentView = {
  id: "i1",
  type: "failedJob",
  activityId: BODY,
  message: MESSAGE,
  jobId: "j1",
  since: T1,
}
const BODY_WAIT: InspectedWait = {
  kind: "asyncContinuation",
  activityId: BODY,
  activityType: "multiInstanceBody",
  since: T0,
  incidentId: "i1",
  jobId: "j1",
  retries: 0,
}
const VIEW: InspectView = {
  id: "p1",
  definition: { id: ORDER.id, key: "order", version: 1 },
  versions: new Map(),
  state: "ACTIVE",
  waitingAt: [BODY_WAIT],
  incidents: [BODY_INCIDENT],
  children: [],
  timeline: [],
  next: [],
}

function detailOf(view: Partial<InspectView> = {}) {
  return instanceDetailOf({ ...VIEW, ...view }, new Map([["p1", ORDER]]), undefined)
}

describe("a multi-instance body in an instance's detail", () => {
  it("waits on the activity it repeats, where its own token waits for its job", () => {
    expect(detailOf().waitStates).toStrictEqual([
      {
        instanceId: "p1",
        elementId: APPROVE,
        since: "2026-11-27T03:46:21.600Z",
        incidentId: "i1",
        kind: "asyncContinuation",
        retriesLeft: 0,
      },
    ])
  })

  it("holds a boundary event attached to the activity it repeats", () => {
    const timer: InspectedWait = {
      kind: "timer",
      activityId: "Event_Overdue",
      attachedTo: BODY,
      jobId: "j2",
      dueDate: "",
      retries: 3,
    }

    expect(detailOf({ waitingAt: [timer] }).waitStates[0]).toMatchObject({
      elementId: "Event_Overdue",
      attachedToElementId: APPROVE,
    })
  })

  it("raises its root incident at the activity it repeats", () => {
    expect(detailOf().incidents).toMatchObject([
      { id: "i1", instanceId: "p1", elementId: APPROVE, message: MESSAGE, job: { id: "j1" } },
    ])
  })

  it("keeps its run on the path under its own id beside its items' runs, which name the element", () => {
    const run = { activityType: "userTask", startTime: T1 }
    const timeline = [
      { activityId: BODY, activityType: "multiInstanceBody", startTime: T0 },
      { ...run, activityId: APPROVE, activityName: "Approve each" },
      { ...run, activityId: APPROVE, activityName: "Approve each" },
    ]

    expect(
      detailOf({ waitingAt: [], incidents: [], timeline }).path.map((step) => step.elementId),
    ).toStrictEqual([BODY, APPROVE, APPROVE])
  })
})

describe("the causes of an instance's root incidents", () => {
  it("name the activity as the engine raised it: a body's by its own id, an item's by the element", async () => {
    const item: IncidentView = { ...BODY_INCIDENT, id: "i2", activityId: APPROVE, since: T0 }
    const view = { ...VIEW, incidents: [BODY_INCIDENT, item] }
    const port = fakePort({ getVariableInstances: () => [] })
    const reader = new InstanceDetailReader(port, { inspect: () => Promise.resolve(view) })

    const read = await reader.readWithCauses(InstanceId("p1"))

    expect(read?.detail.incidents.map((incident) => incident.elementId)).toStrictEqual([
      APPROVE,
      APPROVE,
    ])
    const signature = "unknown property used in expression: ${copies}"
    expect(read?.causes).toStrictEqual(
      new Map([
        [
          IncidentId("i1"),
          {
            activityId: BODY,
            incidentType: "failedJob",
            signature,
            key: `${BODY}::failedJob::${signature}`,
          },
        ],
        [
          IncidentId("i2"),
          {
            activityId: APPROVE,
            incidentType: "failedJob",
            signature,
            key: `${APPROVE}::failedJob::${signature}`,
          },
        ],
      ]),
    )
    expect(await reader.read(InstanceId("p1"))).toStrictEqual(read?.detail)
  })
})
