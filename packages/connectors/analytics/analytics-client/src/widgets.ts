import type { Period } from "./prometheus.js"

export interface ErrorPatternItem {
  incidentType: string
  processDefinitionKey: string
  incidentCount: number
}

export interface ProcessFailureItem {
  processDefinitionKey: string
  runningNow: number
  deadJobs: number
  openIncidents: number
  incidentRatePct: number | null
}

export interface FailureDashboardData {
  engines: string[] | null
  totalIncidents: number
  uniqueErrorPatterns: number
  mostAffectedProcess: string | null
  errorPatterns: ErrorPatternItem[]
  processBreakdown: ProcessFailureItem[]
  /** Optional: payloads recorded before it existed lack it. */
  asOf?: string
}

export interface ActivityBreakdownItem {
  processDefinitionKey: string
  activityId: string
  activityType: string
  executionCount: number
  avgDurationMs: number | null
  p95DurationMs: number | null
  totalTimeMs: number
}

export interface DefinitionBreakdownItem {
  processDefinitionKey: string
  totalInstances: number
  completed: number
  runningNow: number | null
  incidentsCreated: number
  avgDurationMs: number | null
}

export interface AnalyticsDashboardData {
  processDefinitionKey: string | null
  period: Period
  engines: string[] | null
  /** Optional: payloads recorded before it existed lack it. */
  reportingEngines?: string[]
  /** Optional: payloads recorded before it existed lack it. */
  asOf?: string
  totalCount: number
  completedCount: number
  incidentsCreated: number
  incidentsResolved: number
  incidentRatePct: number | null
  avgDurationMs: number | null
  medianDurationMs: number | null
  p95DurationMs: number | null
  runningNow: number | null
  openIncidentsNow: number | null
  previous: PreviousPeriodFlows | null
  activityBreakdown: ActivityBreakdownItem[]
  activityCount: number
  definitionBreakdown: DefinitionBreakdownItem[]
}

export interface PreviousPeriodFlows {
  totalCount: number
  incidentsCreated: number
  incidentRatePct: number | null
  partial: boolean
  suppressed: boolean
}
