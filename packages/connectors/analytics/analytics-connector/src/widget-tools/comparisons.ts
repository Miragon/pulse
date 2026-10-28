import {
  appOnly,
  buildDataFeedResult,
  buildSingleWidgetView,
  showToolBinding,
  withToolErrors,
  strictToolInput,
} from "@miragon/pulse-widget-shell/server"
import { queries, schemas, withCallerSignal } from "@miragon/pulse-analytics-client"
import { ANALYTICS_ENGINE_LANDSCAPE_DATA } from "../tool-names.js"
import { localizeViewFor } from "../server-locale.js"
import { optionalMinBucketSize, settingsFor } from "../settings.js"
import { isFleetRequest, withEngineScope } from "../engine-ids.js"
import { namedLandscape } from "../named-views.js"
import { NO_NAMES } from "../bpmn-name-lookup.js"
import {
  compareDeltaSummary,
  engineScopeSummary,
  suppressedNote,
  type AnalyticsWidgetToolsContext,
} from "./shared.js"

/** The landscape is no fourth comparison: engines host different process mixes. */
export function registerComparisonWidgetTools(ctx: AnalyticsWidgetToolsContext) {
  const { server, ch, engineScope, profileStore } = ctx
  const namesFor = ctx.namesFor ?? NO_NAMES

  server.tool(
    {
      name: "analytics_show_cluster_compare",
      title: "Pre/Post Deployment Comparison",
      description:
        "Visualize before/after KPI deltas around a deployment timestamp. Windows are clamped to now and the retention (flagged `partial`; starts compare per day). Results are flagged `suppressed` when either window has fewer than minBucketSize started or completed instances.",
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: strictToolInput({
        ...schemas.clusterCompareInput.shape,
        minBucketSize: optionalMinBucketSize,
      }),
      ...showToolBinding("analytics_show_cluster_compare", "Pre/Post Deployment Comparison"),
    },
    withToolErrors(async (args, toolCtx) => {
      const { t, title } = await localizeViewFor(profileStore, toolCtx)
      const minBucketSize =
        args.minBucketSize ?? (await settingsFor(profileStore, toolCtx)).minBucketSize
      const data = await queries.clusterCompare(withCallerSignal(ch, toolCtx.signal), {
        ...withEngineScope(engineScope, args),
        minBucketSize,
      })
      return buildSingleWidgetView({
        widget: "analytics:cluster-compare",
        app: "analytics",
        dataType: "analytics:clusterCompare",
        data,
        // None with "system": the widget heading names the view.
        title: title("aClusterCompare.title"),
        summary: t("aSum.clusterCompare", {
          scope: data.processDefinitionKey
            ? t("aSum.scopeForProcess", { key: data.processDefinitionKey })
            : "",
          engines: engineScopeSummary(t, data.engines, isFleetRequest(args.engine)),
          deploymentTimestamp: data.deploymentTimestamp,
          before: data.windowDays.before,
          after: data.windowDays.after,
          partial: data.partial ? t("aSum.clusterComparePartial") : "",
          delta: compareDeltaSummary(data.delta),
          suppressed: suppressedNote(data.suppressed),
        }),
      })
    }),
  )

  server.tool(
    {
      name: "analytics_show_version_compare",
      title: "Process Version Comparison",
      description:
        "Visualize KPI deltas between two deployed versions of the same processDefinitionKey within a shared time window. Instance counts and durations are exact per version; the incident rates show as n/a — the incident metric carries no version label, so they are not measured per version (never read them as zero). Results are flagged `suppressed` when either version has fewer than minBucketSize started or completed instances.",
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: strictToolInput({
        ...schemas.versionCompareInput.shape,
        minBucketSize: optionalMinBucketSize,
      }),
      ...showToolBinding("analytics_show_version_compare", "Process Version Comparison"),
    },
    withToolErrors(async (args, toolCtx) => {
      const { t, title } = await localizeViewFor(profileStore, toolCtx)
      const minBucketSize =
        args.minBucketSize ?? (await settingsFor(profileStore, toolCtx)).minBucketSize
      const data = await queries.versionCompare(withCallerSignal(ch, toolCtx.signal), {
        ...withEngineScope(engineScope, args),
        minBucketSize,
      })
      return buildSingleWidgetView({
        widget: "analytics:version-compare",
        app: "analytics",
        dataType: "analytics:versionCompare",
        data,
        title: title("aVersionCompare.title"),
        summary: t("aSum.versionCompare", {
          key: data.processDefinitionKey,
          versionA: data.versionA,
          versionB: data.versionB,
          windowDays: data.windowDays,
          engines: engineScopeSummary(t, data.engines, isFleetRequest(args.engine)),
          delta: compareDeltaSummary(data.delta),
          suppressed: suppressedNote(data.suppressed),
        }),
      })
    }),
  )

  server.tool(
    {
      name: "analytics_show_engine_compare",
      title: "Engine Comparison",
      description:
        "Visualize KPI deltas for ONE process definition as it runs on two configured CIB Seven engines (e.g. prod-a vs prod-b) over a shared time window. processDefinitionKey is required — engines host different process mixes, so an unscoped engine-vs-engine comparison would measure the mix, not the engines. Results are flagged `suppressed` when either engine has fewer than minBucketSize started or completed instances. For the cross-engine picture use analytics_show_engine_landscape.",
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: strictToolInput({
        ...schemas.engineCompareInput.shape,
        minBucketSize: optionalMinBucketSize,
      }),
      ...showToolBinding("analytics_show_engine_compare", "Engine Comparison"),
    },
    withToolErrors(async (args, toolCtx) => {
      const { t, title } = await localizeViewFor(profileStore, toolCtx)
      const minBucketSize =
        args.minBucketSize ?? (await settingsFor(profileStore, toolCtx)).minBucketSize
      const data = await queries.engineCompare(withCallerSignal(ch, toolCtx.signal), {
        ...args,
        engineA: engineScope.require(args.engineA, "engineA"),
        engineB: engineScope.require(args.engineB, "engineB"),
        minBucketSize,
      })
      return buildSingleWidgetView({
        widget: "analytics:engine-compare",
        app: "analytics",
        dataType: "analytics:engineCompare",
        data,
        title: title("aEngineCompare.title"),
        summary: t("aSum.engineCompare", {
          engineA: data.engineA,
          engineB: data.engineB,
          key: data.processDefinitionKey,
          windowDays: data.windowDays,
          delta: compareDeltaSummary(data.delta),
          suppressed: suppressedNote(data.suppressed),
        }),
      })
    }),
  )

  // The landscape is an overview, NOT an engine ranking.
  server.tool(
    {
      name: "analytics_show_engine_landscape",
      title: "Cross-Engine Landscape",
      description:
        "Show the cross-engine process landscape of the configured engines: which process definitions run on which engine, the absolute load per engine (running instances, open incidents, failed jobs) and the engine-owned job backlog. Counts, not rates — engines host different process mixes, so per-engine rates would measure the mix. Highlights the definitions deployed on several engines, the only sound targets for analytics_show_engine_compare.",
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: strictToolInput(schemas.engineLandscapeInput.shape),
      ...showToolBinding("analytics_show_engine_landscape", "Cross-Engine Landscape"),
    },
    withToolErrors(async (args, toolCtx) => {
      const { t, title } = await localizeViewFor(profileStore, toolCtx)
      const data = await namedLandscape(
        await queries.engineLandscape(
          withCallerSignal(ch, toolCtx.signal),
          withEngineScope(engineScope, args),
        ),
        namesFor,
      )
      return buildSingleWidgetView({
        widget: "analytics:engine-landscape",
        app: "analytics",
        dataType: "analytics:engineLandscape",
        data,
        title: title("aLandscape.heading"),
        summary: t("aSum.engineLandscape", {
          engineCount: data.totals.engineCount,
          reportingEngineCount: data.totals.reportingEngineCount,
          processKeyCount: data.totals.processKeyCount,
          sharedProcessKeyCount: data.totals.sharedProcessKeyCount,
          // Unknown while no engine reports: "n/a", never a plausible 0.
          runningInstances: data.totals.runningInstances ?? "n/a",
          openIncidents: data.totals.openIncidents ?? "n/a",
          shared: data.sharedProcessKeys.length
            ? t("aSum.sharedKeys", { keys: data.sharedProcessKeys.join(", ") })
            : "",
        }),
      })
    }),
  )

  server.tool(
    {
      name: ANALYTICS_ENGINE_LANDSCAPE_DATA,
      title: "Engine landscape data (internal)",
      description:
        "Internal JSON feed (no UI) for the cross-engine landscape widget's self-fetch — also consumed by the camunda7 cockpit's cross-engine mode. Prefer analytics_show_engine_landscape.",
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: strictToolInput(schemas.engineLandscapeInput.shape),
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
