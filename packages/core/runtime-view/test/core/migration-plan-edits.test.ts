import { RuntimeError, type MigrationPlan, type ProcessRuntime } from "@miragon/pulse-engine-core"
import { PatchedRuntime } from "@miragon/pulse-engine-core/testing"
import { MigrationPlanParser } from "@miragon/pulse-migration-plan"
import { describe, expect, test } from "vitest"
import { MigrationPlanPanel } from "../../src/core/plans/migration-plan-panel.js"
import { deferred } from "./support/board-fixture.js"
import { panelFixture } from "./support/panel-fixture.js"
import {
  CHARGE,
  FakePlanSource,
  REVIEW,
  openPlan,
  planText,
  planView,
  same,
} from "./support/plan-fixture.js"
import { WaitGate } from "./support/wait-gate.js"

const CHECK = "Activity_CheckOrder"
const FITS = planText(same(REVIEW, CHARGE))
const CHECK_TASK = `<bpmn:userTask id="${CHECK}" name="Check order" />`

function withCheckTask(plans: MigrationPlan[] = []): (runtime: ProcessRuntime) => ProcessRuntime {
  return (runtime) =>
    new PatchedRuntime(runtime, {
      getDiagramXml: async (definitionId) =>
        (await runtime.getDiagramXml(definitionId))?.replace(
          "</bpmn:process>",
          `${CHECK_TASK}</bpmn:process>`,
        ),
      checkMigration: (plan) => {
        plans.push(plan)
        return Promise.resolve({ problems: [] })
      },
    })
}

function pairsOf(text: string | undefined): string[] {
  const parsed = MigrationPlanParser.parse(text ?? "")
  if ("problems" in parsed) {
    throw new Error("the editor wrote a plan the format refuses")
  }
  return parsed.plan.mappings.map((pair) => `${pair.sourceElementId}>${pair.targetElementId}`)
}

function checksOf(calls: readonly string[]): number {
  return calls.filter((call) => call === "checkMigration").length
}

describe("editing a migration plan", () => {
  test("maps an element through the format's writer, focuses its row and has the engine check the new plan", async () => {
    const plans: MigrationPlan[] = []
    const opened = await openPlan(FITS, withCheckTask(plans))

    await opened.panel.handle({
      type: "mapElement",
      sourceElementId: REVIEW,
      targetElementId: CHECK,
    })
    await WaitGate.settle()

    expect(opened.source.written).toHaveLength(1)
    expect(pairsOf(opened.source.written[0])).toEqual([`${CHARGE}>${CHARGE}`, `${REVIEW}>${CHECK}`])
    expect(opened.source.written[0]).toBe(
      planText([
        { sourceElementId: CHARGE, targetElementId: CHARGE },
        { sourceElementId: REVIEW, targetElementId: CHECK },
      ]),
    )
    const view = opened.view()
    expect(view.focused).toBe(REVIEW)
    expect(view.rows.find((row) => row.sourceElementId === REVIEW)).toMatchObject({
      targetElementId: CHECK,
      targetLabel: "Check order",
    })
    expect(plans.at(-1)?.mappings.map((pair) => pair.targetElementId)).toEqual([CHARGE, CHECK])
    expect(view.verdict.checking).toBeUndefined()
  })

  test("shows the changed plan as checking before the engine answers, and only the last of quick edits is checked", async () => {
    const plans: MigrationPlan[] = []
    const fixture = panelFixture(withCheckTask(plans), { writable: true })
    const gate = new WaitGate()
    const source = new FakePlanSource(FITS)
    const panel = MigrationPlanPanel.over({ ...fixture.context, wait: gate.wait }, source)
    await panel.handle({ type: "ready" })
    const loaded = plans.length

    await panel.handle({ type: "mapElement", sourceElementId: REVIEW, targetElementId: CHECK })
    expect(planView(fixture.lastState())).toMatchObject({
      summary: "2 mapped · no problems · checking…",
      verdict: { fits: false, checking: true, text: "The engine checks the changed plan." },
    })
    await panel.handle({ type: "unmapElement", sourceElementId: CHARGE })
    await gate.open()
    await gate.open()

    expect(plans.slice(loaded).map((plan) => plan.mappings.length)).toEqual([1])
    expect(planView(fixture.lastState()).verdict.checking).toBeUndefined()
    expect(gate.delays).toEqual([300, 300])
  })

  test("removes a pair from the file", async () => {
    const opened = await openPlan(FITS)

    await opened.panel.handle({ type: "unmapElement", sourceElementId: CHARGE })
    await WaitGate.settle()

    expect(pairsOf(opened.source.written[0])).toEqual([`${REVIEW}>${REVIEW}`])
    expect(opened.view().rows.find((row) => row.sourceElementId === CHARGE)?.targetElementId).toBe(
      undefined,
    )
  })

  test("writes nothing for a pair of two kinds, an element it shows no row for, a pair it has or an element without a pair", async () => {
    const opened = await openPlan(planText(same(REVIEW)))
    const published = opened.fixture.states.length

    await opened.panel.handle({
      type: "mapElement",
      sourceElementId: REVIEW,
      targetElementId: CHARGE,
    })
    await opened.panel.handle({
      type: "mapElement",
      sourceElementId: "Nowhere",
      targetElementId: REVIEW,
    })
    await opened.panel.handle({
      type: "mapElement",
      sourceElementId: REVIEW,
      targetElementId: REVIEW,
    })
    await opened.panel.handle({ type: "unmapElement", sourceElementId: CHARGE })

    expect(opened.source.written).toEqual([])
    expect(opened.fixture.states).toHaveLength(published)
  })

  test("drops a pair it left out, or maps its element anew, and sends the engine only pairs that fit", async () => {
    const plans: MigrationPlan[] = []
    const opened = await openPlan(
      planText([
        { sourceElementId: REVIEW, targetElementId: CHARGE },
        { sourceElementId: CHARGE, targetElementId: "Gone" },
      ]),
      withCheckTask(plans),
    )
    expect(opened.view().rows.filter((row) => row.refused !== undefined)).toHaveLength(2)

    await opened.panel.handle({ type: "unmapElement", sourceElementId: CHARGE })
    await opened.panel.handle({
      type: "mapElement",
      sourceElementId: REVIEW,
      targetElementId: CHECK,
    })
    await WaitGate.settle()

    expect(pairsOf(opened.source.written[0])).toEqual([`${REVIEW}>${CHARGE}`])
    expect(pairsOf(opened.source.written[1])).toEqual([`${REVIEW}>${CHECK}`])
    expect(opened.view()).toMatchObject({ summary: "1 mapped · 1 without a mapping" })
    expect(opened.view().rows.filter((row) => row.refused !== undefined)).toEqual([])
    expect(plans.at(-1)?.mappings).toEqual([{ sourceElementId: REVIEW, targetElementId: CHECK }])
  })

  test("offers each row the elements of the target version it can map to", async () => {
    const opened = await openPlan(FITS, withCheckTask())

    expect(opened.view().rows.find((row) => row.sourceElementId === REVIEW)?.candidates).toEqual([
      { elementId: REVIEW, label: "Review order" },
      { elementId: CHECK, label: "Check order" },
    ])
  })

  test("keeps the shown plan when the host refuses the edit, says so and counts each refusal", async () => {
    const opened = await openPlan(FITS)
    opened.source.refusesWrites = true

    await opened.panel.handle({ type: "unmapElement", sourceElementId: CHARGE })
    await opened.panel.handle({ type: "unmapElement", sourceElementId: CHARGE })

    expect(opened.view()).toMatchObject({ summary: "2 mapped · no problems", refusedWrites: 2 })
    expect(opened.view().notices[0]).toEqual({
      tone: "warning",
      title: `VS Code didn't change ${opened.source.fileName}.`,
      detail: "Check that the file can be written; the plan shows what the file says.",
      actions: [],
    })
    expect(checksOf(opened.fixture.calls)).toBe(1)

    opened.source.refusesWrites = false
    await opened.panel.handle({ type: "unmapElement", sourceElementId: CHARGE })
    expect(opened.view().refusedWrites).toBeUndefined()
  })

  test("keeps the file's $schema when it writes an edit", async () => {
    const schema = "../../schemas/migration-plan.schema.json"
    const withSchema = JSON.stringify({ $schema: schema, ...JSON.parse(FITS) }, undefined, 2)
    const opened = await openPlan(withSchema)

    await opened.panel.handle({ type: "unmapElement", sourceElementId: CHARGE })

    expect(JSON.parse(opened.source.written[0] ?? "{}")).toMatchObject({ $schema: schema })
    expect(pairsOf(opened.source.written[0])).toEqual([`${REVIEW}>${REVIEW}`])
  })

  test("writes two quick edits one after the other, the second on the first's plan", async () => {
    const opened = await openPlan(FITS, withCheckTask())

    await Promise.all([
      opened.panel.handle({ type: "mapElement", sourceElementId: REVIEW, targetElementId: CHECK }),
      opened.panel.handle({ type: "unmapElement", sourceElementId: CHARGE }),
    ])

    expect(opened.source.written.map((text) => pairsOf(text))).toEqual([
      [`${CHARGE}>${CHARGE}`, `${REVIEW}>${CHECK}`],
      [`${REVIEW}>${CHECK}`],
    ])
  })

  test("applies an edit sent while the plan reads again to the plan it reads, not the one it showed", async () => {
    const gate = deferred<undefined>()
    let held = false
    const opened = await openPlan(
      FITS,
      (runtime) =>
        new PatchedRuntime(runtime, {
          listVersions: async (id, tenantId) => {
            if (held) {
              await gate.promise
            }
            return runtime.listVersions(id, tenantId)
          },
        }),
    )
    held = true
    opened.source.text = planText(same(REVIEW))
    const reading = opened.panel.handle({ type: "refresh" })
    const editing = opened.panel.handle({
      type: "mapElement",
      sourceElementId: CHARGE,
      targetElementId: CHARGE,
    })
    await WaitGate.settle()
    expect(opened.source.written).toEqual([])

    gate.resolve(undefined)
    await Promise.all([reading, editing])

    expect(pairsOf(opened.source.written[0])).toEqual([
      `${CHARGE}>${CHARGE}`,
      `${REVIEW}>${REVIEW}`,
    ])
    expect(opened.view().summary).toBe("2 mapped · no problems")
  })

  test("edits nothing while the file shows a problem", async () => {
    const opened = await openPlan("{")

    await opened.panel.handle({ type: "unmapElement", sourceElementId: CHARGE })

    expect(opened.source.written).toEqual([])
  })
})

describe("a change of the open document", () => {
  test("shows the pairs of an edit made in the text, undone or redone, and checks them without reading the versions again", async () => {
    const opened = await openPlan(FITS)
    const reads = opened.fixture.calls.length

    opened.source.text = planText(same(REVIEW))
    await opened.panel.changed()
    await WaitGate.settle()

    expect(opened.fixture.calls.slice(reads)).toEqual(["checkMigration"])
    expect(opened.view().summary).toBe("1 mapped · 1 without a mapping")
  })

  test("does nothing when the text changes but the plan does not", async () => {
    const opened = await openPlan(FITS)
    const published = opened.fixture.states.length

    opened.source.text = JSON.stringify(JSON.parse(FITS))
    await opened.panel.changed()

    expect(opened.fixture.states).toHaveLength(published)
    expect(checksOf(opened.fixture.calls)).toBe(1)
  })

  test("reads everything again when the text names other versions", async () => {
    const opened = await openPlan(FITS)

    opened.source.text = FITS.replace(
      '"target": {\n    "version": 2',
      '"target": {\n    "version": 3',
    )
    await opened.panel.changed()

    expect(opened.fixture.lastState()).toMatchObject({
      status: "failed",
      problem: { title: "local has no v3 of pulse-order." },
    })
  })

  test("names a text it can't read as the file's problem, and shows the plan again once the text is fixed", async () => {
    const opened = await openPlan(FITS)

    opened.source.text = "{"
    await opened.panel.changed()
    expect(opened.fixture.lastState()).toMatchObject({
      status: "failed",
      problem: { file: opened.source.fileName },
    })

    opened.source.text = FITS
    await opened.panel.changed()
    expect(opened.view().summary).toBe("2 mapped · no problems")
  })

  test("ends a check of a changed plan when reading again fails on the engine", async () => {
    let failing = false
    const opened = await openPlan(
      FITS,
      (runtime) =>
        new PatchedRuntime(runtime, {
          listVersions: (id, tenantId) =>
            failing
              ? Promise.reject(new RuntimeError("engineFailure", "the engine is down"))
              : runtime.listVersions(id, tenantId),
        }),
    )
    opened.source.text = planText(same(REVIEW))
    const changing = opened.panel.changed()
    failing = true
    await opened.panel.handle({ type: "refresh" })
    await changing
    await WaitGate.settle()

    const last = opened.fixture.lastState()
    expect(last.status).toBe("failed")
    expect(last.status === "failed" ? last.staleView : undefined).toMatchObject({
      verdict: { fits: false },
      summary: "1 mapped · 1 without a mapping",
    })
  })

  test("says when the engine can't check the changed plan", async () => {
    let failing = false
    const opened = await openPlan(
      FITS,
      (runtime) =>
        new PatchedRuntime(runtime, {
          checkMigration: (plan) =>
            failing
              ? Promise.reject(new RuntimeError("engineFailure", "the engine is down"))
              : runtime.checkMigration!(plan),
        }),
    )
    failing = true

    opened.source.text = planText(same(REVIEW))
    await opened.panel.changed()
    await WaitGate.settle()

    const { verdict } = opened.view()
    expect(verdict.fits).toBe(false)
    expect(verdict.checking).toBeUndefined()
    expect(verdict.text).toMatch(/^Pulse could not check the plan: /)
  })
})
