import {
  BpmnProcessId,
  ElementId,
  InstanceId,
  type CalledProcess,
  type InstanceDetail,
} from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { CallLinks, InstanceScreen, ScreenJson } from "../../src/builder/index.js"
import { Instances } from "./support/instances.js"

const SCORING: CalledProcess = {
  elementId: Instances.CALL,
  bpmnProcessId: BpmnProcessId("scoring"),
  definition: Instances.SCORING,
}
const ARCHIVE: CalledProcess = {
  elementId: ElementId("Activity_Archive"),
  bpmnProcessId: BpmnProcessId("archive"),
}
const NOTIFY: CalledProcess = {
  elementId: ElementId("Activity_Notify"),
  bpmnProcessId: BpmnProcessId("notify"),
  definition: { ...Instances.SCORING, bpmnProcessId: BpmnProcessId("notify") },
}

function callsOf(changes: Partial<InstanceDetail>, calledProcesses: readonly CalledProcess[]) {
  const facts = Instances.facts(Instances.detail(changes), { calledProcesses })
  return ScreenJson.instance(InstanceScreen.of(facts)).calls
}

describe("the call links of a process", () => {
  test("open the version a call activity starts, or name the process the engine lacks", () => {
    const links = CallLinks.of([SCORING, ARCHIVE])

    expect(ScreenJson.callLinks(links.links())).toEqual([
      {
        elementId: "Activity_Call",
        kind: "definition",
        definition: { id: "scoring:3", bpmnProcessId: "scoring", version: 3 },
      },
      { elementId: "Activity_Archive", kind: "missing", bpmnProcessId: "archive" },
    ])
    expect(links.target("Activity_Elsewhere")).toBeUndefined()
  })
})

describe("the call links of an instance", () => {
  test("open the instances a call activity called, those with an incident first", () => {
    const quiet = InstanceId("quiet")
    const failing = InstanceId("failing")

    const calls = callsOf(
      {
        calledInstances: [
          Instances.called(quiet, Instances.ROOT, { state: "completed" }),
          Instances.called(failing, Instances.ROOT),
        ],
        incidents: [Instances.incident("a", { instanceId: failing })],
      },
      [SCORING],
    )

    expect(calls).toEqual([
      {
        elementId: "Activity_Call",
        kind: "instances",
        instances: [
          { id: "failing", bpmnProcessId: "scoring", state: "running", withIncident: true },
          { id: "quiet", bpmnProcessId: "scoring", state: "completed", withIncident: false },
        ],
      },
    ])
  })

  test("count an incident two levels down for the instance the call activity called", () => {
    const calls = callsOf(
      {
        ...Instances.chain(),
        incidents: [Instances.incident("down", { instanceId: Instances.GRANDCHILD })],
      },
      [],
    )

    expect(calls).toEqual([
      {
        elementId: "Activity_Call",
        kind: "instances",
        instances: [
          { id: Instances.CHILD, bpmnProcessId: "scoring", state: "running", withIncident: true },
        ],
      },
    ])
  })

  test("open the called process where nothing was called yet, each call activity once", () => {
    const calls = callsOf(
      { calledInstances: [Instances.called(Instances.CHILD, Instances.ROOT)] },
      [SCORING, NOTIFY, ARCHIVE],
    )

    expect(calls.map(({ elementId, kind }) => [elementId, kind])).toEqual([
      ["Activity_Call", "instances"],
      ["Activity_Notify", "definition"],
      ["Activity_Archive", "missing"],
    ])
  })

  test("leave out a called instance that names no call activity", () => {
    const calls = callsOf(
      {
        calledInstances: [
          { ...Instances.called(Instances.CHILD, Instances.ROOT), calledFromElementId: undefined },
        ] as never,
      },
      [],
    )

    expect(calls).toEqual([])
  })

  test("give the panels the instances as the contract reads them", () => {
    const detail = Instances.detail(Instances.chain())

    const target = CallLinks.of([], detail).target("Activity_Call")

    expect(target).toEqual({
      kind: "instances",
      choices: [{ instance: Instances.chain().calledInstances[0], withIncident: false }],
    })
  })
})
