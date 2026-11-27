import { describe, expect, it } from "vitest"
import type { CockpitAppData, CockpitStart, CockpitView } from "../../view-models.js"
import {
  activeSectionOf,
  type CockpitAction,
  cockpitReducer,
  type CockpitState,
  keptProcesses,
  startViewOf,
} from "./cockpit-state.js"

/** The state the cockpit boots into on `engineId` and `view`, as the host's data opens it. */
function booted(engineId: string | null, view: CockpitView | null = null): CockpitState {
  const empty = cockpitReducer({} as CockpitState, { type: "boot", engineId: null, view: null })
  return cockpitReducer(empty, { type: "boot", engineId, view })
}

const run = (state: CockpitState, ...actions: CockpitAction[]) =>
  actions.reduce(cockpitReducer, state)
const sections = (state: CockpitState) => state.stack.map((view) => view.section)

describe("a start below the head sections sits under the section it belongs to (N10)", () => {
  it.each<[CockpitView, string]>([
    [{ section: "incident-detail", incidentId: "inc-1" }, "incidents"],
    [{ section: "cluster-detail", activityId: "a", incidentType: "failedJob" }, "incidents"],
    [{ section: "jobs", processDefinitionKey: "invoice" }, "jobs"],
    [{ section: "instance-detail", processInstanceId: "pi-1" }, "overview"],
    [{ section: "process-detail", processDefinitionKey: "invoice" }, "overview"],
    [{ section: "process-instances", processDefinitionKey: "invoice" }, "overview"],
    [{ section: "history", processInstanceId: "pi-1" }, "overview"],
  ])("%o under %s", (view, parent) => {
    const state = booted("prod-a", view)
    expect(sections(state)).toEqual([parent, view.section])
    expect(activeSectionOf(state.stack)).toBe(parent)
    expect(state.moved).toBe("replace")
  })

  it("a board's target sits under the board alone, no section current", () => {
    const board = cockpitReducer(booted(null), {
      type: "open-board",
      view: { section: "board", board: "invoices", label: "Invoices" },
    })
    const target = cockpitReducer(board, {
      type: "board-target",
      engine: "prod-a",
      view: { section: "instance-detail", processInstanceId: "pi-1", label: "INV-1" },
    })
    expect(target.scope).toEqual({ kind: "engine", engineId: "prod-a" })
    expect(sections(target)).toEqual(["instance-detail"])
    expect(target.fromBoard).toMatchObject({ board: "invoices" })
    expect(activeSectionOf(target.stack)).toBeNull()
  })
})

describe("the start view's crumb takes the name its data knows (N6)", () => {
  const started = (view: CockpitView, data: unknown): CockpitAppData => ({
    engineId: "prod-a",
    engines: [],
    start: { view, data } as CockpitStart,
  })

  it.each<[CockpitView, unknown, string | undefined]>([
    [
      { section: "instance-detail", processInstanceId: "pi-1" },
      { instance: { businessKey: "CUST-22224" } },
      "CUST-22224",
    ],
    [
      { section: "instance-detail", processInstanceId: "pi-1" },
      { instance: { businessKey: null } },
      undefined,
    ],
    [
      { section: "process-detail", processDefinitionKey: "miraveloLeasing" },
      { processDefinitionName: "Miravelo - Bike Leasing" },
      "Miravelo - Bike Leasing",
    ],
    [
      {
        section: "cluster-detail",
        activityId: "Activity_CheckBlacklist",
        incidentType: "failedJob",
      },
      { activityName: "Check blacklist" },
      "Check blacklist",
    ],
    [
      { section: "incident-detail", incidentId: "inc-1" },
      { activityName: "Check blacklist" },
      "Check blacklist",
    ],
    [{ section: "board", board: "ops" }, { title: "Leasing operations" }, "Leasing operations"],
    [{ section: "history", processInstanceId: "pi-1" }, { processName: "x" }, undefined],
    [{ section: "incident-detail", incidentId: "inc-1" }, null, undefined],
  ])("%o", (view, data, label) => {
    const start = startViewOf(started(view, data))
    expect(start).toMatchObject(view)
    expect(start && "label" in start ? start.label : undefined).toBe(label)
  })

  it("a page's failed start opens its view without data, and no start opens nothing", () => {
    const view: CockpitView = { section: "jobs" }
    expect(startViewOf({ engineId: "prod-a", engines: [], start: null, startView: view })).toBe(
      view,
    )
    expect(startViewOf(null)).toBeNull()
  })
})

describe("an engine switch keeps the section and the process (N7)", () => {
  const detail: CockpitView = {
    section: "process-detail",
    processDefinitionKey: "invoice",
    label: "Invoice",
  }
  const instances: CockpitView = { section: "process-instances", processDefinitionKey: "invoice" }
  const instance: CockpitView = { section: "instance-detail", processInstanceId: "pi-1" }

  it("keeps the head section", () => {
    const state = run(
      booted("prod-a"),
      { type: "incidents" },
      { type: "switch-engine", id: "prod-b" },
    )
    expect(state.scope).toEqual({ kind: "engine", engineId: "prod-b" })
    expect(sections(state)).toEqual(["incidents"])
    expect(state.moved).toBe("push")
  })

  it("keeps the views a process key addresses, up to the first of one instance", () => {
    const state = run(
      booted("prod-a", detail),
      { type: "process-instances", processDefinitionKey: "invoice" },
      { type: "instance-detail", processInstanceId: "pi-1" },
    )
    expect(sections(state)).toEqual([
      "overview",
      "process-detail",
      "process-instances",
      "instance-detail",
    ])
    expect(keptProcesses(state.stack)).toEqual([{ key: "invoice" }])
    const switched = cockpitReducer(state, { type: "switch-engine", id: "prod-b" })
    expect(switched.stack).toEqual([{ section: "overview" }, detail, instances])
    expect(switched.seededKey).toBeNull()
  })

  it("leaves an id-addressed view for its section: an incident's ids are another engine's", () => {
    const state = booted("prod-a", { section: "incident-detail", incidentId: "inc-1" })
    expect(keptProcesses(state.stack)).toEqual([])
    expect(sections(cockpitReducer(state, { type: "switch-engine", id: "prod-b" }))).toEqual([
      "incidents",
    ])
    expect(
      sections(run(booted("prod-a", instance), { type: "switch-engine", id: "prod-b" })),
    ).toEqual(["overview"])
  })

  it("keeps the jobs of a process under Jobs", () => {
    const state = booted("prod-a", { section: "jobs", processDefinitionKey: "invoice" })
    const switched = cockpitReducer(state, { type: "switch-engine", id: "prod-b" })
    expect(switched.stack).toEqual([
      { section: "jobs" },
      { section: "jobs", processDefinitionKey: "invoice" },
    ])
  })

  it("a board's target falls back to the overview, the views of its process kept", () => {
    const target = run(booted(null), {
      type: "board-target",
      engine: "prod-a",
      view: detail,
    })
    expect(cockpitReducer(target, { type: "switch-engine", id: "prod-b" }).stack).toEqual([
      { section: "overview" },
      detail,
    ])
  })

  it("a process the new engine does not deploy: its section, said by the process's name", () => {
    const switched = run(booted("prod-a", detail), { type: "switch-engine", id: "prod-b" })
    const gone = cockpitReducer(switched, {
      type: "process-gone",
      engineId: "prod-b",
      process: { key: "invoice" },
    })
    expect(sections(gone)).toEqual(["overview"])
    expect(gone.processGone).toEqual({ engineId: "prod-b", process: "Invoice" })
    expect(gone.moved).toBe("replace")
    // The next move says it no more.
    expect(cockpitReducer(gone, { type: "incidents" }).processGone).toBeNull()
  })

  it("an answer for an engine or process the reader has left changes nothing", () => {
    const switched = run(booted("prod-a", detail), { type: "switch-engine", id: "prod-b" })
    expect(
      cockpitReducer(switched, {
        type: "process-gone",
        engineId: "prod-a",
        process: { key: "invoice" },
      }),
    ).toBe(switched)
    const moved = cockpitReducer(switched, { type: "incidents" })
    expect(
      cockpitReducer(moved, {
        type: "process-gone",
        engineId: "prod-b",
        process: { key: "invoice" },
      }),
    ).toBe(moved)
  })
})

describe("how a move goes into a page's history", () => {
  it("a drill and a section add an entry; another focus of the same view names it anew", () => {
    const detail = booted("prod-a", { section: "process-detail", processDefinitionKey: "invoice" })
    expect(cockpitReducer(detail, { type: "incidents" }).moved).toBe("push")
    expect(
      cockpitReducer(detail, { type: "process-incidents", processDefinitionKey: "invoice" }).moved,
    ).toBe("replace")
    expect(cockpitReducer(detail, { type: "pop", to: 0 }).moved).toBe("push")
  })

  it("the jobs' segment names the entry anew in the other scope; other jobs are another view", () => {
    const jobs = booted("prod-a", { section: "jobs", failedOnly: true })
    const all = cockpitReducer(jobs, { type: "jobs", failedOnly: undefined })
    expect(all.stack).toEqual([{ section: "jobs", failedOnly: undefined }])
    expect(all.moved).toBe("replace")
    // A process's jobs: the scope changes in place, never a twin entry of the same jobs.
    const process = booted("prod-a", { section: "process-detail", processDefinitionKey: "invoice" })
    const drilled = cockpitReducer(process, {
      type: "jobs",
      processDefinitionKey: "invoice",
      failedOnly: true,
    })
    expect(drilled.moved).toBe("push")
    const scoped = cockpitReducer(drilled, { type: "jobs", processDefinitionKey: "invoice" })
    expect(sections(scoped)).toEqual(["overview", "process-detail", "jobs"])
    expect(scoped.stack.at(-1)).toEqual({ section: "jobs", processDefinitionKey: "invoice" })
    expect(scoped.moved).toBe("replace")
    // The head's Jobs over one process's jobs is the engine's jobs, a move of its own.
    const head = cockpitReducer(scoped, { type: "jobs" })
    expect(sections(head)).toEqual(["jobs"])
    expect(head.moved).toBe("push")
  })

  it("the page's address leads back as the entry kept it, never adding one", () => {
    const left = run(booted("prod-a"), {
      type: "process-detail",
      processDefinitionKey: "invoice",
      label: "Invoice",
    })
    const memo = { scope: left.scope, stack: left.stack, fromBoard: left.fromBoard }
    const elsewhere = cockpitReducer(left, { type: "to-landing" })
    const back = cockpitReducer(elsewhere, { type: "arrive", action: { type: "restore", memo } })
    expect(back.stack).toEqual(left.stack)
    expect(back.moved).toBe("replace")
    expect(back.seededKey).toBeNull()
    const fleet = cockpitReducer(elsewhere, { type: "arrive", action: { type: "to-fleet" } })
    expect(fleet.scope).toEqual({ kind: "fleet" })
    expect(fleet.moved).toBe("replace")
  })

  it("an address of one engine's view opens it unseeded", () => {
    const view: CockpitView = { section: "jobs" }
    const state = cockpitReducer(booted(null), { type: "go", engineId: "prod-b", view })
    expect(state.scope).toEqual({ kind: "engine", engineId: "prod-b" })
    expect(state.stack).toEqual([view])
    expect(state.seededKey).toBeNull()
  })
})
