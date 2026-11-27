import {
  BpmnProcessId,
  RuntimeError,
  type MigrationPlan,
  type ProcessCommands,
  type ProcessRuntime,
} from "@miragon/pulse-engine-core"
import { PatchedRuntime } from "@miragon/pulse-engine-core/testing"
import { MigrationPlanParser, MigrationPlanVocabulary } from "@miragon/pulse-migration-plan"
import { describe, expect, test, vi } from "vitest"
import type { PlanContext } from "../../src/core/plans/plan-context.js"
import type { PanelState, WebviewIntent } from "../../src/core/protocol/index.js"
import { deferred } from "./support/board-fixture.js"
import {
  CHARGE,
  PLAN_FILE,
  PLAN_LOCATION,
  REVIEW,
  openPlan,
  planText,
  planless,
  planView,
  same,
} from "./support/plan-fixture.js"
import { WaitGate } from "./support/wait-gate.js"

const ORDER = BpmnProcessId("pulse-order")
const FITS = planText(same(REVIEW, CHARGE))
const LOOP = "<bpmn:multiInstanceLoopCharacteristics />"
const SPLIT = "Gateway_Split"
const JOIN = "Gateway_Join"
const FORK = `<bpmn:parallelGateway id="${SPLIT}" /><bpmn:parallelGateway id="${JOIN}" />`

type IntentSamples = {
  readonly [Type in WebviewIntent["type"]]: Extract<WebviewIntent, { type: Type }>
}

const EVERY_INTENT: IntentSamples = {
  ready: { type: "ready" },
  refresh: { type: "refresh" },
  goBack: { type: "goBack" },
  selectVersion: { type: "selectVersion", definitionId: "pulse-order:2" },
  filterInstances: { type: "filterInstances", filter: { scope: "all" } },
  loadMoreInstances: { type: "loadMoreInstances" },
  filterProcesses: { type: "filterProcesses", filter: { scope: "all" } },
  openProcess: { type: "openProcess", bpmnProcessId: "pulse-order", toSide: false },
  openInstance: { type: "openInstance", instanceId: "i-1", toSide: false },
  openCall: { type: "openCall", elementId: REVIEW, toSide: false },
  openDefinition: {
    type: "openDefinition",
    bpmnProcessId: "pulse-order",
    definitionId: "pulse-order:2",
  },
  openIncidentDetails: { type: "openIncidentDetails", incidentId: "x" },
  selectElement: { type: "selectElement", elementId: REVIEW },
  openModel: { type: "openModel" },
  openCode: { type: "openCode" },
  copy: { type: "copy", text: "pulse-order", label: "Process ID" },
  copyHandover: { type: "copyHandover" },
  openWebUi: { type: "openWebUi" },
  editConnection: { type: "editConnection" },
  setCredentials: { type: "setCredentials" },
  retryIncident: { type: "retryIncident", incidentId: "x" },
  setVariable: { type: "setVariable", name: "route", valueJson: '"review"' },
  pauseLiveUpdates: { type: "pauseLiveUpdates" },
  resumeLiveUpdates: { type: "resumeLiveUpdates" },
  turnOnLiveUpdates: { type: "turnOnLiveUpdates" },
  holdLiveUpdates: { type: "holdLiveUpdates", held: true },
  toggleInstances: { type: "toggleInstances", ids: ["i-1"], selected: true },
  suggestVariableNames: { type: "suggestVariableNames" },
  selectMatching: { type: "selectMatching" },
  clearSelection: { type: "clearSelection" },
  startBulk: { type: "startBulk", action: "cancelInstances" },
  stopBulk: { type: "stopBulk" },
  dismissBulk: { type: "dismissBulk" },
  checkBulk: { type: "checkBulk" },
  selectRemaining: { type: "selectRemaining" },
  showBulkFailures: { type: "showBulkFailures" },
  openMigration: { type: "openMigration" },
  pickMigrationTarget: { type: "pickMigrationTarget", definitionId: "pulse-order:2" },
  mapElement: { type: "mapElement", sourceElementId: REVIEW, targetElementId: CHARGE },
  unmapElement: { type: "unmapElement", sourceElementId: REVIEW },
  focusMapping: { type: "focusMapping", sourceElementId: REVIEW },
  leaveOutUnmapped: { type: "leaveOutUnmapped" },
  startMigration: { type: "startMigration" },
  activity: { type: "activity" },
  openBoardInstance: { type: "openBoardInstance", engine: "local", instanceId: "i", toSide: false },
  openBoardProcess: {
    type: "openBoardProcess",
    engine: "local",
    bpmnProcessId: "pulse-order",
    filter: { scope: "all" },
    toSide: false,
  },
  openBoardEngine: { type: "openBoardEngine", engine: "local", toSide: false },
  openBoardFile: { type: "openBoardFile" },
  openPlanFile: { type: "openPlanFile" },
  setBoardCredentials: { type: "setBoardCredentials", engine: "local" },
  moveToken: { type: "moveToken", fromElementId: REVIEW, toElementId: CHARGE, reason: "stuck" },
}

const NAVIGATION_EFFECTS = [
  "copyToClipboard",
  "editConnection",
  "goBack",
  "openDefinition",
  "openSource",
  "setCredentials",
]

function recording(commands: ProcessCommands, written: string[]): ProcessCommands {
  return new Proxy(commands, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key)
      if (typeof value !== "function") {
        return value
      }
      return (...args: unknown[]) => {
        written.push(String(key))
        return (value as (...parameters: unknown[]) => unknown).apply(target, args)
      }
    },
  })
}

function checking(plans: MigrationPlan[]): (runtime: ProcessRuntime) => ProcessRuntime {
  return (runtime) =>
    new PatchedRuntime(runtime, {
      checkMigration: (plan) => {
        plans.push(plan)
        return runtime.checkMigration!(plan)
      },
    })
}

function forking(plans: MigrationPlan[]): (runtime: ProcessRuntime) => ProcessRuntime {
  return (runtime) =>
    new PatchedRuntime(runtime, {
      getDiagramXml: async (definitionId) =>
        (await runtime.getDiagramXml(definitionId))?.replace(
          "</bpmn:process>",
          `${FORK}</bpmn:process>`,
        ),
      checkMigration: (plan) => {
        plans.push(plan)
        return Promise.resolve({ problems: [] })
      },
    })
}

function looping(runtime: ProcessRuntime): ProcessRuntime {
  return new PatchedRuntime(runtime, {
    getDiagramXml: async (definitionId) =>
      (await runtime.getDiagramXml(definitionId))?.replace(
        `name="Review order">`,
        `name="Review order">${LOOP}`,
      ),
  })
}

function problemOf(state: PanelState) {
  if (state.status !== "failed") {
    throw new Error(`expected a failed state, got ${state.status}`)
  }
  return state.problem
}

describe("opening a migration plan", () => {
  test("reads the file, both versions by their numbers, their diagrams and the statistics, then checks the plan", async () => {
    const opened = await openPlan(FITS)

    expect(opened.fixture.calls).toEqual([
      "listDefinitions",
      "listVersions",
      "getDiagramXml",
      "getDiagramXml",
      "getElementStatistics",
      "checkMigration",
    ])
    expect(opened.view()).toMatchObject({
      fileName: PLAN_FILE,
      processName: "Order fulfillment",
      bpmnProcessId: "pulse-order",
      source: { version: 1, definitionId: opened.fixture.world.definitionIds["order@1"] },
      target: { version: 2, definitionId: opened.fixture.world.definitionIds["order@2"] },
      running: 2,
      withIncident: 1,
      summary: "2 mapped · no problems",
      verdict: {
        fits: true,
        text: "The engine finds no problem in the plan, and every element where instances wait has a mapping in v2.",
      },
    })
    expect(opened.view().rows.map((row) => [row.sourceElementId, row.tokens])).toEqual([
      [REVIEW, 1],
      [CHARGE, 1],
    ])
    expect(opened.source.reads).toBe(1)
  })

  test("loads while it says which file it reads", async () => {
    const opened = await openPlan(FITS)

    expect(opened.fixture.states[0]).toEqual({
      status: "loading",
      title: PLAN_FILE,
      engine: opened.fixture.context.engine,
    })
  })

  test("hands the editor no commands, bulk runs, CLI or local sources, only a wait to settle its checks", async () => {
    const opened = await openPlan(FITS)
    const context = Reflect.get(opened.panel, "context") as PlanContext

    expect(Object.keys(context).sort()).toEqual([
      "diagrams",
      "engine",
      "navigation",
      "now",
      "publish",
      "runtime",
      "source",
      "wait",
    ])
  })

  test("never reads an instance, a proposal, a bulk operation or the history", async () => {
    const opened = await openPlan(FITS)
    await opened.panel.handle({ type: "refresh" })

    expect(opened.fixture.calls).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/Instance|propose|Bulk|Incident/)]),
    )
  })

  test("still builds on an engine whose history-backed reads fail", async () => {
    const broken = () => Promise.reject(new RuntimeError("engineFailure", "no history"))
    const opened = await openPlan(
      FITS,
      (runtime) =>
        new PatchedRuntime(runtime, {
          searchInstances: broken,
          countInstances: broken,
          searchIncidents: broken,
          getInstanceDetail: broken,
        }),
    )

    expect(opened.view().verdict.fits).toBe(true)
  })
})

describe("every intent the preview gets", () => {
  test("starts nothing: no write and no effect but opening, copying and the connection", async () => {
    const written: string[] = []
    const opened = await openPlan(FITS, undefined, {
      writable: true,
      adaptCommands: (commands) => recording(commands, written),
    })

    for (const intent of Object.values(EVERY_INTENT)) {
      await opened.panel.handle(intent)
    }

    expect(written).toEqual([])
    const used = Object.entries(opened.fixture.effects)
      .filter(([, effect]) => effect.mock.calls.length > 0)
      .map(([name]) => name)
    expect(used.sort()).toEqual(NAVIGATION_EFFECTS)
    expect(opened.fixture.calls).not.toContain("proposeMigration")
  })

  test("forwards going back, copying and the connection to the host", async () => {
    const opened = await openPlan(FITS)

    await opened.panel.handle({ type: "goBack" })
    await opened.panel.handle({ type: "copy", text: "pulse-order", label: "Process ID" })
    await opened.panel.handle({ type: "editConnection" })
    await opened.panel.handle({ type: "setCredentials" })

    const { effects } = opened.fixture
    expect(effects.goBack).toHaveBeenCalledOnce()
    expect(effects.copyToClipboard).toHaveBeenCalledWith("pulse-order", "Process ID")
    expect(effects.editConnection).toHaveBeenCalledOnce()
    expect(effects.setCredentials).toHaveBeenCalledOnce()
  })

  test("opens only the two versions it shows, in place", async () => {
    const opened = await openPlan(FITS)
    const { definitionIds } = opened.fixture.world
    const open = (bpmnProcessId: string, definitionId: string) =>
      opened.panel.handle({ type: "openDefinition", bpmnProcessId, definitionId })

    await open("pulse-order", definitionIds["order@1"])
    await open("pulse-order", definitionIds["order@2"])
    await open("pulse-order", "pulse-order:9")
    await open("pulse-dispatch", definitionIds["order@1"])

    expect(opened.fixture.effects.openDefinition.mock.calls).toEqual([
      [ORDER, definitionIds["order@1"], { toSide: false }],
      [ORDER, definitionIds["order@2"], { toSide: false }],
    ])
  })

  test("opens nothing before the plan is shown", async () => {
    const opened = await openPlan("{")

    await opened.panel.handle({ ...EVERY_INTENT.openDefinition })
    await opened.panel.handle({ type: "focusMapping", sourceElementId: REVIEW })

    expect(opened.fixture.effects.openDefinition).not.toHaveBeenCalled()
    expect(opened.fixture.lastState().status).toBe("failed")
  })

  test("shows the file where the host keeps it", async () => {
    const opened = await openPlan(FITS)

    await opened.panel.handle({ type: "openPlanFile" })

    expect(opened.fixture.effects.openSource).toHaveBeenCalledWith(PLAN_LOCATION)
  })

  test("focuses a mapping only on a row it shows", async () => {
    const opened = await openPlan(FITS)
    const published = opened.fixture.states.length

    await opened.panel.handle({ type: "focusMapping", sourceElementId: "Nowhere" })
    expect(opened.fixture.states).toHaveLength(published)

    await opened.panel.handle({ type: "focusMapping", sourceElementId: CHARGE })
    expect(opened.view().focused).toBe(CHARGE)
    expect(opened.fixture.calls.filter((call) => call === "checkMigration")).toHaveLength(1)
  })

  test("keeps attention and nudges to itself and publishes nothing once closed", async () => {
    const opened = await openPlan(FITS)
    const published = opened.fixture.states.length

    opened.panel.attend()
    opened.panel.nudge()
    opened.panel.dispose()
    await opened.panel.handle({ type: "refresh" })

    expect(opened.fixture.states).toHaveLength(published)
  })
})

describe("a file the preview refuses", () => {
  test("is named with its first problem and reads nothing on the engine", async () => {
    const opened = await openPlan('{ "bpmnProcessId": "order:1:abc" }')

    expect(problemOf(opened.fixture.lastState())).toEqual({
      title: `Pulse can't read ${PLAN_FILE} as a migration plan.`,
      detail:
        "bpmnProcessId must be a BPMN process id: letters, digits, _, . or -, starting with a letter or _, at most 255 characters. And 3 more problems.",
      canEditConnection: false,
      file: PLAN_FILE,
    })
    expect(opened.fixture.calls).toEqual([])
  })

  test("says when it cannot read the file", async () => {
    const fixture = await openPlan(FITS)
    fixture.source.failure = new Error("EACCES")

    await fixture.panel.handle({ type: "refresh" })

    expect(problemOf(fixture.fixture.lastState())).toEqual({
      title: `Pulse can't read ${PLAN_FILE}.`,
      detail: "Check that the file is there and that you may read it.",
      canEditConnection: false,
      file: PLAN_FILE,
    })
    expect(fixture.source.reads).toBe(1)
  })

  test("refuses a file longer than the format reads before reading it", async () => {
    const opened = await openPlan(FITS)
    opened.source.bytes = MigrationPlanVocabulary.MAX_PLAN_CHARACTERS + 1

    await opened.panel.handle({ type: "refresh" })

    expect(problemOf(opened.fixture.lastState()).detail).toBe(
      "The file is longer than 1048576 characters.",
    )
    expect(opened.source.reads).toBe(1)
  })

  test("keeps the plan it showed under the problem", async () => {
    const opened = await openPlan(FITS)
    opened.source.text = "[]"

    await opened.panel.handle({ type: "refresh" })

    const state = opened.fixture.lastState()
    expect(state.status === "failed" && state.staleView?.kind).toBe("migrationPlan")
    expect(opened.source.reads).toBe(2)
  })

  test("opens the file it refuses, so you can fix it", async () => {
    const opened = await openPlan("{ broken")

    await opened.panel.handle({ type: "openPlanFile" })

    expect(opened.fixture.lastState().status).toBe("failed")
    expect(opened.fixture.effects.openSource).toHaveBeenCalledWith(PLAN_LOCATION)
  })

  test("names a file the format's parser fails on as the file's problem, never the engine's", async () => {
    vi.spyOn(MigrationPlanParser, "parse").mockImplementation(() => {
      throw new RangeError("Maximum call stack size exceeded")
    })

    const opened = await openPlan(FITS)

    expect(problemOf(opened.fixture.lastState())).toEqual({
      title: `Pulse can't read ${PLAN_FILE} as a migration plan.`,
      detail: "The file holds no plan Pulse can read; write it again with pulse plan-migration.",
      canEditConnection: false,
      file: PLAN_FILE,
    })
    expect(opened.fixture.calls).toEqual([])
  })
})

describe("an engine the plan does not fit", () => {
  test("that checks no migration plans is named without a read", async () => {
    const opened = await openPlan(FITS, planless)

    expect(problemOf(opened.fixture.lastState())).toEqual({
      title: "local cannot do this.",
      detail: "This engine does not plan migrations of instances.",
      canEditConnection: false,
    })
    expect(opened.fixture.calls).toEqual([])
  })

  test("without the version the plan names is named before any diagram is read", async () => {
    const opened = await openPlan(planText(same(REVIEW), 3))

    expect(problemOf(opened.fixture.lastState())).toEqual({
      title: "local has no v3 of pulse-order.",
      detail:
        "A plan names versions by their numbers, and each engine numbers its own deployments; open the plan on the engine it was written for, or write it again for this engine.",
      canEditConnection: false,
      file: PLAN_FILE,
    })
    expect(opened.fixture.calls).toEqual(["listDefinitions", "listVersions"])
  })

  test("with no version of the process at all misses the source", async () => {
    const opened = await openPlan(
      FITS,
      (runtime) => new PatchedRuntime(runtime, { listVersions: () => Promise.resolve([]) }),
    )

    expect(problemOf(opened.fixture.lastState()).title).toBe("local has no v1 of pulse-order.")
  })

  test("with a version deployed twice, one per tenant, refuses to guess", async () => {
    const opened = await openPlan(
      FITS,
      (runtime) =>
        new PatchedRuntime(runtime, {
          listVersions: async (id, tenantId) => {
            const versions = await runtime.listVersions(id, tenantId)
            return [...versions, ...versions.filter((version) => version.definition.version === 1)]
          },
        }),
    )

    expect(problemOf(opened.fixture.lastState())).toEqual({
      title: "local has v1 of pulse-order 2 times.",
      detail:
        "Each tenant numbers its own versions, and a plan names no tenant, so Pulse can't tell which one it means.",
      canEditConnection: false,
      file: PLAN_FILE,
    })
  })

  test("leaves a pair out that does not fit, never sends it, and says so first", async () => {
    const plans: MigrationPlan[] = []
    const opened = await openPlan(
      planText([...same(REVIEW), { sourceElementId: CHARGE, targetElementId: REVIEW }]),
      checking(plans),
    )

    expect(plans.map((plan) => plan.mappings)).toEqual([same(REVIEW)])
    expect(opened.view().verdict).toEqual({
      fits: false,
      text: "Pulse left out 1 mapping of the plan that doesn't fit v1 and v2 on local; the engine checked the rest.",
    })
    expect(opened.view().rows[0]).toMatchObject({
      sourceElementId: CHARGE,
      targetElementId: REVIEW,
      refused: "Review order in v2 is of another kind than Charge payment.",
    })
  })

  test("sends the scope pair of a multi-instance element with the element", async () => {
    const plans: MigrationPlan[] = []
    const scope = `${REVIEW}#multiInstanceBody`
    const opened = await openPlan(planText(same(REVIEW, scope, CHARGE)), (runtime) =>
      checking(plans)(looping(runtime)),
    )

    expect(plans[0]?.mappings).toEqual(same(CHARGE, REVIEW, scope))
    expect(opened.view().rows.some((row) => row.refused !== undefined)).toBe(false)
  })

  test("leaves the scope pair of an element without a loop out", async () => {
    const plans: MigrationPlan[] = []
    const scope = `${REVIEW}#multiInstanceBody`
    const opened = await openPlan(planText(same(REVIEW, scope)), checking(plans))

    expect(plans[0]?.mappings).toEqual(same(REVIEW))
    expect(opened.view().rows[0]).toMatchObject({
      sourceElementId: scope,
      sourceLabel: scope,
      refused: `${scope} names a scope that Review order in v1 doesn't have.`,
    })
  })

  test("sends the pairs of a parallel split and join the engine proposed, and the engine maps them", async () => {
    const plans: MigrationPlan[] = []
    const opened = await openPlan(planText(same(REVIEW, CHARGE, SPLIT, JOIN)), forking(plans))

    expect(plans[0]?.mappings).toHaveLength(4)
    expect(plans[0]?.mappings).toEqual(expect.arrayContaining(same(SPLIT, JOIN)))
    expect(opened.view().rows.some((row) => row.refused !== undefined)).toBe(false)
    expect(opened.view().verdict.fits).toBe(true)
    expect(opened.view().summary).toBe("4 mapped · no problems")
  })

  test("checks a plan whose every pair was left out with no pair", async () => {
    const plans: MigrationPlan[] = []
    await openPlan(planText(same("Activity_Gone")), checking(plans))

    expect(plans.map((plan) => plan.mappings)).toEqual([[]])
  })
})

describe("reading the plan again", () => {
  test("reads the file and the engine anew on refresh", async () => {
    const opened = await openPlan(planText(same(REVIEW)))
    opened.source.text = FITS

    await opened.panel.handle({ type: "refresh" })

    expect(opened.source.reads).toBe(2)
    expect(opened.fixture.calls.filter((call) => call === "listVersions")).toHaveLength(2)
    expect(opened.view().summary).toBe("2 mapped · no problems")
  })

  test("reads once more after a read still running, and shows the newest file", async () => {
    const first = deferred<undefined>()
    let call = 0
    const opened = await openPlan(
      FITS,
      (runtime) =>
        new PatchedRuntime(runtime, {
          listVersions: async (id, tenantId) => {
            call += 1
            if (call === 2) {
              await first.promise
            }
            return runtime.listVersions(id, tenantId)
          },
        }),
    )
    opened.source.text = planText(same(REVIEW))
    const older = opened.panel.handle({ type: "refresh" })
    await WaitGate.settle()
    opened.source.text = FITS

    const newer = opened.panel.handle({ type: "refresh" })
    first.resolve(undefined)
    await Promise.all([older, newer])

    expect(opened.view().summary).toBe("2 mapped · no problems")
    expect(opened.source.reads).toBe(3)
  })

  test("keeps the plan under the problem when the engine fails", async () => {
    let failing = false
    const opened = await openPlan(
      FITS,
      (runtime) =>
        new PatchedRuntime(runtime, {
          listVersions: (id, tenantId) =>
            failing
              ? Promise.reject(new RuntimeError("unreachable", "connect ECONNREFUSED"))
              : runtime.listVersions(id, tenantId),
        }),
    )
    failing = true

    await opened.panel.handle({ type: "refresh" })

    const state = opened.fixture.lastState()
    expect(problemOf(state).title).toBe("Can't reach local.")
    expect(state.status === "failed" && state.staleView?.kind).toBe("migrationPlan")
  })

  test("publishes the shown plan again when the webview is ready again", async () => {
    const opened = await openPlan(FITS)

    await opened.panel.handle({ type: "ready" })

    expect(planView(opened.fixture.lastState()).summary).toBe(opened.view().summary)
    expect(opened.source.reads).toBe(1)
  })

  test("publishes the problem again, not the old plan, when the webview is ready after a failed refresh", async () => {
    const opened = await openPlan(FITS)
    opened.source.text = "{ broken"
    await opened.panel.handle({ type: "refresh" })

    await opened.panel.handle({ type: "ready" })

    const state = opened.fixture.lastState()
    expect(problemOf(state).title).toBe(`Pulse can't read ${PLAN_FILE} as a migration plan.`)
    expect(state.status === "failed" && state.staleView?.kind).toBe("migrationPlan")
    expect(opened.source.reads).toBe(2)
  })

  test.each([
    { saved: "{ broken", settles: "failed" },
    { saved: FITS, settles: "ready" },
  ])(
    "shows no older plan while it reads a broken file again ($settles)",
    async ({ saved, settles }) => {
      const opened = await openPlan(FITS)
      opened.source.text = "{ broken"
      await opened.panel.handle({ type: "refresh" })
      const before = opened.fixture.states.length

      opened.source.text = saved
      await opened.panel.handle({ type: "refresh" })

      const published = opened.fixture.states.slice(before)
      expect(published.map((state) => state.status)).toEqual(["loading", settles])
      expect(published[0]).toMatchObject({ status: "loading", title: PLAN_FILE })
    },
  )
})
