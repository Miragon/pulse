import type { PrometheusClient, PromSample } from "./prometheus.js"
import * as queries from "./queries/index.js"

export const REPRESENTATIVE_SAMPLE: PromSample = {
  metric: {
    engine_id: "prod-a",
    process_definition_key: "invoice",
    activity_id: "Task_check",
    activity_type: "serviceTask",
    incident_type: "failedJob",
    alertname: "CibSevenDeadJobs",
    severity: "warning",
  },
  value: 1,
}

export interface RecordingClient {
  ch: PrometheusClient
  sent: string[]
}

// Answering with a sample by default runs the result mapping too; `() => []` is a Prometheus without data.
export function recordingClient(
  answer: (query: string) => PromSample[] = () => [REPRESENTATIVE_SAMPLE],
): RecordingClient {
  const sent: string[] = []
  return {
    ch: {
      instant: (query: string) => {
        sent.push(query)
        return Promise.resolve(answer(query))
      },
    },
    sent,
  }
}

export type Scenario = (ch: PrometheusClient) => Promise<unknown>

/**
 * ISO timestamp `days` before now (whole days, at call time — so a guard that
 * pins the clock sees windows relative to ITS now). Scenario windows must sit
 * inside the retention or the query refuses them.
 */
export const isoDaysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()

// A total map over `queries`: a new export without a scenario fails `pnpm typecheck`.
export const SCENARIOS: { [K in keyof typeof queries]: Scenario[] } = {
  analyzePerformance: [
    (ch) =>
      queries.analyzePerformance(ch, {
        processDefinitionKey: "invoice",
        period: "7d",
        includeActivityBreakdown: true,
        engine: "prod-a",
      }),
  ],
  comparePeriods: [
    (ch) =>
      queries.comparePeriods(ch, {
        processDefinitionKey: "invoice",
        periodAFrom: isoDaysAgo(14),
        periodATo: isoDaysAgo(7),
        periodBFrom: isoDaysAgo(7),
        periodBTo: isoDaysAgo(0),
        includeActivityBreakdown: true,
        engine: ["prod-a", "prod-b"],
      }),
  ],
  findFailedInstances: [
    (ch) =>
      queries.findFailedInstances(ch, {
        processDefinitionKey: "invoice",
        incidentType: "failedJob",
        maxResults: 10,
        engine: "prod-a",
      }),
    (ch) => queries.findFailedInstances(ch, { maxResults: 10 }),
  ],
  elementBottleneck: [
    (ch) =>
      queries.elementBottleneck(ch, {
        processDefinitionKey: "invoice",
        period: "7d",
        minBucketSize: 1,
        maxResults: 10,
        engine: "prod-a",
      }),
  ],
  elementHeat: [
    (ch) => queries.elementHeat(ch, { processDefinitionKey: "invoice", period: "7d", engine: "a" }),
  ],
  clusterCompare: [
    (ch) =>
      queries.clusterCompare(ch, {
        processDefinitionKey: "invoice",
        activityId: "Task_check",
        deploymentTimestamp: isoDaysAgo(10),
        windowBeforeDays: 7,
        windowAfterDays: 7,
        minBucketSize: 1,
        engine: "prod-a",
      }),
    // A recent deployment: the post-deploy window reaches past now.
    (ch) =>
      queries.clusterCompare(ch, {
        deploymentTimestamp: isoDaysAgo(2),
        windowBeforeDays: 7,
        windowAfterDays: 7,
        minBucketSize: 1,
      }),
  ],
  versionCompare: [
    (ch) =>
      queries.versionCompare(ch, {
        processDefinitionKey: "invoice",
        versionA: 1,
        versionB: 2,
        windowDays: 14,
        minBucketSize: 1,
        engine: ["prod-a", "prod-b"],
      }),
  ],
  engineCompare: [
    (ch) =>
      queries.engineCompare(ch, {
        processDefinitionKey: "invoice",
        engineA: "prod-a",
        engineB: "prod-b",
        windowDays: 14,
        activityId: "Task_check",
        minBucketSize: 1,
      }),
  ],
  engineLandscape: [
    (ch) => queries.engineLandscape(ch),
    (ch) => queries.engineLandscape(ch, { engine: ["prod-a", "prod-b"] }),
  ],
  dashboardData: [
    (ch) => queries.dashboardData(ch, { processDefinitionKey: "invoice", period: "7d" }),
    (ch) => queries.dashboardData(ch, { period: "1d", engine: "prod-a" }),
  ],
  failureDashboardData: [(ch) => queries.failureDashboardData(ch, { engine: "prod-a" })],
  engineHealth: [
    (ch) => queries.engineHealth(ch, {}),
    (ch) => queries.engineHealth(ch, { engine: "prod-a" }),
    (ch) => queries.engineHealth(ch, { engine: ["prod-a", "prod-b"], includeFleetAlerts: true }),
  ],
}

export function exportedQueryFunctions(): string[] {
  return Object.keys(queries).filter(
    (k) => typeof (queries as Record<string, unknown>)[k] === "function",
  )
}
