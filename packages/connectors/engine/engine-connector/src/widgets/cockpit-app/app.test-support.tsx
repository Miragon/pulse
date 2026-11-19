import { render, screen, within } from "@testing-library/react"
import {
  TestViewHost,
  type createTestQueryClient,
  type HostAction,
} from "@miragon/pulse-widget-shell/widgets"
import type {
  CockpitAppData,
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
const FULLSCREEN = { displayMode: "fullscreen" } as const
export const INLINE = { displayMode: "inline" } as const
export type HostMode = typeof FULLSCREEN | typeof INLINE

/** What the server answers for an engine whose profile it refused. */
const REFUSED_TEXT =
  '[ENGINE_PROFILE_REFUSED] Engine "locked" is configured, but its profile cannot be used: auth.tokenEnv names a variable that is not set. Ask whoever runs this server to fix it.'

export const JOBS_DATA: JobPanelData = {
  totalCount: 0,
  failedCount: 0,
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
}

function healthOf(args: Record<string, unknown>): EngineHealthData {
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

function overviewOf(args: Record<string, unknown>) {
  return {
    summary: {
      totalDefinitions: 0,
      totalRunningInstances: 0,
      totalFailedJobs: 0,
      totalIncidents: 0,
    },
    definitions: [],
    engineId: args.engine,
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
      return overviewOf(args)
    },
    [ENGINE_HEALTH_DATA]: (args: Record<string, unknown>): EngineHealthData => {
      refusedEngine(args)
      return healthOf(args)
    },
    [ENGINE_JOBS_DATA]: () => JOBS_DATA,
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

/** The cockpit under the test host, on `client`, whose cache the test reads and pokes. */
export function renderCockpitOn(
  client: ReturnType<typeof createTestQueryClient>,
  bootstrap: CockpitAppData = boot(null, ENGINES),
  list: EngineList = { engines: ENGINES },
  displayMode: HostMode = FULLSCREEN,
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
