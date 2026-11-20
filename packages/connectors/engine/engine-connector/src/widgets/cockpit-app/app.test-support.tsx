import { act, fireEvent, render, screen, within } from "@testing-library/react"
import {
  TestViewHost,
  type createTestQueryClient,
  type HostAction,
  type HostChrome,
  type ViewLocation,
  type ViewPlace,
} from "@miragon/pulse-widget-shell/widgets"
import type {
  CockpitAppData,
  CockpitEngineInfo,
  CockpitStart,
  CockpitView,
  EngineHealthData,
  JobPanelData,
} from "../../view-models.js"
import {
  ENGINE_BOARD_DATA,
  ENGINE_BPMN_XML_DATA,
  ENGINE_COCKPIT_OVERVIEW_DATA,
  ENGINE_HEALTH_DATA,
  ENGINE_JOB_BACKLOG_DATA,
  ENGINE_JOBS_DATA,
  ENGINE_LIST_ENGINES,
} from "../../tool-names.js"
import { BOARD } from "../board/board.test-support.js"
import { CockpitApp } from "./app.js"

export const ENGINES = [
  { id: "prod-a", environment: "default" },
  { id: "prod-b", environment: "default" },
]

/**
 * A bootstrap as `engine_open_cockpit` returns it. Without a start view, or with a start whose
 * data the test leaves out, the routes fetch.
 */
export function boot(
  engineId: string | null,
  engines: CockpitAppData["engines"],
  view: CockpitView | null = null,
  data: CockpitStart["data"] | null = null,
): CockpitAppData {
  return { engineId, engines, start: view ? ({ view, data } as CockpitStart) : null }
}

/** Stable objects: the test host memoizes on them. Fullscreen shows the head and the trail apart. */
export const FULLSCREEN = { displayMode: "fullscreen" } as const
export const INLINE = { displayMode: "inline" } as const
export type HostMode = typeof FULLSCREEN | typeof INLINE

/** Why the server refused the profile of the engine `locked`, in its words. */
export const REFUSED_REASON = "auth.tokenEnv names a variable that is not set."
/** What the server answers for an engine whose profile it refused. */
const REFUSED_TEXT = `[ENGINE_PROFILE_REFUSED] Engine "locked" is configured, but its profile cannot be used: ${REFUSED_REASON} Ask whoever runs this server to fix it.`

export const JOBS_DATA: JobPanelData = {
  totalCount: 0,
  allCount: 0,
  failedCount: 0,
  fetchedAt: "2026-10-26T08:00:00.000Z",
  jobs: [],
  filters: {},
  engineId: "prod-a",
}

/**
 * What `engine_list_engines` names: `refused` are the profiles the server refused, `boards` and
 * `refusedBoards` those of ENGINE_BOARDS_DIR. Mutable, so a test can reload it.
 */
export interface EngineList {
  engines: CockpitAppData["engines"]
  refused?: Array<{ id: string; environment?: string; reason: string }>
  boards?: Array<{ id: string; title: string; engines: string[] }>
  refusedBoards?: Array<{ id: string; problems: number }>
  /** The process keys each engine's overview lists; none where the test names none. */
  deployed?: Record<string, string[]>
  /** Holds the jobs feed's answer until it settles: a refresh the test watches go on. */
  hold?: Promise<void>
}

/** An engine's health as its feed answers: ok, no incident. */
export function healthOf(args: Record<string, unknown>): EngineHealthData {
  return {
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
    engineId: String(args.engine),
  }
}

/** An engine's overview as its feed answers, listing the process keys `deployed` names for it. */
export function overviewOf(args: Record<string, unknown>, deployed: Record<string, string[]> = {}) {
  const keys = deployed[String(args.engine)] ?? []
  return {
    summary: {
      totalDefinitions: keys.length,
      totalRunningInstances: 0,
      totalFailedJobs: 0,
      totalIncidents: 0,
    },
    definitions: keys.map((key) => ({
      id: `${key}:1:d`,
      key,
      name: null,
      latestVersion: 1,
      instances: 0,
      failedJobs: 0,
      incidents: [],
    })),
    engineId: String(args.engine),
  }
}

/** The feeds the cockpit reads, over `list`; a refused profile's reads fail as the server's do. */
function cockpitTools(list: EngineList) {
  const refusedEngine = (args: Record<string, unknown>) => {
    if (list.refused?.some(({ id }) => id === args.engine)) throw new Error(REFUSED_TEXT)
  }
  return {
    [ENGINE_LIST_ENGINES]: () => ({
      engines: list.engines,
      environments: [],
      defaultEngineId: "prod-b",
      ...(list.refused ? { refused: list.refused } : {}),
      ...(list.boards ? { boards: list.boards } : {}),
      ...(list.refusedBoards ? { refusedBoards: list.refusedBoards } : {}),
    }),
    [ENGINE_COCKPIT_OVERVIEW_DATA]: (args: Record<string, unknown>) => {
      refusedEngine(args)
      return overviewOf(args, list.deployed)
    },
    [ENGINE_HEALTH_DATA]: (args: Record<string, unknown>): EngineHealthData => {
      refusedEngine(args)
      return healthOf(args)
    },
    [ENGINE_JOBS_DATA]: async () => {
      await list.hold
      return JOBS_DATA
    },
    [ENGINE_BOARD_DATA]: () => BOARD,
    [ENGINE_BPMN_XML_DATA]: (args: Record<string, unknown>) => ({
      processDefinitionId: args.processDefinitionId,
      bpmnXml: null,
    }),
    [ENGINE_JOB_BACKLOG_DATA]: (args: Record<string, unknown>) => ({
      executableJobs: 0,
      suspendedJobs: 0,
      jobsDueLater: 0,
      externalTasks: 0,
      engineId: String(args.engine),
    }),
  }
}

/**
 * A page outside a chat (the web app): its start page, which its bar leads to, its address, which
 * follows the cockpit where the test hands one, and its chrome, where it navigates itself.
 */
export interface PageHost {
  startPage: string
  location?: ViewLocation
  chrome?: HostChrome
}

/** The cockpit under the test host, on `client`, whose cache the test reads and pokes. */
export function renderCockpitOn(
  client: ReturnType<typeof createTestQueryClient>,
  bootstrap: CockpitAppData = boot(null, ENGINES),
  list: EngineList = { engines: ENGINES },
  displayMode: HostMode = FULLSCREEN,
  page?: PageHost,
) {
  const modelContexts: string[] = []
  const actions: HostAction[] = []
  const tools = cockpitTools(list)
  const host = (data: CockpitAppData) => (
    <TestViewHost
      tools={tools}
      onModelContext={(text) => modelContexts.push(text)}
      onHostAction={(action) => actions.push(action)}
      client={client}
      host={displayMode}
      startPage={page?.startPage}
      location={page?.location}
      chrome={page?.chrome}
    >
      <CockpitApp data={data} />
    </TestViewHost>
  )
  const { rerender } = render(host(bootstrap))
  /** The host delivers another tool result to the same view. */
  const redeliver = (data: CockpitAppData) => rerender(host(data))
  const reads = (feed: string) =>
    actions.flatMap((a) => (a.type === "callTool" && a.name === feed ? [a.args] : []))
  return { modelContexts, redeliver, reads }
}

export const activeEngine = () =>
  screen.queryByLabelText<HTMLSelectElement>("Selected engine")?.value ?? null

export const onLanding = () =>
  screen.queryByRole("heading", { level: 1, name: "Operations Cockpit" }) !== null

export const headSection = (name: string) =>
  within(screen.getByRole("navigation", { name: "Cockpit sections" })).getByRole("button", {
    name,
  })

export const trailLabels = () =>
  Array.from(
    screen
      .getByRole("navigation", { name: "Breadcrumb" })
      .querySelectorAll("button, [aria-current='page']"),
  )
    .map((el) => el.textContent)
    .filter((text): text is string => !!text)

/**
 * A page's address as the web app keeps it: every report, and Back to an entry; `claims` the
 * places the page shows itself.
 */
export function fakeAddress(start?: ViewPlace, claims?: ViewLocation["claims"]) {
  const reports: Array<{ place: ViewPlace; entry: "push" | "replace" }> = []
  let follower: ((place: ViewPlace) => boolean) | undefined
  const location: ViewLocation = {
    ...(start === undefined ? {} : { start }),
    ...(claims === undefined ? {} : { claims }),
    report: (place, entry) => reports.push({ place, entry }),
    subscribe: (go) => {
      follower = go
      return () => {
        follower = undefined
      }
    },
  }
  const back = (place: ViewPlace): boolean => {
    let followed = false
    act(() => {
      followed = follower?.(place) ?? false
    })
    return followed
  }
  return { location, reports, back }
}

export type Report = ReturnType<typeof fakeAddress>["reports"][number]

/** The browser's history the reports make: a push adds an entry, a replace names the last anew. */
export function historyOf(reports: readonly Report[]): Array<Readonly<Record<string, unknown>>> {
  return reports.reduce<Array<Readonly<Record<string, unknown>>>>(
    (entries, { place, entry }) =>
      entry === "push" ? [...entries, place.args] : [...entries.slice(0, -1), place.args],
    [],
  )
}

/** An engine the server reads on boards only (Camunda 8), as the start data and the list name it. */
export const ON_BOARDS: CockpitEngineInfo = {
  id: "orders-c8",
  environment: "default",
  dialect: "c8",
}
export const BOARDS_ONLY_TITLE = "orders-c8 is a Camunda 8 engine"
/** An engine whose profile the server refused, as the start data names it. */
export const REFUSED: CockpitEngineInfo = {
  id: "locked",
  environment: "default",
  refused: { reason: REFUSED_REASON },
}
export const REFUSED_TITLE = "Engine locked cannot be used: its profile is refused"

export const selectEngine = (id: string) =>
  fireEvent.change(screen.getByLabelText("Selected engine"), { target: { value: id } })
export const jobScopes = () => screen.getByRole("radiogroup", { name: "Show jobs" })

export const trailRow = () => document.querySelector<HTMLElement>("[data-slot='cockpit-trail']")
/** The trail on its row: a page's drill also renders the head's copy for a narrow cockpit. */
export const rowLabels = () =>
  Array.from(
    trailRow()?.querySelectorAll("button, [aria-current='page']") ?? [],
    (el) => el.textContent,
  )
export const PROCESS: Extract<CockpitView, { section: "process-detail" }> = {
  section: "process-detail",
  processDefinitionKey: "invoice",
}
