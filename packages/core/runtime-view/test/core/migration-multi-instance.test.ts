import {
  BpmnProcessId,
  DefinitionId,
  ElementId,
  InstanceId,
  type DefinitionRef,
  type ElementStatistics,
} from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { MigrationReads, type MigrationState } from "../../src/core/panels/migration-reads.js"
import { MigrationRows } from "../../src/core/views/migration-rows.js"

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
  <bpmn:process id="shop" isExecutable="true">
    <bpmn:startEvent id="Start" />
    <bpmn:userTask id="Approve" name="Approve each">
      <bpmn:multiInstanceLoopCharacteristics />
    </bpmn:userTask>
    <bpmn:endEvent id="End" />
  </bpmn:process>
</bpmn:definitions>`

const IDS = ["a", "b"].map((id) => InstanceId(id))

function ref(version: number): DefinitionRef {
  return {
    id: DefinitionId(`shop:${version}`),
    bpmnProcessId: BpmnProcessId("shop"),
    version,
    name: "Shop",
  }
}

function at(elementId: string, active: number, incidents: number): ElementStatistics {
  return { elementId: ElementId(elementId), active, incidents, incidentsInCalledInstances: 0 }
}

function state(statistics: readonly ElementStatistics[]): MigrationState {
  return {
    asOf: new Date("2026-11-26T10:00:00Z"),
    versions: [2, 1].map((version) => ({
      definition: ref(version),
      running: 0,
      withIncident: 0,
      incidents: 0,
    })),
    source: ref(1),
    target: ref(2),
    sourceXml: XML,
    targetXml: XML,
    statistics,
    instanceIds: IDS,
    leftOut: [],
    waiting: new Map([["Approve", [IDS[0]!]]]),
    mappings: [],
    problems: [],
    checking: false,
    checkFailure: undefined,
    focused: undefined,
  }
}

describe("a migration's tokens at a multi-instance task, its body's counts on it as the runtime reads them", () => {
  test("count the items' tokens and the body's incident at the task the plan maps", () => {
    const counted = state([at("Approve", 3, 1)])

    expect(MigrationReads.tokenElements(counted)).toEqual(["Approve"])
    expect(new MigrationRows(counted).blocked()).toEqual({
      count: 1,
      labels: ["Approve each"],
      countable: true,
    })
  })

  test("count a token only the body's incident holds at the task", () => {
    expect(MigrationReads.tokenElements(state([at("Approve", 0, 1)]))).toEqual(["Approve"])
  })

  test("count no id the diagram does not draw, as a body's id was before the runtime added it", () => {
    expect(MigrationReads.tokenElements(state([at("Approve#multiInstanceBody", 0, 1)]))).toEqual([])
  })
})
