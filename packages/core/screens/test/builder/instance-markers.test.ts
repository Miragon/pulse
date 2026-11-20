import { ElementId, IsoTimestamp, type InstanceDetail } from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { InstanceScreen } from "../../src/builder/index.js"
import { Instances } from "./support/instances.js"

const DONE = IsoTimestamp("2026-10-21T08:00:01.000Z")

function markersOf(changes: Partial<InstanceDetail>, diagramXml?: string) {
  const detail = Instances.detail(changes)
  return InstanceScreen.of(Instances.facts(detail, { diagramXml })).markers
}

function run(elementId: string, endedAt?: IsoTimestamp) {
  return {
    elementId: ElementId(elementId),
    startedAt: Instances.SINCE,
    canceled: false,
    ...(endedAt === undefined ? {} : { endedAt }),
  }
}

const COLLAPSED = `<definitions><process id="p">
<subProcess id="Sub_Outer"><subProcess id="Sub_Inner"><task id="Task_Deep"/></subProcess></subProcess>
<subProcess id="Sub_Open"><task id="Task_Shown"/></subProcess>
</process><bpmndi:BPMNDiagram><bpmndi:BPMNPlane>
<bpmndi:BPMNShape id="s1" bpmnElement="Sub_Outer" isExpanded="false"/>
<bpmndi:BPMNShape id="s2" bpmnElement="Sub_Inner" isExpanded="true"/>
<bpmndi:BPMNShape id="s3" bpmnElement="Sub_Open" isExpanded="true"/>
</bpmndi:BPMNPlane></bpmndi:BPMNDiagram></definitions>`

describe("the markers of an instance's diagram", () => {
  test("mark an incident, a wait and each element the instance completed, not one it still runs", () => {
    expect(
      markersOf({
        incidents: [Instances.incident("a", { elementId: ElementId("Activity_Charge") })],
        waitStates: [Instances.wait({ elementId: ElementId("Activity_Review") })],
        path: [run("Event_Start", DONE), run("Activity_Review")],
      }),
    ).toEqual([
      { elementId: "Activity_Charge", kind: "incident" },
      { elementId: "Activity_Review", kind: "waiting" },
      { elementId: "Event_Start", kind: "completed" },
    ])
  })

  test("mark the call activity that leads to an incident or a wait two levels down", () => {
    expect(
      markersOf({
        ...Instances.chain(),
        incidents: [Instances.incident("down", { instanceId: Instances.GRANDCHILD })],
        waitStates: [Instances.wait({ instanceId: Instances.CHILD })],
      }),
    ).toEqual([{ elementId: "Activity_Call", kind: "incidentInCalledInstance" }])
  })

  test("mark nothing for an incident or a wait in a called instance the tree does not lead to", () => {
    expect(
      markersOf({
        incidents: [Instances.incident("lost", { instanceId: Instances.CHILD })],
        waitStates: [Instances.wait({ instanceId: Instances.CHILD })],
      }),
    ).toEqual([])
  })

  test("keep the strongest marker per element where it first appears", () => {
    const element = { elementId: Instances.ELEMENT }

    expect(
      markersOf({
        ...Instances.chain(),
        path: [run("Activity_Wait", DONE), run("Activity_Call", DONE)],
        waitStates: [
          Instances.wait(element),
          Instances.wait({ elementId: ElementId("Activity_Call") }),
        ],
        incidents: [
          Instances.incident("down", { instanceId: Instances.CHILD }),
          Instances.incident("here", element),
        ],
      }),
    ).toEqual([
      { elementId: "Activity_Call", kind: "incidentInCalledInstance" },
      { elementId: "Activity_Wait", kind: "incident" },
    ])
    expect(
      markersOf({ path: [run("Activity_Wait", DONE)], waitStates: [Instances.wait(element)] }),
    ).toEqual([{ elementId: "Activity_Wait", kind: "waiting" }])
  })

  test("let an incident at a call activity outrank the incident in the instance it called", () => {
    expect(
      markersOf({
        ...Instances.chain(),
        incidents: [
          Instances.incident("down", { instanceId: Instances.CHILD }),
          Instances.incident("here", { elementId: Instances.CALL }),
        ],
      }),
    ).toEqual([{ elementId: "Activity_Call", kind: "incident" }])
  })

  test("mark no element the instance still runs and does not wait at", () => {
    expect(markersOf({ path: [run("Activity_Call")] })).toEqual([])
  })

  test("roll a marker up onto every collapsed sub-process around it, never an expanded one", () => {
    expect(
      markersOf(
        {
          waitStates: [
            Instances.wait({ elementId: ElementId("Task_Deep") }),
            Instances.wait({ elementId: ElementId("Task_Shown") }),
          ],
          path: [run("Sub_Outer", DONE)],
        },
        COLLAPSED,
      ),
    ).toEqual([
      { elementId: "Task_Deep", kind: "waiting" },
      { elementId: "Sub_Outer", kind: "waiting" },
      { elementId: "Task_Shown", kind: "waiting" },
    ])
  })

  test("roll nothing up without a diagram", () => {
    expect(
      markersOf({ waitStates: [Instances.wait({ elementId: ElementId("Task_Deep") })] }, undefined),
    ).toEqual([{ elementId: "Task_Deep", kind: "waiting" }])
  })
})
