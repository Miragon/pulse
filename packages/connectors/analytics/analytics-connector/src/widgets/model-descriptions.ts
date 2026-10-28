import type {
  AnalyticsDashboardData,
  CompareKpiDelta,
  FailureDashboardData,
} from "@miragon/pulse-analytics-client"
import { modelContextText, type ModelContextSpec } from "@miragon/pulse-widget-shell/widgets"
import type { DescribeForModel } from "@miragon/pulse-widget-shell/ui"
import { ANALYTICS_ONLY_SURFACE, engineIdsOf, isAggregate } from "./hand-off.js"
import type { ClusterCompareData } from "./cluster-compare.js"
import type { VersionCompareData } from "./version-compare.js"
import type { EngineCompareData } from "./engine-compare.js"
import type { EngineLandscapeData } from "./engine-landscape.js"
import type { AnalyticsSettingsViewData } from "./settings-section.js"
import type { AnalyticsBpmnHeatmapData } from "./bpmn-heatmap.js"
import { deltaFacts } from "./comparison-shared.js"

/**
 * Built by `modelContextText` (#338). The scope comes from the DATA, never the cell props (#336),
 * so a saved or composed widget describes the numbers on screen; an unmeasured figure is left out,
 * never 0. Names analytics tools only: a pure description cannot query the camunda7 surface.
 */

/** Said whenever a figure adds up several engines (the deliberate fleet aggregate). */
const AGGREGATED = " The figures add up every engine listed (aggregated)."

/**
 * An incident rate over several processes is a total over their mix, so its change is no verdict.
 */
const MIXED_RATE =
  " The incident rate totals several processes, so its change against the previous period reflects their mix and is not judged; compare per process."

/** How many definitions an unscoped dashboard covers (none when scoped to one). */
function definitionCount(data: AnalyticsDashboardData) {
  return data.processDefinitionKey ? undefined : data.definitionBreakdown.length
}

/**
 * Period flows (`…InWindow`: incidents, not failed instances) kept apart from the live `…Now`
 * gauges, which ignore the period (#336).
 */
export const describeExecutionSummary: DescribeForModel<AnalyticsDashboardData> = (data) =>
  modelContextText({
    summary:
      "The operator is viewing the execution summary of the process analytics: flows within the period (incidents, not failed instances) apart from the live state right now, which does not depend on the period." +
      (isAggregate(data.engines) ? AGGREGATED : ""),
    ids: {
      engine: engineIdsOf(data.engines),
      processDefinitionKey: data.processDefinitionKey ?? undefined,
      period: data.period,
    },
    facts: {
      processDefinitions: definitionCount(data),
      startedInWindow: data.totalCount,
      completedInWindow: data.completedCount,
      incidentsCreatedInWindow: data.incidentsCreated,
      incidentsResolvedInWindow: data.incidentsResolved,
      runningNow: data.runningNow,
      openIncidentsNow: data.openIncidentsNow,
    },
    tools: ["analytics_analyze_process_performance", "analytics_find_failed_instances"],
    surface: ANALYTICS_ONLY_SURFACE,
  })

/** The performance KPIs: durations of the instances that ENDED in the period (null when none did). */
export const describeExecutionPerformance: DescribeForModel<AnalyticsDashboardData> = (data) =>
  modelContextText({
    summary:
      "The operator is viewing the performance KPIs of the process analytics: durations of the instances that ended in the period, and incidents per 100 started instances." +
      (data.avgDurationMs === null
        ? " No instance ended in the period, so there are no durations."
        : "") +
      (data.processDefinitionKey ? "" : MIXED_RATE) +
      (isAggregate(data.engines) ? AGGREGATED : ""),
    ids: {
      engine: engineIdsOf(data.engines),
      processDefinitionKey: data.processDefinitionKey ?? undefined,
      period: data.period,
    },
    facts: {
      processDefinitions: definitionCount(data),
      avgDurationMs: data.avgDurationMs,
      medianDurationMs: data.medianDurationMs,
      p95DurationMs: data.p95DurationMs,
      incidentRatePct: data.incidentRatePct,
      // The reference the rate is judged against on screen: the period before.
      previousPeriodIncidentRatePct: data.previous?.incidentRatePct,
      previousPeriodComparisonNotReliable:
        (data.processDefinitionKey && data.previous?.suppressed) || undefined,
    },
    tools: ["analytics_element_bottleneck"],
    surface: ANALYTICS_ONLY_SURFACE,
  })

export const describeDefinitionBreakdown: DescribeForModel<AnalyticsDashboardData> = (data) => {
  const top = [...data.definitionBreakdown].sort((a, b) => b.totalInstances - a.totalInstances)[0]
  return modelContextText({
    summary:
      "The operator is viewing the per-definition breakdown of the process analytics; " +
      "the dashboard scopes to one process by its processDefinitionKey." +
      (isAggregate(data.engines) ? AGGREGATED : ""),
    ids: {
      engine: engineIdsOf(data.engines),
      processDefinitionKey: data.processDefinitionKey ?? undefined,
      period: data.period,
    },
    facts: {
      processDefinitions: data.definitionBreakdown.length,
      busiestProcessDefinitionKey: top?.processDefinitionKey,
      busiestStartedInWindow: top?.totalInstances,
      busiestIncidentsCreatedInWindow: top?.incidentsCreated,
      busiestRunningNow: top?.runningNow,
    },
    tools: ["analytics_show_dashboard"],
    surface: ANALYTICS_ONLY_SURFACE,
  })
}

/** BPMN ids are unique only within one model, so the top row names its process too. */
export const describeActivityBottlenecks: DescribeForModel<AnalyticsDashboardData> = (data) => {
  const top = [...data.activityBreakdown].sort((a, b) => b.totalTimeMs - a.totalTimeMs)[0]
  return modelContextText({
    summary:
      "The operator is viewing the activity-bottleneck table of the process analytics: one row per (process, activity)." +
      (isAggregate(data.engines) ? AGGREGATED : ""),
    ids: {
      engine: engineIdsOf(data.engines),
      processDefinitionKey: data.processDefinitionKey ?? undefined,
      period: data.period,
    },
    facts: {
      rows: data.activityBreakdown.length,
      // The list is the top of the breakdown by total time: how many there were in all.
      activitiesInAll:
        data.activityCount > data.activityBreakdown.length ? data.activityCount : undefined,
      topProcessDefinitionKey: top?.processDefinitionKey,
      topActivityId: top?.activityId,
      topExecutions: top?.executionCount,
      topTotalTimeMs: top?.totalTimeMs,
      topP95DurationMs: top?.p95DurationMs,
    },
    tools: ["analytics_element_bottleneck"],
    surface: ANALYTICS_ONLY_SURFACE,
  })
}

/** The failure summary (point-in-time). */
export const describeFailureSummary: DescribeForModel<FailureDashboardData> = (data) =>
  modelContextText({
    summary:
      "The operator is viewing the failure dashboard: the incidents open right now (point-in-time, no period), grouped by incident type and process." +
      (isAggregate(data.engines) ? AGGREGATED : ""),
    ids: { engine: engineIdsOf(data.engines) },
    facts: {
      openIncidents: data.totalIncidents,
      incidentGroups: data.uniqueErrorPatterns,
      mostAffectedProcess: data.mostAffectedProcess,
    },
    tools: ["analytics_find_failed_instances"],
    surface: ANALYTICS_ONLY_SURFACE,
  })

/**
 * The gauge carries only type, process and count. A custom incident type is quoted as untrusted
 * unless id-shaped (#338); a capped list says how much it shows.
 */
export const describeErrorPatterns: DescribeForModel<FailureDashboardData> = (data) => {
  const top = [...data.errorPatterns].sort((a, b) => b.incidentCount - a.incidentCount)[0]
  const listed = data.errorPatterns.length
  return modelContextText({
    summary:
      "The operator is viewing the incidents open right now (point-in-time), grouped by incident type and process; the metric carries no message, activity or timestamps." +
      (isAggregate(data.engines) ? AGGREGATED : ""),
    ids: { engine: engineIdsOf(data.engines) },
    // A value that is not id-shaped moves into the untrusted fence by itself.
    facts: {
      groups: data.uniqueErrorPatterns,
      listedGroups: listed < data.uniqueErrorPatterns ? listed : undefined,
      largestGroupProcessDefinitionKey: top?.processDefinitionKey,
      largestGroupIncidentType: top?.incidentType,
      largestGroupIncidents: top?.incidentCount,
    },
    tools: ["analytics_find_failed_instances"],
    surface: ANALYTICS_ONLY_SURFACE,
  })
}

/**
 * Live gauges. Regressions go elsewhere than analytics_version_compare: it cannot split incidents
 * by version (#327).
 */
export const describeFailureRates: DescribeForModel<FailureDashboardData> = (data) => {
  const top = [...data.processBreakdown].sort(
    (a, b) => (b.incidentRatePct ?? -1) - (a.incidentRatePct ?? -1),
  )[0]
  return modelContextText({
    summary:
      "The operator is viewing the incidents open right now by process (point-in-time): open " +
      "incidents per 100 running instances and dead jobs. A regression shows period over " +
      "period or around a deployment." +
      (isAggregate(data.engines) ? AGGREGATED : ""),
    ids: { engine: engineIdsOf(data.engines) },
    facts: {
      processes: data.processBreakdown.length,
      highestRateProcessDefinitionKey: top?.processDefinitionKey,
      highestOpenIncidentsNow: top?.openIncidents,
      highestRunningNow: top?.runningNow,
      highestIncidentRatePct: top?.incidentRatePct,
      highestDeadJobs: top?.deadJobs,
    },
    tools: ["analytics_compare_execution_periods", "analytics_cluster_compare"],
    surface: ANALYTICS_ONLY_SURFACE,
  })
}

/**
 * The candidates are the {@link deltaFacts} keys: a new `CompareKpiDelta` field must be added
 * there.
 */
function comparisonFacts(delta: CompareKpiDelta, suppressed: boolean) {
  const facts = deltaFacts(delta, suppressed)
  const moved = Object.entries(facts).filter(
    (entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] !== 0,
  )
  const largest = moved.reduce<[string, number] | null>(
    (max, entry) => (max === null || Math.abs(entry[1]) > Math.abs(max[1]) ? entry : max),
    null,
  )
  return { ...facts, largestDelta: largest?.[0] ?? "none" }
}

const SUPPRESSED = " The sample is below minBucketSize (suppressed): treat the deltas as noise."

/**
 * The ids re-run the comparison as asked; the windows actually measured (cut at now or the
 * retention) are facts (#336).
 */
export const describeClusterCompare: DescribeForModel<ClusterCompareData> = (data) =>
  modelContextText({
    summary:
      "The operator is comparing KPIs before vs after a deployment (cluster-wide unless a " +
      "processDefinitionKey scopes it); durations cover only the instances that ended in a window." +
      (data.partial
        ? " A window was cut short at now or the retention (partial): starts compare per day."
        : "") +
      (data.suppressed ? SUPPRESSED : "") +
      (isAggregate(data.engines) ? AGGREGATED : ""),
    ids: {
      engine: engineIdsOf(data.engines),
      deploymentTimestamp: data.deploymentTimestamp,
      windowBeforeDays: data.requestedWindowDays.before,
      windowAfterDays: data.requestedWindowDays.after,
      processDefinitionKey: data.processDefinitionKey,
      activityId: data.activityId,
    },
    facts: {
      measuredBeforeDays: data.windowDays.before,
      measuredAfterDays: data.windowDays.after,
      ...comparisonFacts(data.delta, data.suppressed),
    },
    tools: ["analytics_cluster_compare", "analytics_element_bottleneck"],
    surface: ANALYTICS_ONLY_SURFACE,
  })

/** Version compare: process-wide (the tool takes no element scope, #336). */
export const describeVersionCompare: DescribeForModel<VersionCompareData> = (data) =>
  modelContextText({
    summary:
      "The operator is comparing two versions of one process (versionA is the baseline); every " +
      "figure covers the whole process." +
      (data.suppressed ? SUPPRESSED : "") +
      (isAggregate(data.engines) ? AGGREGATED : ""),
    ids: {
      engine: engineIdsOf(data.engines),
      processDefinitionKey: data.processDefinitionKey,
      versionA: data.versionA,
      versionB: data.versionB,
      windowDays: data.windowDays,
    },
    facts: comparisonFacts(data.delta, data.suppressed),
    tools: ["analytics_version_compare", "analytics_element_bottleneck"],
    surface: ANALYTICS_ONLY_SURFACE,
  })

export const describeEngineCompare: DescribeForModel<EngineCompareData> = (data) =>
  modelContextText({
    summary:
      "The operator is comparing one process on two engines (engineA is the baseline). The " +
      "process is held fixed, so a delta is attributable to the engine rather than to a " +
      "different workload." +
      (data.suppressed ? SUPPRESSED : ""),
    ids: {
      processDefinitionKey: data.processDefinitionKey,
      engineA: data.engineA,
      engineB: data.engineB,
      windowDays: data.windowDays,
      activityId: data.activityId,
    },
    facts: comparisonFacts(data.delta, data.suppressed),
    tools: ["analytics_engine_compare", "analytics_engine_health", "analytics_engine_landscape"],
    surface: ANALYTICS_ONLY_SURFACE,
  })

export const describeEngineLandscape: DescribeForModel<EngineLandscapeData> = (data) => {
  const { totals } = data
  const silent = data.engines.filter((e) => !e.reporting).map((e) => e.engineId)
  // Ranked among the engines that report: a silent engine's counts are unknown (null).
  const measured = data.engines.flatMap((e) =>
    e.reporting
      ? [{ ...e, running: e.runningInstances ?? 0, executable: e.executableJobs ?? 0 }]
      : [],
  )
  const busiest = [...measured].sort((a, b) => b.running - a.running)[0]
  const backlog = [...measured].sort((a, b) => b.executable - a.executable)[0]
  const shared = data.sharedProcessKeys.length > 0
  return modelContextText({
    summary:
      "The operator is viewing the cross-engine landscape: absolute counts and the " +
      "process-independent job backlog on purpose — engines run different process mixes, so " +
      "per-engine failure rates or durations would describe the mix, not the engine." +
      (shared
        ? " A KPI comparison is only sound for a definition deployed on several engines " +
          "(sharedProcessKeys), compared by its processDefinitionKey."
        : " No definition runs on more than one engine, so there is no valid engine-vs-engine " +
          "KPI comparison here."),
    facts: {
      engines: totals.engineCount,
      processDefinitions: totals.processKeyCount,
      runningInstances: totals.runningInstances,
      openIncidents: totals.openIncidents,
      enginesReportingNoMetrics: silent.length > 0 ? silent : undefined,
      busiestEngine: busiest?.engineId,
      busiestRunningInstances: busiest?.running,
      largestBacklogEngine: backlog && backlog.executable > 0 ? backlog.engineId : undefined,
      largestBacklogExecutableJobs:
        backlog && backlog.executable > 0 ? backlog.executable : undefined,
      sharedProcessKeys: shared ? data.sharedProcessKeys : undefined,
    },
    tools: ["analytics_engine_compare", "analytics_engine_health"].filter(
      (tool) => shared || tool !== "analytics_engine_compare",
    ),
    surface: ANALYTICS_ONLY_SURFACE,
  })
}

function maxEntry(values: Record<string, number>): [string, number] | null {
  let best: [string, number] | null = null
  for (const [key, value] of Object.entries(values)) {
    if (!best || value > best[1]) best = [key, value]
  }
  return best
}

/**
 * The save tool is named only while `canSave`, so the model is never told about a write that fails.
 */
export function describeAnalyticsSettings(data: AnalyticsSettingsViewData): ModelContextSpec {
  return {
    summary:
      "The operator is viewing the analytics settings: the defaults every analytics call uses when it omits period or minBucketSize.",
    facts: {
      defaultPeriod: data.settings.defaultPeriod,
      minBucketSize: data.settings.minBucketSize,
      editable: data.canSave,
    },
    tools: ["analytics_save_settings"],
    surface: { has: (tool) => tool === "analytics_save_settings" && data.canSave },
  }
}

/** The BPMN heatmap — over the engines its heat adds up (the `engines` echo, #336). */
export const describeBpmnHeatmap: DescribeForModel<AnalyticsBpmnHeatmapData> = (data) => {
  const hottest = maxEntry(data.frequency)
  const slowest = maxEntry(data.durationSec)
  return modelContextText({
    summary:
      "The operator is viewing the BPMN heatmap of one process (the frequency ↔ duration toggle " +
      "is client-side)." +
      (isAggregate(data.engines) ? AGGREGATED : ""),
    ids: {
      engine: engineIdsOf(data.engines),
      processDefinitionKey: data.processDefinitionKey,
      period: data.period,
    },
    facts: {
      elementsWithHeat: Object.keys(data.frequency).length,
      hottestActivityId: hottest?.[0],
      hottestExecutions: hottest?.[1],
      slowestActivityId: slowest?.[0],
      slowestAvgSec: slowest ? Math.round(slowest[1] * 10) / 10 : undefined,
    },
    tools: ["analytics_element_bottleneck"],
    surface: ANALYTICS_ONLY_SURFACE,
  })
}
