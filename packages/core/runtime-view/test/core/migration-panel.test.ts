import { PatchedCommands, PatchedRuntime } from "../../src/contract/fake/index.js"
import {
  BpmnProcessId,
  ElementId,
  InstanceId,
  RuntimeError,
  type ProcessCommands,
  type ProcessRuntime,
} from "../../src/contract/index.js"
import { describe, expect, test } from "vitest"
import { DefinitionPanel } from "../../src/core/panels/definition-panel.js"
import { MigrationPanel } from "../../src/core/panels/migration-panel.js"
import { MigrationReads } from "../../src/core/panels/migration-reads.js"
import type { PanelContext } from "../../src/core/panels/panel-context.js"
import {
  MessageGuards,
  type DefinitionView,
  type MigrationView,
  type PanelState,
} from "../../src/core/protocol/index.js"
import { panelFixture, type FixtureOptions, type PanelFixture } from "./support/panel-fixture.js"
import { WaitGate } from "./support/wait-gate.js"

const ORDER = BpmnProcessId("pulse-order")
const REVIEW = "Activity_ReviewOrder"
const CHARGE = "Activity_ChargePayment"

function migrationView(state: PanelState): MigrationView {
  if (state.status !== "ready" || state.view.kind !== "migration") {
    throw new Error(`expected a ready migration view, got ${state.status}`)
  }
  return state.view
}

interface Opened {
  readonly fixture: PanelFixture
  readonly panel: MigrationPanel
  readonly gate: WaitGate
  readonly ids: readonly InstanceId[]
  view(): MigrationView
}

async function openMigration(
  options: FixtureOptions = { writable: true },
  adapt: (runtime: ProcessRuntime) => ProcessRuntime = (runtime) => runtime,
  from: "order@1" | "order@2" = "order@1",
): Promise<Opened> {
  const fixture = panelFixture(adapt, options)
  const gate = new WaitGate()
  const context: PanelContext = { ...fixture.context, wait: gate.wait }
  const ids = [fixture.world.instanceIds["ORD-1001"], fixture.world.instanceIds["ORD-1002"]]
  const panel = new MigrationPanel(context, {
    bpmnProcessId: ORDER,
    sourceDefinitionId: fixture.world.definitionIds[from],
    instanceIds: from === "order@1" ? ids : [fixture.world.instanceIds["ORD-2001"]],
  })
  await panel.handle({ type: "ready" })
  return { fixture, panel, gate, ids, view: () => migrationView(fixture.lastState()) }
}

function withCommands(adapt: (commands: ProcessCommands) => Partial<ProcessCommands>) {
  return {
    writable: true,
    adaptCommands: (commands: ProcessCommands) => new PatchedCommands(commands, adapt(commands)),
  } satisfies FixtureOptions
}

async function workOff(opened: Opened): Promise<void> {
  for (let round = 0; round < 4 && opened.gate.pending > 0; round += 1) {
    await opened.gate.open()
  }
}

describe("opening a migration", () => {
  test("lets the engine propose the plan to the latest version and checks it", async () => {
    const opened = await openMigration()

    expect(opened.view()).toMatchObject({
      processName: "Order fulfillment",
      source: { version: 1 },
      target: { version: 2 },
      targets: [{ version: 2 }],
      count: 2,
      summary: "All 2 elements map by id · no problems · checked just now",
      offer: { status: "ready", label: "Migrate 2 instances…" },
    })
    expect(
      opened.view().rows.map((row) => [row.sourceElementId, row.targetElementId, row.waiting]),
    ).toEqual([
      [REVIEW, REVIEW, 1],
      [CHARGE, CHARGE, 1],
    ])
    expect(opened.fixture.calls.filter((call) => call === "proposeMigration")).toHaveLength(1)
    expect(opened.fixture.calls.filter((call) => call === "checkMigration")).toHaveLength(1)
  })

  test("offers only elements of the same kind as targets", async () => {
    const opened = await openMigration()

    const review = opened.view().rows.find((row) => row.sourceElementId === REVIEW)
    expect(review?.candidates).toEqual([{ elementId: REVIEW, label: "Review order" }])
  })

  test("preselects no target when the source is the latest version", async () => {
    const opened = await openMigration({ writable: true }, (runtime) => runtime, "order@2")

    expect(opened.view().target).toBeUndefined()
    expect(opened.view().rows.some((row) => row.unmappedTokens === true)).toBe(false)
    expect(opened.view().offer).toEqual({
      status: "pickTarget",
      reason: "Pick the version to migrate to.",
    })

    await opened.panel.handle({
      type: "pickMigrationTarget",
      definitionId: opened.fixture.world.definitionIds["order@1"],
    })

    expect(opened.view().target).toMatchObject({ version: 1 })
    expect(opened.view().notices).toEqual([
      { tone: "info", title: "v1 is older than v2.", actions: [] },
    ])
  })

  test("ignores a target that is not another version of the process", async () => {
    const opened = await openMigration()
    const calls = opened.fixture.calls.length

    await opened.panel.handle({ type: "pickMigrationTarget", definitionId: "pulse-label:1" })
    await opened.panel.handle({
      type: "pickMigrationTarget",
      definitionId: opened.fixture.world.definitionIds["order@1"],
    })

    expect(opened.fixture.calls).toHaveLength(calls)
    expect(opened.view().target).toMatchObject({ version: 2 })
  })
})

describe("changing the mapping", () => {
  test("flags an element without a mapping where selected instances wait and offers to leave them out", async () => {
    const opened = await openMigration()

    await opened.panel.handle({ type: "unmapElement", sourceElementId: REVIEW })
    expect(opened.view().offer).toEqual({ status: "checking", label: "Migrate 2 instances…" })
    await opened.gate.open()

    const review = opened.view().rows[0]
    expect(review).toMatchObject({ sourceElementId: REVIEW, waiting: 1, unmappedTokens: true })
    expect(review).not.toHaveProperty("targetElementId")
    expect(opened.view().offer).toEqual({
      status: "refused",
      reason: "1 of 2 waits at Review order, which has no mapping in v2.",
      leaveOut: "Leave the one out",
    })

    await opened.panel.handle({ type: "leaveOutUnmapped" })

    expect(opened.view().count).toBe(1)
    expect(opened.view().offer).toEqual({ status: "ready", label: "Migrate 1 instance…" })
  })

  test("maps an element again and ignores a target of another kind", async () => {
    const opened = await openMigration()
    await opened.panel.handle({ type: "unmapElement", sourceElementId: REVIEW })
    await opened.gate.open()

    await opened.panel.handle({
      type: "mapElement",
      sourceElementId: REVIEW,
      targetElementId: CHARGE,
    })
    expect(opened.view().rows[0]).not.toHaveProperty("targetElementId")

    await opened.panel.handle({
      type: "mapElement",
      sourceElementId: REVIEW,
      targetElementId: REVIEW,
    })
    await opened.gate.open()
    expect(opened.view().rows.find((row) => row.sourceElementId === REVIEW)).toMatchObject({
      targetElementId: REVIEW,
    })
    expect(opened.view().focused).toBe(REVIEW)
    expect(opened.view().offer.status).toBe("ready")
  })

  test("checks only the last of several quick edits", async () => {
    const opened = await openMigration()
    const before = opened.fixture.calls.filter((call) => call === "checkMigration").length

    await opened.panel.handle({ type: "unmapElement", sourceElementId: REVIEW })
    await opened.panel.handle({ type: "unmapElement", sourceElementId: CHARGE })
    await opened.gate.open()
    await opened.gate.open()

    const checks = opened.fixture.calls.filter((call) => call === "checkMigration").length
    expect(checks - before).toBe(1)
    expect(opened.view().summary).toBe("0 mapped · 2 without a mapping · checked just now")
  })

  test("names a problem the engine finds and refuses to migrate until it is fixed", async () => {
    const opened = await openMigration(
      { writable: true },
      (runtime) =>
        new PatchedRuntime(runtime, {
          checkMigration: async (plan) =>
            plan.mappings.length === 2
              ? runtime.checkMigration(plan)
              : {
                  problems: [
                    { mapping: plan.mappings[0]!, message: "Activities have incompatible types" },
                  ],
                },
        }),
    )

    await opened.panel.handle({ type: "unmapElement", sourceElementId: REVIEW })
    await opened.gate.open()

    expect(opened.view().rows[0]).toMatchObject({
      sourceElementId: CHARGE,
      problem: "Activities have incompatible types",
    })
    expect(opened.view().offer).toEqual({
      status: "refused",
      reason: "Fix 1 problem to migrate: Activities have incompatible types",
    })
  })

  test("says when the check itself failed", async () => {
    const opened = await openMigration(
      { writable: true },
      (runtime) =>
        new PatchedRuntime(runtime, {
          checkMigration: async (plan) =>
            plan.mappings.length === 2
              ? runtime.checkMigration(plan)
              : Promise.reject(new RuntimeError("unreachable", "gone")),
        }),
    )

    await opened.panel.handle({ type: "unmapElement", sourceElementId: CHARGE })
    await opened.gate.open()

    expect(opened.view().offer).toMatchObject({ status: "refused" })
    expect(opened.view().offer).toHaveProperty(
      "reason",
      expect.stringContaining("Pulse could not check the plan") as unknown,
    )
  })
})

describe("migrating", () => {
  test("confirms the count, the versions and what stays, then migrates as one batch", async () => {
    const opened = await openMigration()

    await opened.panel.handle({ type: "startMigration" })

    const request = opened.fixture.effects.confirmBulk.mock.calls[0]![0]
    expect(request).toMatchObject({
      action: "migrateInstances",
      title: "Migrate 2 instances of Order fulfillment v1 to v2?",
      count: 2,
      countPrompt: "Type 2 to migrate 2 instances",
      takesReason: false,
      auditFields: { mappings: 2, leftOut: 0, incidents: 1, mode: "batch" },
    })
    expect(request.facts).toEqual([
      "ORD-1001, ORD-1002",
      "Each migrates on its own; failed ones stay on v1.",
      "1 has an incident and keeps it; retry it on v2.",
      "Migrating can't be undone.",
      "Checked just now",
    ])
    expect(request.auditFields).toEqual({
      source: opened.fixture.world.definitionIds["order@1"],
      target: opened.fixture.world.definitionIds["order@2"],
      mappings: 2,
      leftOut: 0,
      incidents: 1,
      mode: "batch",
    })
    expect(opened.view().bulk?.notice.title).toMatch(/^Migrating instances: \d of 2 done$/)

    await workOff(opened)

    expect(opened.view().bulk?.notice.title).toBe("Migrated 2 instances to v2.")
    expect(opened.view().count).toBe(0)
    expect(opened.fixture.effects.reportBulkOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ action: "migrateInstances", arrived: 2, remaining: 0, failed: 0 }),
    )
  })

  test("refuses before the dialog when an instance reached an element without a mapping meanwhile", async () => {
    let unmappedNow = false
    const opened = await openMigration(
      { writable: true },
      (runtime) =>
        new PatchedRuntime(runtime, {
          proposeMigration: async (source, target) => {
            const plan = await runtime.proposeMigration(source, target)
            return { ...plan, mappings: plan.mappings.filter((m) => m.sourceElementId !== REVIEW) }
          },
          getElementStatistics: async (definitionId) =>
            (await runtime.getElementStatistics(definitionId)).filter(
              (element) => unmappedNow || element.elementId !== REVIEW,
            ),
        }),
    )
    expect(opened.view().offer.status).toBe("ready")
    unmappedNow = true

    await opened.panel.handle({ type: "startMigration" })

    expect(opened.fixture.effects.confirmBulk).not.toHaveBeenCalled()
    expect(opened.fixture.effects.reportProblem).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Instances wait where the plan has no mapping." }),
    )
    expect(opened.view().offer).toMatchObject({ status: "refused", leaveOut: "Leave the one out" })
  })

  test("submits the plan that was checked, not an edit made while the dialog was open", async () => {
    const submitted: number[] = []
    let resolveDialog: (answer: object) => void = () => undefined
    const opened = await openMigration(
      withCommands((commands) => ({
        migrateInstances: (plan, ids) => {
          submitted.push(plan.mappings.length)
          return commands.migrateInstances(plan, ids)
        },
      })),
    )
    opened.fixture.effects.confirmBulk.mockImplementation(
      () => new Promise((resolve) => (resolveDialog = resolve)),
    )

    const migrating = opened.panel.handle({ type: "startMigration" })
    await WaitGate.settle()
    await opened.panel.handle({ type: "unmapElement", sourceElementId: CHARGE })
    resolveDialog({})
    await migrating

    expect(submitted).toEqual([2])
  })

  test("names the instances that stayed behind with the engine reasons, and removes the batch on request", async () => {
    const opened = await openMigration(
      withCommands((commands) => ({
        migrateInstances: (plan, ids) =>
          commands.migrateInstances(
            { ...plan, mappings: plan.mappings.filter((m) => m.sourceElementId !== REVIEW) },
            ids,
          ),
      })),
    )

    await opened.panel.handle({ type: "startMigration" })
    await workOff(opened)

    const notice = opened.view().bulk?.notice
    expect(notice).toMatchObject({
      tone: "danger",
      title: "Migrated 1 of 2 to v2. 1 still on v1.",
      detail: "The engine could not migrate them. The engine keeps the batch with 1 failed item.",
    })
    expect(notice?.actions.map((action) => action.label)).toEqual(["Show why", "Remove batch"])
    expect(opened.view().count).toBe(1)

    await opened.panel.handle({ type: "showBulkFailures" })
    const [title, details] = opened.fixture.effects.showIncidentDetails.mock.calls[0]!
    expect(title).toBe("Why 1 instance could not be migrated")
    expect(details.text).toContain(
      `ORD-1001 ${opened.ids[0]}: No mapping for the token at ${REVIEW}.`,
    )

    await opened.panel.handle({ type: "stopBulk" })
    await workOff(opened)

    expect(opened.view().bulk?.notice.actions.map((action) => action.label)).toEqual([
      "Show why",
      "Dismiss",
    ])
  })

  test("leaves the outcome open and does not submit again when the engine did not answer", async () => {
    const opened = await openMigration(
      withCommands(() => ({
        migrateInstances: () => Promise.reject(new RuntimeError("unreachable", "timeout")),
      })),
    )

    await opened.panel.handle({ type: "startMigration" })

    expect(opened.view().bulk?.notice).toMatchObject({
      tone: "warning",
      title: "Unknown whether migrating started.",
    })
  })

  test("migrates nothing on a read-only engine", async () => {
    const opened = await openMigration({})

    await opened.panel.handle({ type: "startMigration" })

    expect(opened.fixture.effects.confirmBulk).not.toHaveBeenCalled()
  })
})

describe("the definition panel", () => {
  function definitionView(state: PanelState): DefinitionView {
    if (state.status !== "ready" || state.view.kind !== "definition") {
      throw new Error("expected a definition view")
    }
    return state.view
  }

  test("hands its selection to a migration and offers it only when another version exists", async () => {
    const fixture = panelFixture((runtime) => runtime, { writable: true })
    const panel = new DefinitionPanel(fixture.context, {
      bpmnProcessId: ORDER,
      definitionId: fixture.world.definitionIds["order@1"],
    })
    await panel.handle({ type: "ready" })
    const ids = definitionView(fixture.lastState()).instances.map((row) => row.id)
    await panel.handle({ type: "toggleInstances", ids, selected: true })

    expect(definitionView(fixture.lastState()).selection?.migration).toBe("Migrate to version…")

    await panel.handle({ type: "openMigration" })

    expect(fixture.effects.openMigration).toHaveBeenCalledWith({
      bpmnProcessId: ORDER,
      sourceDefinitionId: fixture.world.definitionIds["order@1"],
      instanceIds: ids,
    })
    expect(definitionView(fixture.lastState()).selection).toBeUndefined()
  })
})

describe("the migration intents", () => {
  test.each([
    [{ type: "mapElement", sourceElementId: REVIEW, targetElementId: REVIEW }, true],
    [{ type: "mapElement", sourceElementId: REVIEW, targetElementId: "" }, false],
    [{ type: "unmapElement", sourceElementId: "x".repeat(256) }, false],
    [{ type: "pickMigrationTarget", definitionId: "pulse-order:2" }, true],
    [{ type: "focusMapping" }, false],
    [{ type: "startMigration" }, true],
    [{ type: "startBulk", action: "migrateInstances" }, false],
  ])("%j is accepted: %s", (intent, accepted) => {
    expect(MessageGuards.isWebviewIntent(intent)).toBe(accepted)
  })
})

describe("the migration tab over its life", () => {
  test("keeps an edited mapping on refresh and asks the engine for a proposal only once", async () => {
    const opened = await openMigration()
    await opened.panel.handle({ type: "unmapElement", sourceElementId: REVIEW })
    await opened.gate.open()

    await opened.panel.handle({ type: "refresh" })

    expect(opened.view().rows[0]).toMatchObject({ sourceElementId: REVIEW, unmappedTokens: true })
    expect(opened.fixture.calls.filter((call) => call === "proposeMigration")).toHaveLength(1)
  })

  test("takes a new selection of the same version and keeps its target", async () => {
    const opened = await openMigration()

    await opened.panel.retarget({
      bpmnProcessId: ORDER,
      sourceDefinitionId: opened.fixture.world.definitionIds["order@1"],
      instanceIds: [opened.ids[0]!],
    })

    expect(opened.view()).toMatchObject({ count: 1, target: { version: 2 } })
  })

  test("passes the shell actions on and ignores what it does not handle", async () => {
    const opened = await openMigration()

    await opened.panel.handle({ type: "goBack" })
    await opened.panel.handle({ type: "copy", text: "x", label: "id" })
    await opened.panel.handle({ type: "editConnection" })
    await opened.panel.handle({ type: "setCredentials" })
    await opened.panel.handle({ type: "loadMoreInstances" })
    await opened.panel.handle({ type: "focusMapping", sourceElementId: "Nowhere" })
    await opened.panel.handle({
      type: "mapElement",
      sourceElementId: "Nowhere",
      targetElementId: REVIEW,
    })
    await opened.panel.handle({ type: "unmapElement", sourceElementId: "Nowhere" })
    await opened.panel.handle({ type: "leaveOutUnmapped" })
    opened.panel.nudge()

    expect(opened.fixture.effects.goBack).toHaveBeenCalledOnce()
    expect(opened.fixture.effects.copyToClipboard).toHaveBeenCalledWith("x", "id")
    expect(opened.fixture.effects.editConnection).toHaveBeenCalledOnce()
    expect(opened.fixture.effects.setCredentials).toHaveBeenCalledOnce()
    expect(opened.view()).toMatchObject({ count: 2, offer: { status: "ready" } })
    expect(opened.view()).not.toHaveProperty("focused")
  })

  test("says when the version to migrate from is gone", async () => {
    const fixture = panelFixture((runtime) => runtime, { writable: true })
    const panel = new MigrationPanel(fixture.context, {
      bpmnProcessId: ORDER,
      sourceDefinitionId: fixture.world.unknown.definitionId,
      instanceIds: [],
    })

    await panel.handle({ type: "ready" })

    expect(fixture.lastState()).toMatchObject({ status: "failed" })
  })

  test("follows the run again once the tab is watched, and stops publishing when closed", async () => {
    const opened = await openMigration()
    await opened.panel.handle({ type: "startMigration" })
    opened.panel.attend("hidden")
    await workOff(opened)
    opened.panel.attend("watched")
    await workOff(opened)

    expect(opened.view().bulk?.notice.title).toBe("Migrated 2 instances to v2.")

    await opened.panel.handle({ type: "dismissBulk" })
    expect(opened.view()).not.toHaveProperty("bulk")

    const published = opened.fixture.states.length
    opened.panel.dispose()
    await opened.panel.handle({ type: "refresh" })
    expect(opened.fixture.states).toHaveLength(published)
  })

  test("stops a running migration", async () => {
    const opened = await openMigration()
    await opened.panel.handle({ type: "startMigration" })

    await opened.panel.handle({ type: "stopBulk" })
    await workOff(opened)

    expect(opened.view().bulk?.status).toBe("stopped")
  })

  test("checks the instances after an unknown outcome", async () => {
    const opened = await openMigration(
      withCommands(() => ({
        migrateInstances: () => Promise.reject(new RuntimeError("unreachable", "timeout")),
      })),
    )
    await opened.panel.handle({ type: "startMigration" })

    await opened.panel.handle({ type: "checkBulk" })

    expect(opened.view().bulk?.notice.detail).toBe("2 of 2 still on v1.")
  })

  test("keeps the batch and says why when removing it fails", async () => {
    const opened = await openMigration(
      withCommands((commands) => ({
        migrateInstances: (plan, ids) =>
          commands.migrateInstances(
            { ...plan, mappings: plan.mappings.filter((m) => m.sourceElementId !== REVIEW) },
            ids,
          ),
        stopBulkOperation: () => Promise.reject(new RuntimeError("rejected", "busy")),
      })),
    )
    await opened.panel.handle({ type: "startMigration" })
    await workOff(opened)

    await opened.panel.handle({ type: "stopBulk" })

    expect(opened.view().bulk).toMatchObject({ status: "finished" })
    expect(opened.view().bulk?.notice.detail).toContain("busy")
    expect(opened.view().bulk?.notice.actions.map((action) => action.label)).toContain(
      "Remove batch",
    )
  })

  test("lists reasons that name no submitted instance and instances that ended meanwhile", async () => {
    const opened = await openMigration(
      withCommands((commands) => ({
        migrateInstances: (plan, ids) =>
          commands.migrateInstances(
            { ...plan, mappings: plan.mappings.filter((m) => m.sourceElementId !== REVIEW) },
            ids,
          ),
      })),
      (runtime) =>
        new PatchedRuntime(runtime, {
          getBulkFailures: async (id) => [
            ...(await runtime.getBulkFailures(id)),
            { reason: "Batch job failed." },
            { instanceId: InstanceId("elsewhere"), reason: "Not ours." },
          ],
        }),
    )
    await opened.panel.handle({ type: "startMigration" })
    await workOff(opened)
    const charge = opened.ids[1]!
    opened.fixture.effects.showIncidentDetails.mockClear()

    await opened.panel.handle({ type: "showBulkFailures" })

    const text = opened.fixture.effects.showIncidentDetails.mock.calls[0]![1].text
    expect(text).toContain("- Batch job failed.")
    expect(text).toContain("- Not ours.")
    expect(text).not.toContain(charge)
  })
})

describe("findings of the review", () => {
  test("counts only the elements without a mapping once more than ten elements hold tokens", async () => {
    const fixture = panelFixture((runtime) => runtime, { writable: true })
    const reads = new MigrationReads(fixture.context, ORDER)
    const tokens = Array.from({ length: 11 }, (_, index) => `Element_${index}`)
    const mappings = tokens.slice(1).map((elementId) => ({
      sourceElementId: ElementId(elementId),
      targetElementId: ElementId(elementId),
    }))
    const instanceIds = [fixture.world.instanceIds["ORD-1001"]]
    const source = fixture.world.definitionIds["order@1"]

    const unmappedOnly = await reads.waitingAt(source, tokens, { mappings, instanceIds })
    const tooMany = await reads.waitingAt(source, [...tokens, "Element_11"], {
      mappings: [],
      instanceIds,
    })

    expect([...unmappedOnly.keys()]).toEqual(["Element_0"])
    expect(tooMany.size).toBe(0)
  })

  test("refuses when the plan changed while Pulse checked it", async () => {
    let editDuringCheck: (() => void) | undefined
    const opened = await openMigration(
      { writable: true },
      (runtime) =>
        new PatchedRuntime(runtime, {
          getElementStatistics: async (definitionId) => {
            editDuringCheck?.()
            return runtime.getElementStatistics(definitionId)
          },
        }),
    )
    editDuringCheck = () => {
      editDuringCheck = undefined
      void opened.panel.handle({ type: "unmapElement", sourceElementId: CHARGE })
    }

    await opened.panel.handle({ type: "startMigration" })

    expect(opened.fixture.effects.confirmBulk).not.toHaveBeenCalled()
    expect(opened.fixture.effects.reportProblem).toHaveBeenCalledWith(
      expect.objectContaining({ title: "The plan changed while Pulse checked it." }),
    )
  })

  test("refuses at the submit when the engine finds a problem in the frozen plan", async () => {
    let checks = 0
    const opened = await openMigration(
      { writable: true },
      (runtime) =>
        new PatchedRuntime(runtime, {
          checkMigration: async (plan) => {
            checks += 1
            return checks === 1
              ? runtime.checkMigration(plan)
              : { problems: [{ mapping: plan.mappings[0]!, message: "v2 changed meanwhile" }] }
          },
        }),
    )

    await opened.panel.handle({ type: "startMigration" })

    expect(opened.fixture.effects.confirmBulk).not.toHaveBeenCalled()
    expect(opened.fixture.effects.reportProblem).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "The plan has problems now.",
        detail: "v2 changed meanwhile",
      }),
    )
    expect(opened.view().offer).toEqual({
      status: "refused",
      reason: "Fix 1 problem to migrate: v2 changed meanwhile",
    })
  })

  test("takes a selection of another version as its new source", async () => {
    const opened = await openMigration()

    await opened.panel.retarget({
      bpmnProcessId: ORDER,
      sourceDefinitionId: opened.fixture.world.definitionIds["order@2"],
      instanceIds: [opened.fixture.world.instanceIds["ORD-2001"]],
    })

    expect(opened.view()).toMatchObject({ source: { version: 2 }, count: 1 })
    expect(opened.view()).not.toHaveProperty("target")
  })

  test("reloads once it is watched again after another panel followed the run to its end", async () => {
    const opened = await openMigration()
    const definition = new DefinitionPanel(
      { ...opened.fixture.context, wait: opened.gate.wait, publish: () => undefined },
      { bpmnProcessId: ORDER, definitionId: opened.fixture.world.definitionIds["order@1"] },
    )
    await definition.handle({ type: "ready" })
    await opened.panel.handle({ type: "startMigration" })
    opened.panel.attend("hidden")
    await workOff(opened)
    expect(opened.view().count).toBe(2)

    opened.panel.attend("watched")
    await WaitGate.settle()

    expect(opened.view().count).toBe(0)
  })

  test("sends one Stop for two quick clicks", async () => {
    let stops = 0
    const opened = await openMigration(
      withCommands((commands) => ({
        stopBulkOperation: (id) => {
          stops += 1
          return commands.stopBulkOperation(id)
        },
      })),
    )
    await opened.panel.handle({ type: "startMigration" })

    await Promise.all([
      opened.panel.handle({ type: "stopBulk" }),
      opened.panel.handle({ type: "stopBulk" }),
    ])

    expect(stops).toBe(1)
  })

  test("reaches the outcome even when the reasons cannot be read", async () => {
    const opened = await openMigration(
      withCommands((commands) => ({
        migrateInstances: (plan, ids) =>
          commands.migrateInstances(
            { ...plan, mappings: plan.mappings.filter((m) => m.sourceElementId !== REVIEW) },
            ids,
          ),
      })),
      (runtime) =>
        new PatchedRuntime(runtime, {
          getBulkFailures: () => Promise.reject(new RuntimeError("forbidden", "no job access")),
        }),
    )

    await opened.panel.handle({ type: "startMigration" })
    await workOff(opened)

    expect(opened.view().bulk?.notice.title).toBe("Migrated 1 of 2 to v2. 1 still on v1.")
  })

  test("blocks a new migration while the engine keeps the batch of the last one, until it is removed", async () => {
    const opened = await openMigration(
      withCommands((commands) => ({
        migrateInstances: (plan, ids) =>
          commands.migrateInstances(
            { ...plan, mappings: plan.mappings.filter((m) => m.sourceElementId !== REVIEW) },
            ids,
          ),
      })),
    )
    await opened.panel.handle({ type: "startMigration" })
    await workOff(opened)

    expect(opened.view().offer).toEqual({
      status: "refused",
      reason: "The engine keeps the batch of the last run with 1 failed item. Remove it first.",
    })

    await opened.panel.handle({ type: "stopBulk" })
    await workOff(opened)

    expect(opened.view().bulk).toMatchObject({
      status: "finished",
      notice: { title: "Migrated 1 of 2 to v2. 1 still on v1." },
    })
    expect(opened.view().bulk?.notice.detail).toBe("The engine could not migrate them.")
    expect(opened.view().offer).toEqual({ status: "ready", label: "Migrate 1 instance…" })
  })

  test("names what was left out and what ended meanwhile in the outcome and in the reasons", async () => {
    const opened = await openMigration()
    await opened.panel.handle({ type: "unmapElement", sourceElementId: REVIEW })
    await opened.gate.open()
    await opened.panel.handle({ type: "leaveOutUnmapped" })
    await opened.panel.handle({
      type: "mapElement",
      sourceElementId: REVIEW,
      targetElementId: REVIEW,
    })
    await opened.gate.open()
    const charge = opened.ids[1]!

    await opened.panel.handle({ type: "startMigration" })
    await opened.fixture.context.runtime.getBulkOperation(
      await opened.fixture.context.commands!.cancelInstances([charge]),
    )
    await workOff(opened)

    expect(opened.view().bulk?.notice).toMatchObject({
      title: "Migrated 0 instances to v2.",
      detail:
        "1 left out, still on v1. 1 ended meanwhile. The engine keeps the batch with 1 failed item.",
    })
    await opened.panel.handle({ type: "showBulkFailures" })
    expect(opened.fixture.effects.showIncidentDetails.mock.calls[0]![1].text).toContain(
      `- ${charge}: ended meanwhile (Instance ${charge} does not run on`,
    )
  })

  test("says when it read only the first hundred reasons", async () => {
    const opened = await openMigration(
      withCommands((commands) => ({
        migrateInstances: (plan, ids) =>
          commands.migrateInstances(
            { ...plan, mappings: plan.mappings.filter((m) => m.sourceElementId !== REVIEW) },
            ids,
          ),
      })),
      (runtime) =>
        new PatchedRuntime(runtime, {
          getBulkFailures: () =>
            Promise.resolve(
              Array.from({ length: 100 }, (_, index) => ({ reason: `job ${index}` })),
            ),
        }),
    )
    await opened.panel.handle({ type: "startMigration" })
    await workOff(opened)

    await opened.panel.handle({ type: "showBulkFailures" })

    const text = opened.fixture.effects.showIncidentDetails.mock.calls[0]![1].text
    expect(text.split("\n").at(-1)).toBe("Pulse read the first 100 failures.")
  })

  test("uses only the newest check result when an older check answers last", async () => {
    let releaseFirst: () => void = () => undefined
    let checks = 0
    const opened = await openMigration(
      { writable: true },
      (runtime) =>
        new PatchedRuntime(runtime, {
          checkMigration: async (plan) => {
            checks += 1
            if (checks === 2) {
              await new Promise<void>((resolve) => (releaseFirst = resolve))
              return { problems: [{ mapping: plan.mappings[0]!, message: "stale answer" }] }
            }
            return runtime.checkMigration(plan)
          },
        }),
    )

    await opened.panel.handle({ type: "unmapElement", sourceElementId: REVIEW })
    await opened.gate.open()
    await opened.panel.handle({ type: "unmapElement", sourceElementId: CHARGE })
    releaseFirst()
    await WaitGate.settle()

    expect(opened.view().rows.some((row) => row.problem === "stale answer")).toBe(false)
    expect(opened.view().summary).toBe("0 mapped · 2 without a mapping · checking…")

    await opened.gate.open()

    expect(opened.view().summary).toBe("0 mapped · 2 without a mapping · checked just now")
  })

  test("says that the version to migrate from was not found", async () => {
    const fixture = panelFixture((runtime) => runtime, { writable: true })
    const panel = new MigrationPanel(fixture.context, {
      bpmnProcessId: ORDER,
      sourceDefinitionId: fixture.world.definitionIds["dispatch@1"],
      instanceIds: [],
    })

    await panel.handle({ type: "ready" })

    expect(fixture.lastState()).toMatchObject({
      status: "failed",
      problem: { title: expect.stringContaining("was not found") as unknown },
    })
  })

  test("loads again when it is shown after a run that was going on when it opened", async () => {
    const fixture = panelFixture((runtime) => runtime, { writable: true })
    const gate = new WaitGate()
    const context: PanelContext = { ...fixture.context, wait: gate.wait }
    const definition = new DefinitionPanel(
      { ...context, publish: () => undefined },
      { bpmnProcessId: ORDER, definitionId: fixture.world.definitionIds["order@1"] },
    )
    const ids = [fixture.world.instanceIds["ORD-1001"], fixture.world.instanceIds["ORD-1002"]]
    await definition.handle({ type: "ready" })
    await definition.handle({ type: "toggleInstances", ids: [ids[0]!], selected: true })
    await definition.handle({ type: "startBulk", action: "cancelInstances" })
    const panel = new MigrationPanel(context, {
      bpmnProcessId: ORDER,
      sourceDefinitionId: fixture.world.definitionIds["order@1"],
      instanceIds: ids,
    })
    await panel.handle({ type: "ready" })
    panel.attend("hidden")
    for (let round = 0; round < 4 && gate.pending > 0; round += 1) {
      await gate.open()
    }

    panel.attend("watched")
    await WaitGate.settle()

    expect(migrationView(fixture.lastState()).count).toBe(1)
  })

  test("keeps a kept batch on the strip and refuses another bulk write until it is removed", async () => {
    const opened = await openMigration(
      withCommands((commands) => ({
        migrateInstances: (plan, ids) =>
          commands.migrateInstances(
            { ...plan, mappings: plan.mappings.filter((m) => m.sourceElementId !== REVIEW) },
            ids,
          ),
      })),
    )
    await opened.panel.handle({ type: "startMigration" })
    await workOff(opened)
    const definition = new DefinitionPanel(
      { ...opened.fixture.context, publish: () => undefined },
      { bpmnProcessId: ORDER, definitionId: opened.fixture.world.definitionIds["order@1"] },
    )
    await definition.handle({ type: "ready" })

    await opened.panel.handle({ type: "dismissBulk" })
    await definition.handle({ type: "toggleInstances", ids: [opened.ids[0]!], selected: true })
    await definition.handle({ type: "startBulk", action: "cancelInstances" })

    expect(opened.view().bulk?.notice.title).toBe("Migrated 1 of 2 to v2. 1 still on v1.")
    expect(opened.fixture.effects.confirmBulk).toHaveBeenCalledOnce()
    expect(opened.fixture.effects.reportProblem).toHaveBeenCalledWith(
      expect.objectContaining({ title: "The engine keeps the batch of the last bulk write." }),
    )
  })

  test("keeps the edited mapping when the same version is opened again with a new selection", async () => {
    const opened = await openMigration()
    await opened.panel.handle({ type: "unmapElement", sourceElementId: REVIEW })
    await opened.gate.open()

    await opened.panel.retarget({
      bpmnProcessId: ORDER,
      sourceDefinitionId: opened.fixture.world.definitionIds["order@1"],
      instanceIds: [opened.ids[1]!],
    })

    expect(opened.view().rows.find((row) => row.sourceElementId === REVIEW)).not.toHaveProperty(
      "targetElementId",
    )
    expect(opened.view().count).toBe(1)
    expect(opened.fixture.calls.filter((call) => call === "proposeMigration")).toHaveLength(1)
  })
})
