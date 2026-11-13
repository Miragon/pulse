// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import {
  createTestQueryClient,
  createViewQueryClient,
  TestViewHost,
  type HostAction,
  type QueryClient,
} from "@miragon/pulse-widget-shell/widgets"
import type { CockpitAppData, EngineHealthData } from "../../view-models.js"
import {
  ENGINE_COCKPIT_OVERVIEW_DATA,
  ENGINE_HEALTH_DATA,
  ENGINE_INCIDENTS_DATA,
  ENGINE_LIST_ENGINES,
} from "../../tool-names.js"
import { CockpitApp } from "./app.js"

/**
 * F1: an engine whose profile the server refused is its view's ONE state, said at once. The
 * server refuses at once and keeps refusing, so a retry only held the reason back (1 + 2 + 4 s),
 * and each section of the overview said it again, each with a Try again that cannot help. The
 * bounds of 3 s stay well below the 7 s a retried read would take.
 */

let client: QueryClient = createTestQueryClient()

afterEach(() => {
  cleanup()
  client.clear()
  client = createTestQueryClient()
})

const ENGINES = [
  { id: "prod", environment: "default" },
  { id: "locked", environment: "default" },
]
const BOOT: CockpitAppData = { engineId: null, engines: ENGINES, start: null }
/** Stable: the test host memoizes on it. Fullscreen shows the head's sections. */
const FULLSCREEN = { displayMode: "fullscreen" } as const
const SOON = { timeout: 3_000 }

/** What the server answers for an engine whose profile it refused. */
const REFUSED_TEXT =
  '[ENGINE_PROFILE_REFUSED] Engine "locked" is configured, but its profile cannot be used: auth.tokenEnv names a variable that is not set. Ask whoever runs this server to fix it.'
const TITLE = "Engine locked cannot be used: its profile is refused"

const healthOf = (engine: unknown): EngineHealthData => ({
  status: "ok",
  statusRule: "ok without open incidents",
  summary: {
    totalIncidents: 0,
    lastHourIncidents: 0,
    last24hIncidents: 0,
    affectedActivities: 0,
    affectedDefinitions: 0,
    runningInstances: 3,
    totalDefinitions: 1,
    started24h: null,
    completed24h: null,
  },
  clusters: [],
  fetchedAt: "2026-06-11T14:05:00.000Z",
  engineId: String(engine),
})

const overviewOf = (engine: unknown) => ({
  summary: { totalDefinitions: 0, totalRunningInstances: 0, totalFailedJobs: 0, totalIncidents: 0 },
  definitions: [],
  engineId: engine,
})

const LIST = {
  engines: [ENGINES[0]],
  environments: [],
  defaultEngineId: "prod",
  refused: [{ id: "locked", environment: "default", reason: "auth.tokenEnv is missing." }],
}

/**
 * `fixed`: the list still names locked refused, but the server answers for it (a test may flip
 * it). `failure`: what the server answers for locked instead of its refusal. `list`: the engine
 * list answers at once, only when the test lets it (`answerList`), or fails.
 */
function renderCockpit({
  boot = BOOT,
  fixed = false,
  failure = REFUSED_TEXT,
  list = "answers",
}: {
  boot?: CockpitAppData
  fixed?: boolean
  failure?: string
  list?: "answers" | "late" | "fails"
} = {}) {
  const server = { fixed }
  const actions: HostAction[] = []
  const modelContexts: string[] = []
  let answerList: () => void = () => undefined
  const listed = new Promise((resolve) => (answerList = () => resolve(LIST)))
  const answer =
    <T,>(of: (engine: unknown) => T) =>
    (args: Record<string, unknown>): T => {
      if (args.engine === "locked" && !server.fixed) throw new Error(failure)
      return of(args.engine)
    }
  const tools = {
    [ENGINE_LIST_ENGINES]: () => {
      if (list === "fails") throw new Error("engine list unavailable (ECONNREFUSED)")
      return list === "late" ? listed : LIST
    },
    [ENGINE_HEALTH_DATA]: answer(healthOf),
    [ENGINE_COCKPIT_OVERVIEW_DATA]: answer(overviewOf),
  }
  render(
    <TestViewHost
      tools={tools}
      client={client}
      host={FULLSCREEN}
      onHostAction={(action) => actions.push(action)}
      onModelContext={(text) => modelContexts.push(text)}
    >
      <CockpitApp data={boot} />
    </TestViewHost>,
  )
  /** The calls of `feed` for the locked engine. */
  const reads = (feed: string) =>
    actions.filter((a) => a.type === "callTool" && a.name === feed && a.args.engine === "locked")
      .length
  return { reads, server, modelContexts, answerList: () => answerList() }
}

/** The landing has listed it: the list answered (prod its default), the row read its refusal. */
async function openLocked() {
  await screen.findByRole("button", { name: /^prod\b.*\bdefault\b/ }, SOON)
  fireEvent.click(await screen.findByRole("button", { name: /^locked\b/ }, SOON))
}

const headSection = (name: string) =>
  within(screen.getByRole("navigation", { name: "Cockpit sections" })).getByRole("button", {
    name,
  })

/** One card says why, its engine text under Details, with neither Try again nor the chat. */
async function expectOneRefusal() {
  await waitFor(() => expect(screen.getAllByText(TITLE)).toHaveLength(1), SOON)
  expect(screen.getByText(REFUSED_TEXT).closest("details")).toBeTruthy()
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull()
  expect(screen.queryByRole("button", { name: "Find cause in chat" })).toBeNull()
}

describe("the cockpit on an engine whose profile the server refused", () => {
  it("says why at once and once, without Try again or the chat, and retries no read", async () => {
    // The view's own client: TanStack's retries would hold the reason back for 7 s.
    client = createViewQueryClient()
    const { reads, modelContexts } = renderCockpit()
    await screen.findByRole("button", { name: /^locked\b.*refused$/ }, SOON)
    await openLocked()
    await expectOneRefusal()
    // The row's two reads, once each; the view mounts none of its sections.
    expect(reads(ENGINE_HEALTH_DATA)).toBe(1)
    expect(reads(ENGINE_COCKPIT_OVERVIEW_DATA)).toBe(1)
    // The model hears the refusal, and is offered no work on an engine every call fails on.
    await waitFor(() => expect(modelContexts.at(-1)).toContain("profileRefused=true"))
    expect(modelContexts.at(-1)).toContain('Ids: engine="locked"')
    expect(modelContexts.at(-1)).not.toContain("Offer analysis")
  })

  it("says so once before the engine list answers, from the read the row already met", async () => {
    client = createViewQueryClient()
    const { reads, answerList } = renderCockpit({ list: "late" })
    // The rows come from the start data; the row's health read meets the refusal.
    const status = (key: unknown[]) => client.getQueryState(key)?.status
    await waitFor(
      () => expect(status(["engine:health", "locked", { engine: "locked" }])).toBe("error"),
      SOON,
    )
    expect(status(["engine:engines", {}])).toBe("pending")
    fireEvent.click(screen.getByRole("button", { name: /^locked\b/ }))
    await expectOneRefusal()
    answerList()
    await waitFor(() => expect(status(["engine:engines", {}])).toBe("success"))
    expect(screen.getAllByText(TITLE)).toHaveLength(1)
    expect(reads(ENGINE_HEALTH_DATA)).toBe(1)
    expect(reads(ENGINE_COCKPIT_OVERVIEW_DATA)).toBe(1)
  })

  it("says so once on its only engine, whose sections met the refusal while the list failed", async () => {
    client = createViewQueryClient()
    // The one profile, refused: the cockpit opens it without a click, before any list.
    const { reads } = renderCockpit({
      boot: { engineId: null, engines: [ENGINES[1]], start: null },
      list: "fails",
    })
    await expectOneRefusal()
    expect(reads(ENGINE_HEALTH_DATA)).toBe(1)
    expect(reads(ENGINE_COCKPIT_OVERVIEW_DATA)).toBe(1)
  })

  it("is the one state of every route of it: Incidents reads nothing either", async () => {
    const { reads } = renderCockpit()
    await openLocked()
    await screen.findByText(TITLE)
    fireEvent.click(headSection("Incidents"))
    await waitFor(() => expect(headSection("Incidents").getAttribute("aria-current")).toBe("page"))
    expect(screen.getAllByText(TITLE)).toHaveLength(1)
    expect(reads(ENGINE_INCIDENTS_DATA)).toBe(0)
  })

  it("offers Try again where a retry can help: its read failed for another reason", async () => {
    const { reads } = renderCockpit({ failure: "engine locked unreachable (ECONNREFUSED)" })
    await openLocked()
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }))
    await waitFor(() => expect(reads(ENGINE_HEALTH_DATA)).toBe(2))
    expect(screen.queryByText(TITLE)).toBeNull()
  })

  it("gives an engine that answers its view back, though the list still names it refused", async () => {
    renderCockpit({ fixed: true })
    await openLocked()
    expect(await screen.findByText("locked · Overview")).toBeTruthy()
    expect(screen.queryByText(TITLE)).toBeNull()
  })

  it("reads it again on the cockpit's Refresh, and gives the view back once it answers", async () => {
    const { reads, server } = renderCockpit()
    await openLocked()
    await expectOneRefusal()
    // The operator fixed the profile; the cached refusal stays until the user refreshes.
    server.fixed = true
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
    expect(await screen.findByText("locked · Overview", undefined, SOON)).toBeTruthy()
    expect(screen.queryByText(TITLE)).toBeNull()
    expect(reads(ENGINE_HEALTH_DATA)).toBeGreaterThanOrEqual(2)
  })
})
