import { z } from "zod"
import {
  buildViewResult,
  showToolBinding,
  strictToolInput,
  withToolErrors,
} from "@miragon/pulse-widget-shell/server"
import type {
  CockpitAppData,
  CockpitEngineInfo,
  CockpitSection,
  CockpitView,
  EngineDialect,
} from "../view-models.js"
import { ROUTE_DIALECTS } from "../view-models.dialects.js"
import { BOARD_ID } from "../board-files.js"
import { buildCockpitStart, cockpitFacts, isAppView } from "../data/cockpit-start.js"
import { COCKPIT_ROUTES, type StartParam } from "../data/routes.js"
import { ENGINE_OPEN_COCKPIT } from "../tool-names.js"
import { webAppUrlOf } from "../lib/engine/cockpit-url.js"
import {
  type EngineBackend,
  type EngineRegistry,
  resolveEngine,
} from "../lib/engine/resolve-engine.js"
import {
  cockpitEngineId,
  engineServing,
  offeredEngineIds,
  servedEngineIds,
} from "../lib/engine/served-engines.js"
import { type EngineParamShape, engineParamShapeFor } from "../lib/engine/with-engine.js"
import { environmentOf } from "../lib/shared/environments.js"
import { namedReads, type WidgetToolsContext } from "./shared.js"

/** The `view` enum: the routes in their descriptor's order (`data/routes.ts`). */
const START_VIEWS = Object.keys(COCKPIT_ROUTES) as [CockpitSection, ...CockpitSection[]]

/**
 * One field per `StartParam` (the view models' ids, `data/routes.ts`), checked by `satisfies`.
 * Each description names the routes that take the param: a route that takes one adds its name
 * there (the tools/list golden shows the change).
 */
const startViewShape = {
  view: z.enum(START_VIEWS).optional(),
  processDefinitionKey: z
    .string()
    .optional()
    .describe("process-detail (required), process-instances, jobs."),
  focus: z
    .enum(["incidents"])
    .optional()
    .describe("process-detail: focus on its incidents; if none, list processes that have some."),
  activityId: z.string().optional().describe("cluster-detail (required): the failing activity id."),
  incidentType: z.string().optional().describe("cluster-detail (required)."),
  messageSignature: z
    .string()
    .optional()
    .describe(
      "cluster-detail: a failure message signature (the overview's topCluster); omitted: all.",
    ),
  processInstanceId: z.string().optional().describe("instance-detail, history (required)."),
  incidentId: z.string().optional().describe("incident-detail (required)."),
  failedOnly: z.boolean().optional().describe("jobs: only jobs without retries."),
  board: z
    .string()
    .regex(BOARD_ID)
    .optional()
    .describe("board (required): its id, as engine_list_engines lists the boards."),
} satisfies Record<StartParam | "view", z.ZodType>

type StartIds = Partial<z.output<z.ZodObject<typeof startViewShape>>>

const START_PARAMS = Object.keys(startViewShape).filter((key): key is StartParam => key !== "view")

const given = (value: unknown) => value !== undefined && value !== ""

const acceptedBy = (view: CockpitSection): readonly StartParam[] => [
  ...COCKPIT_ROUTES[view].needs,
  ...COCKPIT_ROUTES[view].takes,
]

/** Where a configured engine serves an engine's route: what the cockpit says and opens. */
const ENGINE_ROUTES_DESCRIPTION =
  "Show the user the operations cockpit on one engine; they navigate it without further tool calls. `view` picks where it opens, by default the overview: the health verdict from the open incidents, the top failure clusters and every process. instance-detail needs a running instance; history shows ended ones too; board shows a board across the engines it names, landing the engines and boards to pick from, both without `engine`. You get that view's facts as compact JSON."

/** Where no configured engine is served by an engine's route (Camunda 8 alone): its app routes. */
const APP_ROUTES_DESCRIPTION =
  "Show the user the operations cockpit; they navigate it without further tool calls. `view` picks where it opens: board shows a board across the engines it names, landing (the default) the engines and boards to pick from. You get that view's facts as compact JSON."

/** The routes a configured engine speaks a dialect of, in their descriptor's order. */
function servedViews(registry: EngineRegistry): CockpitSection[] {
  return START_VIEWS.filter(
    (view) => servedEngineIds(registry, { dialects: ROUTE_DIALECTS[view] }).length > 0,
  )
}

/** The union of the marks of `views`. */
function dialectsOf(views: readonly CockpitSection[]): EngineDialect[] {
  return [...new Set(views.flatMap((view) => ROUTE_DIALECTS[view]))]
}

/** The union of the marks of the served routes of one engine. */
function engineRouteDialects(views: readonly CockpitSection[]): EngineDialect[] {
  return dialectsOf(views.filter((view) => COCKPIT_ROUTES[view].scope === "engine"))
}

/**
 * The input of the served routes: `view` names only those, an id only where one of them takes it.
 * Where a route of one engine is served, `engine` names every engine the cockpit shows, of the
 * dialects its served routes read: a route of one engine refuses an engine its mark does not serve
 * (ENGINE_DIALECT_NOT_SERVED), which a page and the chat show as a view of an engine shown on
 * boards only, never as arguments the tool does not take; without a view the picker opens. Without
 * such a route (Camunda 8 alone) it takes no `engine`. Every field is optional, so the handler's
 * types are the whole shape's, `engine` included.
 */
function cockpitInput(registry: EngineRegistry, views: readonly CockpitSection[]) {
  const [first = "landing", ...rest] = views
  const taken = new Set(views.flatMap(acceptedBy))
  const ids = Object.entries(startViewShape).filter(([key]) => taken.has(key as StartParam))
  const dialects = dialectsOf(views)
  const engine =
    engineRouteDialects(views).length === 0
      ? {}
      : engineParamShapeFor(offeredEngineIds(registry, { dialects }))
  // `view` first, as a strict input's refusal names the valid keys in this order.
  return {
    view: z.enum([first, ...rest]).optional(),
    ...(Object.fromEntries(ids) as Omit<typeof startViewShape, "view">),
    ...(engine as EngineParamShape),
  }
}

/**
 * Zod reports an unknown key and still runs this, so it reads only the keys it knows. An invalid
 * `view` stops the parse before it gets here. An app route opens no single engine (a board reads
 * the engines it names, the landing lists them), so it takes no `engine`. Without `view` the
 * cockpit opens at `defaultView`.
 */
function checkStartView(
  input: StartIds & { view?: CockpitSection; engine?: string },
  ctx: z.RefinementCtx,
  defaultView: CockpitSection,
) {
  const view = input.view ?? defaultView
  const accepted = acceptedBy(view)
  if (COCKPIT_ROUTES[view].scope === "app" && given(input.engine)) {
    ctx.addIssue({
      code: "custom",
      path: ["engine"],
      message: `view "${view}" opens no single engine: it takes no engine.`,
    })
  }
  for (const param of COCKPIT_ROUTES[view].needs) {
    if (!given(input[param])) {
      ctx.addIssue({ code: "custom", path: [param], message: `view "${view}" needs ${param}.` })
    }
  }
  for (const param of START_PARAMS) {
    if (accepted.includes(param) || !given(input[param])) continue
    const message =
      accepted.length === 0
        ? `view "${view}" takes no ${param}.`
        : `view "${view}" takes no ${param} (it takes ${accepted.join(", ")}).`
    ctx.addIssue({ code: "custom", path: [param], message })
  }
}

/** The route the ids name; `checkStartView` already held them to the view's needs. */
function toStartView(section: CockpitSection, ids: StartIds): CockpitView {
  const view: Record<string, unknown> = { section }
  for (const param of acceptedBy(section)) {
    if (given(ids[param])) view[param] = ids[param]
  }
  return view as CockpitView
}

/**
 * What the widgets need of an engine's dialect: a Camunda 7 engine its dialect alone; another
 * dialect's, which the cockpit shows on boards only, its web app's address as the profile writes
 * it (http(s) only, never derived) and the boards that name it. A refused profile's none.
 */
function dialectOf(
  backend: EngineBackend | undefined,
): Pick<CockpitEngineInfo, "dialect" | "webAppUrl" | "boards"> {
  if (backend === undefined) return {}
  if (backend.dialect === "c7") return { dialect: "c7" }
  const webAppUrl = webAppUrlOf(backend.cockpitUrl)
  return {
    dialect: backend.dialect,
    ...(webAppUrl === null ? {} : { webAppUrl }),
    boards: [...backend.boards],
  }
}

/**
 * Every configured engine in the order of the profiles, a refused one too (its row says its
 * profile is refused, and opening it shows why), each with its dialect. No REST baseUrl (internal
 * topology). The explicit return type turns an extra field into an excess-property error, which a
 * contextually typed callback would accept silently.
 */
function cockpitEngines(registry: EngineRegistry): CockpitEngineInfo[] {
  const usable = new Map(registry.engines.map((e) => [e.id, e]))
  return registry.engineIds.map((id): CockpitEngineInfo => ({
    id,
    environment: environmentOf(usable.get(id) ?? registry.refused.get(id) ?? {}),
    ...dialectOf(registry.backends.get(id)),
  }))
}

export function registerCockpitWidgetTools(context: WidgetToolsContext) {
  const { server, registry, healthThresholds } = context
  const views = servedViews(registry)
  const engineRoutes = engineRouteDialects(views).length > 0
  // Where the cockpit opens without `view`: the overview, else (no route of one engine is
  // served) the landing, where the engines and the boards are.
  const defaultView: CockpitSection = engineRoutes ? "overview" : "landing"
  server.registerTool(
    ENGINE_OPEN_COCKPIT,
    {
      title: "Open Cockpit",
      description: engineRoutes ? ENGINE_ROUTES_DESCRIPTION : APP_ROUTES_DESCRIPTION,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: strictToolInput(cockpitInput(registry, views)).superRefine((input, ctx) => {
        checkStartView(input, ctx, defaultView)
      }),
      ...showToolBinding(ENGINE_OPEN_COCKPIT, "Open Cockpit"),
    },
    withToolErrors(async (args, ctx) => {
      const { engine, view, ...ids } = args
      const engines = cockpitEngines(registry)
      const call = { engines: engines.map((e) => e.id) }
      const startView = toStartView(view ?? defaultView, ids)
      if (isAppView(startView)) {
        // An app route reads the engines it names, or lists them: no engine resolves, none is
        // the cockpit's.
        const marked = { dialects: ROUTE_DIALECTS[startView.section] }
        const start = await buildCockpitStart(startView, namedReads(context, marked, ctx))
        const app: CockpitAppData = { engineId: null, engines, start }
        return buildViewResult(
          app,
          JSON.stringify({ view: start.view.section, ...cockpitFacts(start, call) }),
        )
      }
      // A named view needs an engine its route serves (ENGINE_NOT_SELECTED names them, its mark
      // refuses another dialect's); without one the picker stays, also for a refused engine or
      // one the start route does not serve, which the picker shows. A bad `engine` is a tool
      // error, never a silent picker.
      const mark = { dialects: ROUTE_DIALECTS[startView.section] }
      const engineId =
        view === undefined
          ? cockpitEngineId(engine, registry, mark)
          : engineServing(engine, registry, mark)
      if (engineId === null) {
        const picker: CockpitAppData = { engineId: null, engines, start: null }
        return buildViewResult(picker, JSON.stringify({ engine: null, ...call }))
      }
      const start = await buildCockpitStart(
        startView,
        resolveEngine(engineId, registry, ctx),
        healthThresholds,
      )
      // The app passes `engineId` to every nested call, so navigation never depends on the default engine.
      const data: CockpitAppData = { engineId, engines, start }
      return buildViewResult(
        data,
        JSON.stringify({
          engine: engineId,
          view: start.view.section,
          ...cockpitFacts(start, call),
        }),
      )
    }),
  )
}
