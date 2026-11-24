import {
  BpmnProcessId,
  DefinitionId,
  ElementId,
  type DefinitionRef,
  type ElementMapping,
  type ElementStatistics,
} from "@miragon/pulse-engine-core"
import { MigrationPlanVocabulary, type MigrationPlanProblem } from "@miragon/pulse-migration-plan"
import { describe, expect, test } from "vitest"
import type { RefusedMapping } from "../../src/core/plans/plan-mappings.js"
import { PlanProblems } from "../../src/core/plans/plan-problems.js"
import { PlanViewBuilder, type PlanState } from "../../src/core/plans/plan-view-builder.js"

const SOURCE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
  <bpmn:process id="shop" isExecutable="true">
    <bpmn:startEvent id="Start" name="Order placed" />
    <bpmn:userTask id="Review" name="Review order" />
    <bpmn:boundaryEvent id="Overdue" name="3 days" attachedToRef="Review">
      <bpmn:timerEventDefinition id="Timer" />
    </bpmn:boundaryEvent>
    <bpmn:callActivity id="Ship" name="Ship" />
    <bpmn:intermediateCatchEvent id="Paid" name="Paid" />
    <bpmn:subProcess id="Pack" name="Pack"><bpmn:userTask id="Weigh" name="Weigh" /></bpmn:subProcess>
    <bpmn:endEvent id="End" />
  </bpmn:process>
</bpmn:definitions>`
const TARGET_XML = SOURCE_XML.replace(
  'id="Review" name="Review order"',
  'id="Check" name="Check order"',
)
const PLAIN_XML = `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
  <bpmn:process id="shop"><bpmn:userTask id="Review" name="Review order" /></bpmn:process>
</bpmn:definitions>`

const ENGINE = { name: "shop-dev", environment: "local", host: "localhost" } as const

function ref(version: number): DefinitionRef {
  return {
    id: DefinitionId(`shop:${version}`),
    bpmnProcessId: BpmnProcessId("shop"),
    version,
    name: "Shop",
  }
}

function pair(source: string, target = source): ElementMapping {
  return { sourceElementId: ElementId(source), targetElementId: ElementId(target) }
}

function statistic(elementId: string, active: number, incidents = 0): ElementStatistics {
  return { elementId: ElementId(elementId), active, incidents, incidentsInCalledInstances: 0 }
}

const SAME = ["Overdue", "Ship", "Paid", "Pack", "Weigh"].map((id) => pair(id))

function state(change: Partial<PlanState> = {}): PlanState {
  return {
    asOf: new Date("2026-11-24T10:00:00Z"),
    versions: [2, 1].map((version) => ({
      definition: ref(version),
      running: 0,
      withIncident: 0,
      incidents: 0,
    })),
    source: ref(1),
    target: ref(2),
    sourceXml: SOURCE_XML,
    targetXml: TARGET_XML,
    statistics: [statistic("Review", 2, 1), statistic("Pack", 1), statistic("Weigh", 1)],
    instanceIds: [],
    leftOut: [],
    waiting: new Map(),
    mappings: [pair("Review", "Check"), ...SAME],
    problems: [],
    checking: false,
    checkFailure: undefined,
    focused: undefined,
    fileName: "shop-v1-to-v2.migration.json",
    refused: [],
    notes: [],
    running: 3,
    withIncident: 1,
    ...change,
  }
}

function viewOf(plan: PlanState) {
  return PlanViewBuilder.build(plan, { engine: ENGINE })
}

function refused(source: string, target: string, refusal: RefusedMapping["refusal"]) {
  return { mapping: { sourceElementId: source, targetElementId: target }, refusal }
}

describe("the verdict of a plan", () => {
  test("names the pairs it left out before anything else", () => {
    const view = viewOf(
      state({
        mappings: SAME,
        refused: [refused("Review", "Ship", "otherKind"), refused("Gone", "Gone", "sourceMissing")],
        problems: [{ mapping: SAME[1]!, message: "Ship cannot become Ship." }],
      }),
    )

    expect(view.verdict).toEqual({
      fits: false,
      text: "Pulse left out 2 mappings of the plan that don't fit v1 and v2 on shop-dev; the engine checked the rest.",
    })
    expect(view.summary).toBe("5 mapped · 2 left out · 1 problem · checked just now")
  })

  test("then the engine's problems with the first of them", () => {
    const problems = [
      { mapping: SAME[1]!, message: "Activities have incompatible types." },
      { message: "The plan is invalid." },
    ]
    const view = viewOf(state({ problems }))

    expect(view.verdict).toEqual({
      fits: false,
      text: "The engine finds 2 problems in the plan: Activities have incompatible types.",
    })
    expect(view.summary).toBe("6 mapped · 2 problems · checked just now")
  })

  test("then the elements where instances wait without a mapping", () => {
    const view = viewOf(state({ mappings: SAME }))

    expect(view.verdict).toEqual({
      fits: false,
      text: "Instances wait at Review order, which has no mapping in v2.",
    })
    expect(view.summary).toBe("5 mapped · 1 without a mapping · checked just now")
  })

  test("says the plan fits only when nothing is in its way", () => {
    const view = viewOf(state())

    expect(view.verdict).toEqual({
      fits: true,
      text: "The engine finds no problem in the plan, and every element where instances wait has a mapping in v2.",
    })
    expect(view.summary).toBe("6 mapped · no problems · checked just now")
  })
})

describe("the rows of a plan", () => {
  test("count the tokens of each element where they wait, and never their sum", () => {
    const view = viewOf(state())

    expect(view.rows.filter((row) => row.tokens !== undefined).map((row) => row.tokens)).toEqual([
      3, 1,
    ])
    expect(view.rows.find((row) => row.sourceElementId === "Pack")).not.toHaveProperty("tokens")
    const words = [
      view.summary,
      view.verdict.text,
      ...view.facts,
      ...view.notices.map((notice) => notice.title),
    ]
    expect(words.join(" ")).not.toMatch(/\b4\b/)
    expect(view).not.toHaveProperty("tokens")
  })

  test("show a pair left out with its target from the file, first, and one of its own when its source has no row", () => {
    const view = viewOf(
      state({
        mappings: SAME,
        refused: [refused("Review", "Ship", "otherKind"), refused("Start", "Start", "notMappable")],
        problems: [{ mapping: SAME[2]!, message: "Paid cannot become Paid." }],
      }),
    )

    expect(view.rows.slice(0, 4)).toEqual([
      {
        sourceElementId: "Review",
        sourceLabel: "Review order",
        targetElementId: "Ship",
        targetLabel: "Ship",
        tokens: 3,
        refused: "Ship in v2 is of another kind than Review order.",
        unmappedTokens: true,
      },
      {
        sourceElementId: "Start",
        sourceLabel: "Order placed",
        targetElementId: "Start",
        targetLabel: "Order placed",
        refused:
          "Order placed in v1 is no element where instances wait, so a migration doesn't map it.",
      },
      {
        sourceElementId: "Paid",
        sourceLabel: "Paid",
        targetElementId: "Paid",
        targetLabel: "Paid",
        problem: "Paid cannot become Paid.",
      },
      {
        sourceElementId: "Overdue",
        sourceLabel: "3 days",
        targetElementId: "Overdue",
        targetLabel: "3 days",
      },
    ])
  })

  test("word each refusal on its row", () => {
    const view = viewOf(
      state({
        mappings: [],
        refused: [
          refused("Gone", "Gone", "sourceMissing"),
          refused("Ship", "Lost", "targetMissing"),
          refused("Review#multiInstanceBody", "Check#multiInstanceBody", "otherScope"),
        ],
      }),
    )

    expect(Object.fromEntries(view.rows.map((row) => [row.sourceElementId, row.refused]))).toEqual(
      expect.objectContaining({
        Gone: "v1 has no element Gone.",
        Ship: "v2 has no element Lost.",
        "Review#multiInstanceBody":
          "Review#multiInstanceBody names a scope that Review order in v1 doesn't have.",
      }),
    )
  })

  test("flag a token element without a mapping and warn of the timer that starts again", () => {
    const view = viewOf(state({ mappings: SAME.slice(1) }))

    expect(view.rows[0]).toMatchObject({ sourceElementId: "Review", unmappedTokens: true })
    expect(view.rows.find((row) => row.sourceElementId === "Overdue")).toMatchObject({
      warning: "The timer 3 days at Review order starts again.",
    })
  })

  test("mark the focused row", () => {
    expect(viewOf(state({ focused: "Ship" })).focused).toBe("Ship")
    expect(viewOf(state())).not.toHaveProperty("focused")
  })
})

describe("what a migration with the plan does", () => {
  test("is said in the order the tab's dialog says it", () => {
    const view = viewOf(state({ mappings: SAME.slice(1) }))

    expect(view.facts).toEqual([
      "3 instances run on v1 now, 1 with incident.",
      "Each migrates on its own; failed ones stay on v1.",
      "The timer 3 days at Review order starts again.",
      "1 has an incident and keeps it; retry it on v2.",
      "Called instances stay on their version.",
      "New or unmapped timers and subscriptions start now.",
      "Migrating can't be undone.",
    ])
  })

  test("is said of one instance and of a model with nothing that triggers or calls", () => {
    const view = viewOf(
      state({
        sourceXml: PLAIN_XML,
        targetXml: PLAIN_XML,
        statistics: [],
        mappings: [pair("Review")],
        running: 1,
        withIncident: 0,
      }),
    )

    expect(view.facts).toEqual([
      "1 instance runs on v1 now, 0 with incident.",
      "If it fails, it stays on v1.",
      "Migrating can't be undone.",
    ])
  })
})

describe("the notices of a plan", () => {
  const STARTS_NOTHING = {
    tone: "info",
    title: "This preview starts nothing.",
    detail:
      "It reads v1 and v2 of shop on shop-dev by their numbers and counts what runs on v1 now. A migration moves only the instances you select in the definition panel, at most 1,000 at a time, and its tab asks the engine for its own mapping.",
    actions: [],
  }

  test("say first that the preview starts nothing", () => {
    expect(viewOf(state()).notices).toEqual([STARTS_NOTHING])
  })

  test("warn when more instances run than a migration moves, and name the versions and the ignored keys", () => {
    const view = viewOf(
      state({
        running: 1204,
        versions: [3, 2, 1].map((version) => ({
          definition: ref(version),
          running: 0,
          withIncident: 0,
          incidents: 0,
        })),
        notes: [
          { path: "title", code: "ignoredKey" },
          { path: "$schema", code: "schemaNotText" },
        ],
      }),
    )

    expect(view.notices).toEqual([
      STARTS_NOTHING,
      {
        tone: "warning",
        title: "More than 1,000 instances run on v1.",
        detail: "The definition panel migrates at most 1,000 at a time.",
        actions: [],
      },
      { tone: "info", title: "v2 is not the latest version (v3).", actions: [] },
      { tone: "info", title: "Pulse ignores 2 keys of the file: title, $schema.", actions: [] },
    ])
    expect(view.facts[0]).toBe("1,204 instances run on v1 now, 1 with incident.")
  })

  test("say when the plan goes back to an older version", () => {
    const view = viewOf(
      state({ source: ref(2), target: ref(1), notes: [{ path: "note", code: "ignoredKey" }] }),
    )

    expect(view.notices.slice(1).map((notice) => notice.title)).toEqual([
      "v1 is older than v2.",
      "Pulse ignores 1 key of the file: note.",
    ])
  })
})

describe("the problems of a plan file", () => {
  const MISSING: MigrationPlanProblem = { path: "source", code: "missing" }

  test("name the first problem with its path and count the rest", () => {
    expect(PlanProblems.broken("a.migration.json", [MISSING])).toEqual({
      title: "Pulse can't preview a.migration.json.",
      detail: "source is missing.",
      canEditConnection: false,
    })
    expect(
      PlanProblems.broken("a.migration.json", [
        {
          path: "(file)",
          code: "tooLarge",
          values: { max: MigrationPlanVocabulary.MAX_PLAN_CHARACTERS },
        },
        MISSING,
        MISSING,
      ]).detail,
    ).toBe("The file is longer than 1048576 characters. And 2 more problems.")
    expect(PlanProblems.broken("a.migration.json", [MISSING, MISSING]).detail).toBe(
      "source is missing. And 1 more problem.",
    )
    expect(PlanProblems.broken("a.migration.json", []).detail).toBe("")
  })
})
