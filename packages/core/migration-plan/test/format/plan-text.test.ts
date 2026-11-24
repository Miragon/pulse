import { describe, expect, test } from "vitest"
import {
  MigrationPlanParser,
  MigrationPlanText,
  type MigrationPlanDefinition,
} from "../../src/index.js"

const EXAMPLE = `{
  "schemaVersion": 1,
  "bpmnProcessId": "order-fulfillment",
  "source": {
    "version": 3
  },
  "target": {
    "version": 4
  },
  "mappings": [
    {
      "sourceElementId": "Activity_CheckOrder",
      "targetElementId": "Activity_ReviewOrder"
    },
    {
      "sourceElementId": "Activity_Pack",
      "targetElementId": "Activity_Pack"
    },
    {
      "sourceElementId": "Activity_Pack#multiInstanceBody",
      "targetElementId": "Activity_Pack#multiInstanceBody"
    }
  ]
}
`

const PLAN: MigrationPlanDefinition = {
  bpmnProcessId: "order-fulfillment",
  source: { version: 3 },
  target: { version: 4 },
  mappings: [
    { sourceElementId: "Activity_CheckOrder", targetElementId: "Activity_ReviewOrder" },
    { sourceElementId: "Activity_Pack", targetElementId: "Activity_Pack" },
    {
      sourceElementId: "Activity_Pack#multiInstanceBody",
      targetElementId: "Activity_Pack#multiInstanceBody",
    },
  ],
}

function pair(sourceElementId: string): { sourceElementId: string; targetElementId: string } {
  return { sourceElementId, targetElementId: "Task_End" }
}

describe("the text of a plan", () => {
  test("is the plan file: its keys in order, two spaces, the mappings sorted by source, a last line break", () => {
    const shuffled = { ...PLAN, mappings: [...PLAN.mappings].reverse() }

    expect(MigrationPlanText.of(shuffled)).toBe(EXAMPLE)
  })

  test("reads back as the plan it was written from, with no note", () => {
    expect(MigrationPlanParser.parse(MigrationPlanText.of(PLAN))).toStrictEqual({
      plan: PLAN,
      notes: [],
    })
  })

  test("keeps a $schema it is given first, and reads back as the same plan with no note", () => {
    const text = MigrationPlanText.of(PLAN, { schema: "./migration-plan.schema.json" })

    expect(
      text.startsWith('{\n  "$schema": "./migration-plan.schema.json",\n  "schemaVersion": 1,'),
    ).toBe(true)
    expect(MigrationPlanParser.parse(text)).toStrictEqual({ plan: PLAN, notes: [] })
    expect(MigrationPlanText.of(PLAN, {})).toBe(MigrationPlanText.of(PLAN))
  })

  test("sorts the sources by their code units, not by a language", () => {
    const text = MigrationPlanText.of({
      ...PLAN,
      mappings: [pair("b"), pair("Ä"), pair("a"), pair("B"), pair("a_2"), pair("a#x")],
    })
    const parsed = MigrationPlanParser.parse(text)

    expect("plan" in parsed && parsed.plan.mappings.map((m) => m.sourceElementId)).toStrictEqual([
      "B",
      "a",
      "a#x",
      "a_2",
      "b",
      "Ä",
    ])
  })

  test("holds only the keys of a plan, whatever else the plan it is given carries", () => {
    const draft = {
      ...PLAN,
      schemaVersion: 2,
      tenantId: "north",
      source: { version: 3, definitionId: "order-fulfillment:3:def-3" },
      mappings: [{ ...pair("Activity_Pack"), from: "--map" }],
    }

    expect(MigrationPlanText.of(draft)).toBe(
      MigrationPlanText.of({ ...PLAN, mappings: [pair("Activity_Pack")] }),
    )
    expect(MigrationPlanText.of(draft)).not.toMatch(/north|def-3|--map|"schemaVersion": 2/)
  })

  test.each([
    [
      "a definition id for the process",
      { ...PLAN, bpmnProcessId: "order-fulfillment:3:def-3" },
      "bpmnProcessId must be a BPMN process id: letters, digits, _, . or -, starting with a letter or _, at most 255 characters",
    ],
    [
      "one version twice",
      { ...PLAN, target: { version: 3 } },
      "target.version must name another version than source.version",
    ],
    [
      "one source twice",
      { ...PLAN, mappings: [pair("Task_A"), pair("Task_A")] },
      "mappings[1].sourceElementId maps an element that mappings[0] maps already; a plan maps each element once",
    ],
    [
      "a version 0 and an id with two scope parts",
      { ...PLAN, source: { version: 0 }, mappings: [pair("a#b#c")] },
      "source.version must be a version number from 1 to 2147483647; mappings[0].sourceElementId must be a BPMN element id, or an element id with one # part for its scope",
    ],
  ])("is refused for a plan its readers would refuse: %s", (_name, draft, problems) => {
    expect(() => MigrationPlanText.of(draft)).toThrow(
      new Error(`Pulse writes no plan it refuses to read: ${problems}`),
    )
  })
})
