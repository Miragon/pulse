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
} from "../view-models.js"
import { buildCockpitStart, cockpitFacts } from "../data/cockpit-start.js"
import { ENGINE_OPEN_COCKPIT } from "../tool-names.js"
import { cockpitEngineId, resolveEngine } from "../lib/resolve-engine.js"
import { environmentOf } from "../lib/environments.js"
import type { WidgetToolsContext } from "./shared.js"

/** The ids a start view may carry, besides `view` itself. */
type StartParam =
  | "processDefinitionKey"
  | "focus"
  | "activityId"
  | "incidentType"
  | "messageSignature"
  | "processInstanceId"
  | "incidentId"
  | "failedOnly"

/**
 * What each route reads; total over the sections, so a new route fails to compile until it is
 * listed, and its key order is the order of the `view` enum.
 */
const START_VIEW_PARAMS: Record<
  CockpitSection,
  { needs: readonly StartParam[]; takes: readonly StartParam[] }
> = {
  overview: { needs: [], takes: [] },
  incidents: { needs: [], takes: [] },
  "cluster-detail": { needs: ["activityId", "incidentType"], takes: ["messageSignature"] },
  "process-detail": { needs: ["processDefinitionKey"], takes: ["focus"] },
  "process-instances": { needs: [], takes: ["processDefinitionKey"] },
  "instance-detail": { needs: ["processInstanceId"], takes: [] },
  "incident-detail": { needs: ["incidentId"], takes: [] },
  jobs: { needs: [], takes: ["processDefinitionKey", "failedOnly"] },
  history: { needs: ["processInstanceId"], takes: [] },
}

const START_VIEWS = Object.keys(START_VIEW_PARAMS) as [CockpitSection, ...CockpitSection[]]

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
} satisfies Record<StartParam | "view", z.ZodType>

type StartIds = Partial<z.output<z.ZodObject<typeof startViewShape>>>

const START_PARAMS = Object.keys(startViewShape).filter((key): key is StartParam => key !== "view")

const given = (value: unknown) => value !== undefined && value !== ""

const acceptedBy = (view: CockpitSection) => [
  ...START_VIEW_PARAMS[view].needs,
  ...START_VIEW_PARAMS[view].takes,
]

/**
 * Zod reports an unknown key and still runs this, so it reads only the keys it knows. An invalid
 * `view` stops the parse before it gets here.
 */
function checkStartView(input: StartIds & { view?: CockpitSection }, ctx: z.RefinementCtx) {
  const view = input.view ?? "overview"
  const accepted = acceptedBy(view)
  for (const param of START_VIEW_PARAMS[view].needs) {
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

export function registerCockpitWidgetTools({
  server,
  registry,
  healthThresholds,
  engineParam,
}: WidgetToolsContext) {
  server.tool(
    {
      name: ENGINE_OPEN_COCKPIT,
      title: "Open Cockpit",
      description:
        "Show the user the operations cockpit on one engine; they navigate it without further tool calls. `view` picks where it opens, by default the overview: the health verdict from the open incidents, the top failure clusters and every process. instance-detail needs a running instance; history shows ended ones too. You get that view's facts as compact JSON.",
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: strictToolInput({ ...startViewShape, ...engineParam }).superRefine(
        checkStartView,
      ),
      ...showToolBinding(ENGINE_OPEN_COCKPIT, "Open Cockpit"),
    },
    withToolErrors(async (args, ctx) => {
      const { engine, view, ...ids } = args
      // No REST baseUrl (internal topology). The explicit return type turns an extra field into
      // an excess-property error, which a contextually typed callback would accept silently.
      const engines = registry.engines.map((e): CockpitEngineInfo => ({
        id: e.id,
        environment: environmentOf(e),
      }))
      // A named view needs an engine (ENGINE_NOT_SELECTED names them); without one the picker
      // stays. A bad `engine` is a tool error, never a silent picker.
      const engineId =
        view === undefined
          ? cockpitEngineId(engine, registry)
          : resolveEngine(engine, registry).engineId
      if (engineId === null) {
        const picker: CockpitAppData = { engineId: null, engines, start: null }
        return buildViewResult(
          picker,
          JSON.stringify({ engine: null, engines: engines.map((e) => e.id) }),
        )
      }
      const start = await buildCockpitStart(
        toStartView(view ?? "overview", ids),
        resolveEngine(engineId, registry, ctx),
        healthThresholds,
      )
      // The app passes `engineId` to every nested call, so navigation never depends on the default engine.
      const data: CockpitAppData = { engineId, engines, start }
      return buildViewResult(
        data,
        JSON.stringify({ engine: engineId, view: start.view.section, ...cockpitFacts(start) }),
      )
    }),
  )
}
