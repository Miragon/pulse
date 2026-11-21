// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import {
  createTestQueryClient,
  createViewQueryClient,
  TestViewHost,
  WebApiError,
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
 * and each section of the overview said it again, each with a Try again that cannot help. Where
 * the start data or the engine list names the profile refused, the state reads nothing: a refused
 * profile of another dialect is offered no feed at all, so a read answered an input error or no
 * such tool. The bounds of 3 s stay well below the 7 s a retried read would take.
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

const REASON = "auth.tokenEnv names a variable that is not set."
/** What the server answers for an engine whose profile it refused. */
const REFUSED_TEXT = `[ENGINE_PROFILE_REFUSED] Engine "locked" is configured, but its profile cannot be used: ${REASON} Ask whoever runs this server to fix it.`
const TITLE = "Engine locked cannot be used: its profile is refused"

/** What the server answers a feed for a refused profile it does not offer the feed for. */
const NOT_OFFERED = [
  [
    "an input error (another dialect's profile beside this one's engines)",
    'MCP error -32602: Input validation error: Invalid arguments for tool engine_health_data: [{"path":["engine"],"message":"Invalid option: expected one of \\"prod\\""}]',
  ],
  ["no such tool (a server of another dialect alone)", "Tool engine_health_data not found"],
] as const

const healthOf = (engine: unknown): EngineHealthData => ({
  status: "ok",
  statusRule: "ok without open incidents",
  summary: {
    totalIncidents: 0,
    lastHourIncidents: 0,
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
  refused: [{ id: "locked", environment: "default", reason: REASON }],
}
/** The list once the operator fixed the profile and the server started again. */
const FIXED_LIST = { engines: ENGINES, environments: [], defaultEngineId: "prod" }

/**
 * `fixed`: the server answers for locked and its list no longer names it refused (a test may flip
 * it). `failure`: what the server answers for locked instead of its refusal. `list`: the engine
 * list answers at once, only when the test lets it (`answerList`), or fails; `listAnswer` is what
 * it answers until the server is fixed.
 */
function renderCockpit({
  boot = BOOT,
  fixed = false,
  failure = REFUSED_TEXT,
  list = "answers",
  listAnswer = LIST,
}: {
  boot?: CockpitAppData
  fixed?: boolean
  failure?: string | Error
  list?: "answers" | "late" | "fails"
  listAnswer?: object
} = {}) {
  const server = { fixed }
  const actions: HostAction[] = []
  const modelContexts: string[] = []
  let answerList: () => void = () => undefined
  const listed = new Promise((resolve) => (answerList = () => resolve(listAnswer)))
  const answer =
    <T,>(of: (engine: unknown) => T) =>
    (args: Record<string, unknown>): T => {
      if (args.engine === "locked" && !server.fixed) {
        throw failure instanceof Error ? failure : new Error(failure)
      }
      return of(args.engine)
    }
  const tools = {
    [ENGINE_LIST_ENGINES]: () => {
      if (list === "fails") throw new Error("engine list unavailable (ECONNREFUSED)")
      if (server.fixed) return FIXED_LIST
      return list === "late" ? listed : listAnswer
    },
    [ENGINE_HEALTH_DATA]: answer(healthOf),
    [ENGINE_COCKPIT_OVERVIEW_DATA]: answer(overviewOf),
    [ENGINE_INCIDENTS_DATA]: answer(() => ({ incidents: [], total: 0 })),
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
  /** Every call that names the locked engine. */
  const readsOfLocked = () =>
    actions.filter((a) => a.type === "callTool" && a.args.engine === "locked").length
  return { reads, readsOfLocked, server, modelContexts, answerList: () => answerList() }
}

/** The landing has listed it: the list answered (prod its default). */
async function openLocked() {
  await screen.findByRole("button", { name: /^prod\b.*\bdefault\b/ }, SOON)
  fireEvent.click(await screen.findByRole("button", { name: /^locked\b/ }, SOON))
}

const sections = () => screen.queryByRole("navigation", { name: "Cockpit sections" })

/**
 * One card says why, as the page's one heading, its engine text under Details, with neither Try
 * again nor the chat, and a head without sections.
 */
async function expectOneRefusal(details = REFUSED_TEXT) {
  await waitFor(() => expect(screen.getAllByText(TITLE)).toHaveLength(1), SOON)
  expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual([TITLE])
  expect(screen.getByText(details).closest("details")).toBeTruthy()
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull()
  expect(screen.queryByRole("button", { name: "Find cause in chat" })).toBeNull()
  expect(sections()).toBeNull()
}

/** A start data that names locked refused, as `engine_open_cockpit` gives it. */
const REFUSED_BOOT: CockpitAppData = {
  engineId: null,
  engines: [ENGINES[0], { ...ENGINES[1], refused: { reason: REASON } }],
  start: null,
}

/**
 * A case renders widgets in happy-dom and waits for their queries: up to 0.2 s alone, up to 2.1 s
 * on the CI runner, where `pnpm test` runs every package's suite at once on four cores.
 */
const RENDER = { timeout: 15_000 }

describe("the cockpit on an engine whose profile the server refused", RENDER, () => {
  it("says why at once and once, without Try again or the chat, and retries no read", async () => {
    // The view's own client: TanStack's retries would hold the reason back for 7 s.
    client = createViewQueryClient()
    const { reads, modelContexts } = renderCockpit()
    await screen.findByRole("button", { name: /^locked\b.*refused$/ }, SOON)
    await openLocked()
    await expectOneRefusal()
    // The row's two reads before the list named it refused, once each; the view reads nothing.
    expect(reads(ENGINE_HEALTH_DATA)).toBe(1)
    expect(reads(ENGINE_COCKPIT_OVERVIEW_DATA)).toBe(1)
    // The model hears the refusal, and is offered no work on an engine every call fails on.
    await waitFor(() => expect(modelContexts.at(-1)).toContain("profileRefused=true"))
    expect(modelContexts.at(-1)).toContain('Ids: engine="locked"')
    expect(modelContexts.at(-1)).not.toContain("Offer analysis")
  })

  it.each(NOT_OFFERED)(
    "says its own reason and reads nothing where the server answers %s",
    async (_case, answer) => {
      client = createViewQueryClient()
      const { readsOfLocked, modelContexts } = renderCockpit({
        boot: REFUSED_BOOT,
        failure: answer,
      })
      await openLocked()
      await expectOneRefusal()
      expect(screen.queryByText(answer)).toBeNull()
      // Neither its landing row nor its view read anything of it.
      expect(readsOfLocked()).toBe(0)
      await waitFor(() => expect(modelContexts.at(-1)).toContain("profileRefused=true"))
    },
  )

  it("says so from the start data before the engine list answers, reading nothing", async () => {
    const { readsOfLocked, answerList } = renderCockpit({
      boot: REFUSED_BOOT,
      list: "late",
      failure: NOT_OFFERED[0][1],
    })
    fireEvent.click(await screen.findByRole("button", { name: /^locked\b/ }, SOON))
    await expectOneRefusal()
    answerList()
    await screen.findByRole("button", { name: "Refresh" })
    expect(screen.getAllByText(TITLE)).toHaveLength(1)
    expect(readsOfLocked()).toBe(0)
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

  it("says so once where a section meets the refusal after the list answered without it", async () => {
    client = createViewQueryClient()
    // The server started again with a profile it refuses after its list named the engine usable.
    const { reads, answerList } = renderCockpit({ list: "late", listAnswer: FIXED_LIST })
    const status = (key: unknown[]) => client.getQueryState(key)?.status
    await waitFor(
      () => expect(status(["engine:health", "locked", { engine: "locked" }])).toBe("error"),
      SOON,
    )
    answerList()
    await waitFor(() => expect(status(["engine:engines", {}])).toBe("success"))
    // The list answered after the row's read, so the view mounts and its sections read again.
    fireEvent.click(screen.getByRole("button", { name: /^locked\b/ }))
    await expectOneRefusal()
    expect(reads(ENGINE_HEALTH_DATA)).toBe(2)
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

  it("names the engine in its trail, where the sections would be, on every route of it", async () => {
    const { reads } = renderCockpit()
    await openLocked()
    await expectOneRefusal()
    const trail = screen.getByRole("navigation", { name: "Breadcrumb" })
    expect(within(trail).getByText("locked")).toBeTruthy()
    expect(within(trail).getByRole("button", { name: "All engines" })).toBeTruthy()
    expect(reads(ENGINE_INCIDENTS_DATA)).toBe(0)
  })

  it("offers Try again where a retry can help: its read failed for another reason", async () => {
    // The list has not answered yet: nothing names the profile refused.
    const { reads } = renderCockpit({
      failure: "engine locked unreachable (ECONNREFUSED)",
      list: "late",
    })
    fireEvent.click(await screen.findByRole("button", { name: /^locked\b/ }, SOON))
    fireEvent.click((await screen.findAllByRole("button", { name: "Try again" }, SOON))[0])
    await waitFor(() => expect(reads(ENGINE_HEALTH_DATA)).toBeGreaterThan(1))
    expect(screen.queryByText(TITLE)).toBeNull()
    expect(sections()).not.toBeNull()
  })

  it("is never the gate of a page whose session ended: that refusal is the page's, not the engine's", async () => {
    client = createViewQueryClient()
    const ended = new WebApiError(401, { code: "signed_out", message: "No session." })
    const { reads, modelContexts } = renderCockpit({ failure: ended, list: "late" })
    fireEvent.click(await screen.findByRole("button", { name: /^locked\b/ }, SOON))
    // A refusal no retry changes all the same: no Try again, no retry. The page's frame says the
    // session ended, so the overview's sections only say they are not loaded.
    await screen.findAllByText("This content couldn't be loaded", undefined, SOON)
    expect(screen.queryByText("You're signed out")).toBeNull()
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull()
    expect(screen.queryByText(TITLE)).toBeNull()
    expect(modelContexts.at(-1)).not.toContain("profileRefused=true")
    // The row's read and the overview's own as it mounts, never a retry.
    expect(reads(ENGINE_HEALTH_DATA)).toBeLessThanOrEqual(2)
  })

  it("reads it again on the cockpit's Refresh, and gives the view back once it answers", async () => {
    const { reads, server } = renderCockpit()
    await openLocked()
    await expectOneRefusal()
    // The row's read met the refusal; the view read nothing of its own.
    expect(reads(ENGINE_HEALTH_DATA)).toBe(1)
    // The operator fixed the profile and started the server again; the met refusal stays until the
    // user refreshes, and the list that answers then no longer names it refused.
    server.fixed = true
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
    expect(await screen.findByText("locked · Overview", undefined, SOON)).toBeTruthy()
    expect(screen.queryByText(TITLE)).toBeNull()
    expect(reads(ENGINE_HEALTH_DATA)).toBeGreaterThanOrEqual(2)
  })

  it("gives the view back once the cockpit's Refresh finds the profile no longer refused", async () => {
    const { readsOfLocked, server } = renderCockpit({ boot: REFUSED_BOOT })
    await openLocked()
    await expectOneRefusal()
    expect(readsOfLocked()).toBe(0)
    // The operator fixed the profile and started the server again; the view keeps the refusal
    // until the user refreshes.
    server.fixed = true
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
    expect(await screen.findByText("locked · Overview", undefined, SOON)).toBeTruthy()
    expect(screen.queryByText(TITLE)).toBeNull()
    expect(sections()).not.toBeNull()
    expect(readsOfLocked()).toBeGreaterThan(0)
  })
})
