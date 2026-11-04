import {
  appOnly,
  buildDataFeedResult,
  showToolBinding,
  withToolErrors,
  strictToolInput,
} from "@miragon/pulse-widget-shell/server"
import { queries, withCallerSignal } from "@miragon/pulse-analytics-client"
import {
  ANALYTICS_ENGINE_LANDSCAPE_DATA,
  ANALYTICS_SHOW_ENGINE_COMPARE,
  ANALYTICS_SHOW_ENGINE_LANDSCAPE,
  ANALYTICS_SHOW_PERIOD_COMPARE,
  ANALYTICS_SHOW_VERSION_COMPARE,
} from "../tool-names.js"
import { withEngineScope } from "../engine-ids.js"
import { namedLandscape } from "../named-views.js"
import { NO_NAMES } from "../bpmn-name-lookup.js"
import {
  engineCompareInput,
  engineLandscapeInput,
  periodCompareInput,
  versionCompareInput,
} from "../schemas/index.js"
import { viewWithJson, type AnalyticsWidgetToolsContext } from "./shared.js"

/** The landscape is no fourth comparison: engines host different process mixes. */
export function registerComparisonWidgetTools(ctx: AnalyticsWidgetToolsContext) {
  const { server, ch, engineScope } = ctx
  const namesFor = ctx.namesFor ?? NO_NAMES

  server.tool(
    {
      name: ANALYTICS_SHOW_PERIOD_COMPARE,
      title: "Period Comparison",
      description:
        "Compare process KPIs of two periods (around a deployment, A ends and B starts at its deployment time). Per period: starts and starts per day, completions, incidents per 100 starts, avg/median/p95 duration, plus the deltas. Periods are clamped to now and the 30-day retention and reported as measured (`partial`); a reversed or wholly out-of-range period is refused.",
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: strictToolInput(periodCompareInput.shape),
      ...showToolBinding(ANALYTICS_SHOW_PERIOD_COMPARE, "Period Comparison"),
    },
    withToolErrors(async (args, toolCtx) => {
      const data = await queries.periodCompare(
        withCallerSignal(ch, toolCtx.signal),
        withEngineScope(engineScope, args),
      )
      return viewWithJson(data, data)
    }),
  )

  server.tool(
    {
      name: ANALYTICS_SHOW_VERSION_COMPARE,
      title: "Process Version Comparison",
      description:
        "Compare KPIs of two deployed versions of one processDefinitionKey over a shared rolling window. The version is an exact label on the instance and incident series, so starts, completions, incidents, incidents per 100 starts and avg/median/p95 duration per version and their deltas are exact; the comparison is process-wide (no element scope).",
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: strictToolInput(versionCompareInput.shape),
      ...showToolBinding(ANALYTICS_SHOW_VERSION_COMPARE, "Process Version Comparison"),
    },
    withToolErrors(async (args, toolCtx) => {
      const data = await queries.versionCompare(
        withCallerSignal(ch, toolCtx.signal),
        withEngineScope(engineScope, args),
      )
      return viewWithJson(data, data)
    }),
  )

  server.tool(
    {
      name: ANALYTICS_SHOW_ENGINE_COMPARE,
      title: "Engine Comparison",
      description:
        "Compare ONE process definition on two configured engines (e.g. prod-a vs prod-b) over a shared rolling window: starts, completions, incidents per 100 starts, avg/median/p95 duration, plus the deltas.",
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: strictToolInput(engineCompareInput.shape),
      ...showToolBinding(ANALYTICS_SHOW_ENGINE_COMPARE, "Engine Comparison"),
    },
    withToolErrors(async (args, toolCtx) => {
      const data = await queries.engineCompare(withCallerSignal(ch, toolCtx.signal), {
        ...args,
        engineA: engineScope.require(args.engineA, "engineA"),
        engineB: engineScope.require(args.engineB, "engineB"),
      })
      return viewWithJson(data, data)
    }),
  )

  // The landscape is an overview, NOT an engine ranking.
  server.tool(
    {
      name: ANALYTICS_SHOW_ENGINE_LANDSCAPE,
      title: "Cross-Engine Landscape",
      description:
        "Show the cross-engine landscape of the configured engines: which process definitions run on which engine, the load per engine (running instances, open incidents, failed jobs) and the engine-owned job backlog (executable, suspended and future-due jobs, open external tasks). Counts, not rates: engines host different process mixes, so a per-engine rate would measure the mix; the backlog gauges carry no process label and do compare. `sharedProcessKeys` (deployed on several engines) are the only sound inputs for analytics_show_engine_compare; an engine without metrics has `reporting: false`.",
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: strictToolInput(engineLandscapeInput.shape),
      ...showToolBinding(ANALYTICS_SHOW_ENGINE_LANDSCAPE, "Cross-Engine Landscape"),
    },
    withToolErrors(async (args, toolCtx) => {
      const result = await queries.engineLandscape(
        withCallerSignal(ch, toolCtx.signal),
        withEngineScope(engineScope, args),
      )
      return viewWithJson(await namedLandscape(result, namesFor), result)
    }),
  )

  server.tool(
    {
      name: ANALYTICS_ENGINE_LANDSCAPE_DATA,
      title: "Engine landscape data (internal)",
      description:
        "Internal JSON feed (no UI) for the cross-engine landscape widget's self-fetch, also consumed by the engine cockpit's cross-engine mode. Prefer analytics_show_engine_landscape.",
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: strictToolInput(engineLandscapeInput.shape),
      ...appOnly,
    },
    withToolErrors(async (args, toolCtx) => {
      const data = await namedLandscape(
        await queries.engineLandscape(
          withCallerSignal(ch, toolCtx.signal),
          withEngineScope(engineScope, args),
        ),
        namesFor,
      )
      return buildDataFeedResult({ ...data })
    }),
  )
}
