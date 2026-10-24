import {
  BulkOperationId,
  DefinitionId,
  InstanceId,
  IsoTimestamp,
  type BulkOperation,
  type InstanceSummary,
} from "../../src/contract/index.js"
import { describe, expect, test } from "vitest"
import { BulkRun, type BulkPlan } from "../../src/core/panels/bulk-run.js"
import { BULK_CAP, BulkSelection } from "../../src/core/panels/bulk-selection.js"
import { CancelInstancesAction } from "../../src/core/panels/cancel-instances-action.js"
import type { DefinitionView } from "../../src/core/protocol/index.js"
import { BulkOutcomes, type BulkScene } from "../../src/core/views/bulk-outcomes.js"
import { BulkRequests } from "../../src/core/views/bulk-requests.js"

const NOW = new Date("2026-10-21T09:00:00Z")
const ID = BulkOperationId("bulk-1")
const IDS = ["a", "b", "c", "d"].map((id) => InstanceId(id))
const PLAN: BulkPlan = {
  action: new CancelInstancesAction(),
  definitionId: DefinitionId("order:3"),
  version: 3,
  ids: IDS,
  skipped: 0,
}
const SCENE: BulkScene = {
  now: NOW.getTime(),
  environment: "test",
  shownVersion: 3,
  canWrite: true,
}

function operation(fields: Partial<BulkOperation>): BulkOperation {
  return {
    id: ID,
    kind: "cancelInstances",
    state: "running",
    startedAt: IsoTimestamp(NOW.toISOString()),
    ...fields,
  }
}

function running(): BulkRun {
  const run = new BulkRun(PLAN, NOW)
  run.submitted(ID, NOW)
  return run
}

function viewOf(run: BulkRun, scene: Partial<BulkScene> = {}) {
  return new BulkOutcomes(run, { ...SCENE, ...scene }).view()
}

describe("a selection", () => {
  test("adds and removes ids and refuses to grow beyond the cap", () => {
    const selection = new BulkSelection()
    selection.toggle(
      Array.from({ length: BULK_CAP }, (_, index) => InstanceId(`id-${index}`)),
      true,
    )
    selection.toggle([InstanceId("one-more")], true)
    expect(selection.selected()).toHaveLength(BULK_CAP)
    expect(selection.view({ eligible: "running", matching: 0, offers: [] })?.overCap).toBe(
      BULK_CAP + 1,
    )

    selection.toggle([InstanceId("id-0")], false)
    expect(selection.selected()).toHaveLength(BULK_CAP - 1)
    expect(selection.has(InstanceId("id-0"))).toBe(false)
  })

  test("says nothing while nothing is selected and nothing was refused", () => {
    expect(
      new BulkSelection().view({ eligible: "running", matching: 3, offers: [] }),
    ).toBeUndefined()
  })

  test("reports a refused selection even when nothing is selected yet", () => {
    const selection = new BulkSelection()
    selection.refuse(1200)

    expect(selection.view({ eligible: "running", matching: 1200, offers: [] })).toEqual({
      count: 0,
      eligible: "running",
      allMatching: false,
      cap: BULK_CAP,
      offers: [],
      overCap: 1200,
    })
  })
})

describe("a bulk run", () => {
  test("counts items, not more than were sent, and notes when they moved", () => {
    const run = running()
    const later = new Date(NOW.getTime() + 60_000)

    expect(run.observed(operation({ completed: 9, failed: 0, total: 4 }), later)).toBe(true)
    expect(run.progress).toEqual({ total: 4, done: 4, failed: 0 })
    expect(run.lastChangeAt).toBe(later.getTime())
  })

  test("keeps the last counts when the engine no longer reports them", () => {
    const run = running()
    run.observed(operation({ completed: 2, total: 4 }), NOW)

    expect(run.observed(operation({ state: "ended" }), NOW)).toBe(true)
    expect(run.progress.done).toBe(2)
  })

  test("is worked off when every item is done or failed, though the engine still runs it", () => {
    const run = running()

    expect(run.observed(operation({ completed: 3, failed: 1, total: 4 }), NOW)).toBe(true)
    expect(run.observed(operation({ completed: 1, failed: 0, total: 0 }), NOW)).toBe(false)
  })

  test("is worked off when a stopped operation left the running state", () => {
    const run = running()
    run.stopping()

    expect(run.observed(operation({ state: "suspended" }), NOW)).toBe(true)
  })

  test("reconciles a stopped run twice before it calls it stopped", () => {
    const run = running()
    run.stopping()
    run.reconciled(3)
    expect(run.phase).toBe("settling")
    run.reconciled(2)
    expect([run.phase, run.remaining]).toEqual(["stopped", 2])
  })

  test("goes back to running with the reason when Stop failed", () => {
    const run = running()
    run.stopping()
    run.stopFailed("locked")

    expect([run.phase, run.message, run.stopTarget()]).toEqual(["running", "locked", ID])
  })

  test("keeps an unknown or failed outcome when the instances are checked", () => {
    const run = new BulkRun(PLAN, NOW)
    run.failed("no answer", true)
    run.reconciled(4)

    expect([run.phase, run.remaining, run.stopTarget()]).toEqual(["unknown", 4, undefined])
  })

  test("lets only one follower poll it at a time and wakes the ones that wait", () => {
    const run = running()
    const first = {}
    const woken: string[] = []

    expect(run.claim(first, () => woken.push("first"))).toBe(true)
    expect(run.claim({}, () => woken.push("second"))).toBe(false)
    run.release({})
    expect(woken).toEqual([])
    run.release(first)
    expect(woken).toEqual(["second"])
    expect(run.claim({}, () => woken.push("third"))).toBe(true)
  })

  test("lets nobody follow it before the engine took it, then wakes them", () => {
    const run = new BulkRun(PLAN, NOW)
    const woken: string[] = []

    expect(run.claim({}, () => woken.push("waiting"))).toBe(false)
    run.submitted(ID, NOW)
    expect(woken).toEqual(["waiting"])
  })
})

describe("the strip of a bulk run", () => {
  test("offers Stop only while it may write", () => {
    expect(viewOf(running()).notice.actions).toEqual([{ kind: "stopBulk", label: "Stop" }])
    expect(viewOf(running(), { canWrite: false }).notice.actions).toEqual([])
  })

  test("says when it waits for its first answer", () => {
    expect(viewOf(new BulkRun(PLAN, NOW)).notice.title).toBe("Cancelling 4 instances…")
  })

  test("shows why Stop failed", () => {
    const run = running()
    run.stopping()
    expect(viewOf(run)).toMatchObject({ status: "stopping", notice: { actions: [] } })
    run.stopFailed("Locked.")
    expect(viewOf(run).notice.detail).toBe("Locked.")
  })

  test("calls a run stalled after five minutes without progress on a test engine", () => {
    const run = running()
    expect(viewOf(run, { now: NOW.getTime() + 4 * 60_000 }).status).toBe("running")
    expect(viewOf(run, { now: NOW.getTime() + 5 * 60_000 }).status).toBe("stalled")
  })

  test("reports instances it could not end, offering them only on their own version", () => {
    const run = running()
    run.reconciled(1)

    expect(viewOf(run).notice).toEqual({
      tone: "danger",
      title: "Cancelled 3 of 4. 1 still running.",
      detail: "The engine could not end them.",
      actions: [
        { kind: "selectRemaining", label: "Select the one still running" },
        { kind: "dismissBulk", label: "Dismiss" },
      ],
    })
    expect(viewOf(run, { shownVersion: 4 }).notice.actions).toEqual([
      { kind: "dismissBulk", label: "Dismiss" },
    ])
  })

  test("names the instances that had already ended", () => {
    const run = new BulkRun({ ...PLAN, skipped: 2 }, NOW)
    run.submitted(ID, NOW)
    run.reconciled(0)

    expect(viewOf(run, { shownVersion: 2 }).notice).toMatchObject({
      tone: "info",
      title: "Cancelled 4 instances of v3.",
      detail: "2 instances already ended and were left alone.",
    })
  })

  test("says a refused start failed, with or without a reason", () => {
    const run = new BulkRun(PLAN, NOW)
    run.failed("Not allowed.", false)
    expect(viewOf(run).notice).toMatchObject({
      title: "Could not start cancelling.",
      detail: "Not allowed.",
    })
  })

  test("asks to check the instances when the start may or may not have happened", () => {
    const run = new BulkRun(PLAN, NOW)
    run.failed("Timed out.", true)

    expect(viewOf(run).notice.detail).toBe("Timed out. Check the instances before you try again.")
  })
})

describe("the confirmation of a bulk cancel", () => {
  const VIEW = {
    processName: "Order",
    diagramXml: '<bpmn:userTask id="Activity_Review" name="Review order" />',
    filter: { scope: "withIncident", elementId: "Activity_Review", businessKey: "ORD-1" },
  } as DefinitionView

  function summary(id: string, extra: Partial<InstanceSummary> = {}): InstanceSummary {
    return {
      id: InstanceId(id),
      definition: { id: DefinitionId("order:3"), bpmnProcessId: "order", version: 3 },
      state: "running",
      hasIncident: false,
      ...extra,
    } as InstanceSummary
  }

  test("names the filter, the first rows in one line and how many more there are", () => {
    const rows = ["1", "2", "3", "4", "5", "6"].map((id) => summary(`row-${id}`))
    const request = BulkRequests.of(VIEW, {
      plan: { ...PLAN, ids: rows.map((row) => row.id) },
      selected: 6,
      firstRows: [
        summary("row-0", { businessKey: "ORD-1", startedAt: IsoTimestamp("2026-10-21T08:00:00Z") }),
        ...rows,
      ],
    })

    expect(request.facts.slice(0, 3)).toEqual([
      "Filter: With incident · at Review order · business key ORD-1",
      "ORD-1, row-1, row-2 and 3 more",
      "Called instances end with them.",
    ])
  })
})
