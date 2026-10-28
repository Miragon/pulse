export {
  createPrometheusClient,
  withCallerSignal,
  DEFAULT_PROMETHEUS_TIMEOUT_MS,
  type PrometheusQueryOptions,
  escapeLabelValue,
  engineMatcher,
  engineIdsOf,
  selector,
  PERIOD_RANGE,
  PERIODS,
  RETENTION_DAYS,
  type PrometheusConfig,
  type PrometheusClient,
  type PromSample,
  type EngineFilterInput,
  type Period,
} from "./prometheus.js"
export { METRIC_NAMES, GAUGE_LABELS, type MetricName, type GaugeName } from "./metric-names.js"
export { increaseIn, engineState } from "./queries/helpers.js"
export type { CountWindow } from "./queries/windows.js"
// Not in `queries`: the query scenarios enumerate every member of that namespace.
export { ENGINE_ALERT_NAME_PATTERN, ENGINE_HEALTH_STATUS_RULE } from "./queries/health.js"
export { ACTIVITY_BREAKDOWN_LIMIT } from "./queries/dashboard.js"
export * as schemas from "./schemas/index.js"
export * as queries from "./queries/index.js"
export * as widgets from "./widgets.js"

export type {
  CompareKpis,
  CompareKpiDelta,
  ErrorPatternRow,
  FailedInstancesResult,
  PerformanceResult,
  PerformanceKPI,
  ActivityBreakdownRow,
  PeriodComparisonKpi,
  PeriodActivityComparisonRow,
  PeriodComparisonResult,
  ElementBottleneckRow,
  ElementBottleneckResult,
  ElementHeatResult,
  ClusterCompareResult,
  ClusterCompareKpi,
  ClusterCompareDelta,
  VersionCompareResult,
  VersionCompareKpi,
  VersionCompareDelta,
  EngineCompareResult,
  EngineCompareKpi,
  EngineCompareDelta,
  EngineLandscapeResult,
  EngineLandscapeEngine,
  EngineLandscapeProcess,
  EngineHealthResult,
  HealthCount,
  HealthAlert,
} from "./queries/index.js"

export type {
  ErrorPatternItem,
  ProcessFailureItem,
  FailureDashboardData,
  ActivityBreakdownItem,
  DefinitionBreakdownItem,
  AnalyticsDashboardData,
  PreviousPeriodFlows,
} from "./widgets.js"
