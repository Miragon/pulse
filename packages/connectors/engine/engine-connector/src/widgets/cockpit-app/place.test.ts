import { describe, expect, it } from "vitest"
import { COCKPIT_ROUTES } from "../../data/routes.js"
import type { CockpitView } from "../../view-models.js"
import type { CockpitState } from "./cockpit-state.js"
import { actionOfPlace, FLEET_PLACE, placeArgsOf, placeKey } from "./place.js"

function engineState(...stack: CockpitView[]): CockpitState {
  return {
    scope: { kind: "engine", engineId: "prod-a" },
    stack,
    goneEngineId: null,
    processGone: null,
    seededKey: null,
    fromBoard: null,
    moved: "push",
    checkProcesses: false,
  }
}

/** One view of each route of one engine, every id it takes set. */
const VIEWS: CockpitView[] = [
  { section: "overview" },
  { section: "incidents" },
  {
    section: "cluster-detail",
    activityId: "a",
    incidentType: "failedJob",
    messageSignature: "sig",
    label: "A",
  },
  { section: "process-detail", processDefinitionKey: "invoice", focus: "incidents", label: "I" },
  { section: "process-instances", processDefinitionKey: "invoice" },
  { section: "instance-detail", processInstanceId: "pi-1", label: "INV-1" },
  { section: "incident-detail", incidentId: "inc-1", label: "Check" },
  { section: "jobs", processDefinitionKey: "invoice", failedOnly: true },
  { section: "history", processInstanceId: "pi-1" },
]

describe("the cockpit's place, as engine_open_cockpit's arguments (N1)", () => {
  it.each(VIEWS)("%o names its route, the engine and exactly the ids the route takes", (view) => {
    const args = placeArgsOf(engineState({ section: "overview" }, view), false)
    const route = COCKPIT_ROUTES[view.section]
    const { view: section, engine, ...ids } = args
    expect(section).toBe(view.section)
    expect(engine).toBe("prod-a")
    // Never the crumb's label: the tool takes no such argument.
    const allowed: readonly string[] = [...route.needs, ...route.takes]
    expect(Object.keys(ids).every((id) => allowed.includes(id))).toBe(true)
    expect(route.needs.every((id) => id in ids)).toBe(true)
  })

  it("names the chooser, a board and the cross-engine overview as the web app's pages read them", () => {
    const base = engineState({ section: "overview" })
    expect(placeArgsOf({ ...base, scope: { kind: "landing" } }, false)).toEqual({ view: "landing" })
    expect(placeArgsOf({ ...base, scope: { kind: "fleet" } }, false)).toEqual({ view: FLEET_PLACE })
    const board = { section: "board", board: "ops", label: "Operations" } as const
    expect(placeArgsOf({ ...base, scope: { kind: "board", view: board } }, false)).toEqual({
      view: "board",
      board: "ops",
    })
  })

  it("names an engine without sections by its id alone, which opens the picker for it", () => {
    expect(placeArgsOf(engineState({ section: "overview" }), true)).toEqual({ engine: "prod-a" })
  })

  it("keys a place whatever the order of its arguments and whether the address typed them", () => {
    expect(placeKey({ view: "jobs", engine: "a", failedOnly: true })).toBe(
      placeKey({ failedOnly: "true", engine: "a", view: "jobs" }),
    )
    expect(placeKey({ view: "jobs", engine: "a" })).not.toBe(
      placeKey({ view: "jobs", engine: "b" }),
    )
  })
})

describe("where Back and Forward lead the cockpit", () => {
  const state = engineState(
    { section: "overview" },
    { section: "process-detail", processDefinitionKey: "invoice", label: "Invoice" },
  )
  const args = placeArgsOf(state, false)
  const memo = {
    place: placeKey(args),
    cockpit: { scope: state.scope, stack: state.stack, fromBoard: null },
  }

  it("back as the entry kept it, its trail and names included", () => {
    expect(actionOfPlace({ args, memo })).toEqual({ type: "restore", memo: memo.cockpit })
  })

  it("to the place itself where the memo names another place or is no cockpit's", () => {
    const other = { ...memo, place: placeKey({ view: "overview", engine: "prod-a" }) }
    const go = {
      type: "go",
      engineId: "prod-a",
      view: { section: "process-detail", processDefinitionKey: "invoice" },
    }
    expect(actionOfPlace({ args, memo: other })).toEqual(go)
    for (const broken of [
      "text",
      { place: memo.place },
      { place: memo.place, cockpit: { scope: { kind: "elsewhere" }, stack: [], fromBoard: null } },
      {
        place: memo.place,
        cockpit: { scope: state.scope, stack: [{ section: "nope" }], fromBoard: null },
      },
      { place: memo.place, cockpit: { scope: state.scope, stack: state.stack, fromBoard: "x" } },
    ]) {
      expect(actionOfPlace({ args, memo: broken })).toEqual(go)
    }
  })

  it.each<[Record<string, unknown>, unknown]>([
    [{ view: "landing" }, { type: "to-landing" }],
    [{}, { type: "to-landing" }],
    [{ view: FLEET_PLACE }, { type: "to-fleet" }],
    [
      { view: "board", board: "ops" },
      { type: "open-board", view: { section: "board", board: "ops" } },
    ],
    [{ engine: "prod-b" }, { type: "go", engineId: "prod-b", view: null }],
    [
      { view: "jobs", engine: "prod-b", failedOnly: true },
      { type: "go", engineId: "prod-b", view: { section: "jobs", failedOnly: true } },
    ],
  ])("%o", (place, action) => {
    expect(actionOfPlace({ args: place })).toEqual(action)
  })

  it.each<Record<string, unknown>>([
    { view: "board" },
    { view: "jobs" },
    { view: "jobs", engine: "" },
    { view: "nowhere", engine: "prod-a" },
    { view: "landing-not", engine: "prod-a" },
  ])("%o is no place the cockpit goes to itself: the page loads it anew", (place) => {
    expect(actionOfPlace({ args: place })).toBeNull()
  })
})
