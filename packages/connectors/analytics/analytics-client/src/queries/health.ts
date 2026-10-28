import {
  engineIdsOf,
  engineMatcher,
  selector,
  type EngineFilterInput,
  type PrometheusClient,
  type PromSample,
} from "../prometheus.js"
import { METRIC_NAMES as M } from "../metric-names.js"
import { engineState, reportingEnginesQuery } from "./helpers.js"

export interface HealthCount {
  label: string
  count: number
}

export interface HealthAlert {
  name: string
  severity: string
  scope: string
}

// An engine-less alert counts only when it is ours: in a shared Prometheus the others belong to somebody else.
export const ENGINE_ALERT_NAME_PATTERN = "CibSeven.+"

// Carried in every result so no reader mistakes this verdict for camunda7_show_engine_health's: the two may disagree.
export const ENGINE_HEALTH_STATUS_RULE =
  "From Prometheus, over the engines in scope: unknown when none of them reports metrics; critical only while a severity=critical alert fires for them (fleet-wide also an engine-less CibSeven* alert); degraded with any such firing alert, dead job, open incident or an engine in scope that reports nothing; else healthy."

export interface EngineHealthResult {
  status: "healthy" | "degraded" | "critical" | "unknown"
  statusRule: string
  engines: string[] | null
  reportingEngines: string[]
  /** Every count reads 0 for these engines, not because they are idle. */
  silentEngines: string[]
  runningInstances: number
  runningByDefinition: HealthCount[]
  openIncidents: number
  openIncidentsByType: HealthCount[]
  deadJobs: number
  executableJobs: number
  suspendedJobs: number
  openUserTasks: number
  unassignedUserTasks: number
  openExternalTasks: number
  deployedDefinitionKeys: number
  firingAlerts: HealthAlert[]
  pendingAlerts: HealthAlert[]
}

const first = (s: PromSample[]) => (s.length ? Math.round(s[0].value) : 0)
const total = (s: PromSample[]) => Math.round(s.reduce((sum, x) => sum + x.value, 0))

function counts(samples: PromSample[], label: string): HealthCount[] {
  return samples
    .map((s) => ({ label: s.metric[label] ?? "", count: Math.round(s.value) }))
    .filter((c) => c.count !== 0)
    .sort((a, b) => b.count - a.count)
}

function alerts(samples: PromSample[]): HealthAlert[] {
  return samples.map((s) => ({
    name: s.metric.alertname ?? "",
    severity: s.metric.severity ?? "",
    scope: s.metric.process_definition_key ?? s.metric.incident_type ?? s.metric.engine_id ?? "",
  }))
}

function alertsQuery(state: string, engine: EngineFilterInput, includeFleetAlerts: boolean) {
  const own = `alertname=~"${ENGINE_ALERT_NAME_PATTERN}"`
  const stateMatcher = `alertstate="${state}"`
  const engineSel = engineMatcher(engine)
  if (!engineSel) return `ALERTS${selector(stateMatcher, own)}`
  const scoped = `ALERTS${selector(stateMatcher, engineSel)}`
  return includeFleetAlerts
    ? `${scoped} or ALERTS${selector(stateMatcher, own, `engine_id=""`)}`
    : scoped
}

// Absence is not health: an engine that sends nothing reads `unknown` or lands in `silentEngines`, never `healthy`.
export async function engineHealth(
  ch: PrometheusClient,
  params: { engine?: EngineFilterInput; includeFleetAlerts?: boolean },
): Promise<EngineHealthResult> {
  const sel = selector(engineMatcher(params.engine))
  const fleet = params.includeFleetAlerts ?? engineIdsOf(params.engine) === null

  const [
    runningByDef,
    incidentsByType,
    deadJobs,
    executableByEngine,
    suspendedJobs,
    openTasks,
    unassignedTasks,
    externalByEngine,
    deployedKeys,
    firing,
    pending,
  ] = await Promise.all([
    ch.instant(`sum by (process_definition_key)(${engineState(M.processInstancesRunning, sel)})`),
    ch.instant(`sum by (incident_type)(${engineState(M.incidentsOpen, sel)})`),
    ch.instant(`sum(${engineState(M.jobsFailed, sel)})`),
    ch.instant(reportingEnginesQuery(sel)),
    ch.instant(`sum(${engineState(M.jobsSuspended, sel)})`),
    ch.instant(
      `sum(${engineState(M.userTasksOpen, selector(`status="total"`, engineMatcher(params.engine)))})`,
    ),
    ch.instant(
      `sum(${engineState(M.userTasksOpen, selector(`status="unassigned"`, engineMatcher(params.engine)))})`,
    ),
    ch.instant(engineState(M.externalTasksOpen, sel)),
    // Distinct keys, not series: a key deployed on two engines counts once.
    ch.instant(
      `count(count by (process_definition_key)(${engineState(M.processDefinitionsDeployed, sel)}))`,
    ),
    ch.instant(alertsQuery("firing", params.engine, fleet)),
    ch.instant(alertsQuery("pending", params.engine, fleet)),
  ])

  const runningByDefinition = counts(runningByDef, "process_definition_key")
  const openIncidentsByType = counts(incidentsByType, "incident_type")
  const firingAlerts = alerts(firing)
  const pendingAlerts = alerts(pending)

  const openIncidents = openIncidentsByType.reduce((s, c) => s + c.count, 0)
  const runningInstances = runningByDefinition.reduce((s, c) => s + c.count, 0)
  const dead = first(deadJobs)

  const engines = engineIdsOf(params.engine)
  const reportingEngines = [
    ...new Set(
      [...executableByEngine, ...externalByEngine]
        .map((s) => s.metric.engine_id)
        .filter((id): id is string => !!id),
    ),
  ].sort()
  const silentEngines = (engines ?? []).filter((id) => !reportingEngines.includes(id))

  const status: EngineHealthResult["status"] =
    reportingEngines.length === 0
      ? "unknown"
      : firingAlerts.some((a) => a.severity === "critical")
        ? "critical"
        : firingAlerts.length > 0 || dead > 0 || openIncidents > 0 || silentEngines.length > 0
          ? "degraded"
          : "healthy"

  return {
    status,
    statusRule: ENGINE_HEALTH_STATUS_RULE,
    engines,
    reportingEngines,
    silentEngines,
    runningInstances,
    runningByDefinition,
    openIncidents,
    openIncidentsByType,
    deadJobs: dead,
    executableJobs: total(executableByEngine),
    suspendedJobs: first(suspendedJobs),
    openUserTasks: first(openTasks),
    unassignedUserTasks: first(unassignedTasks),
    openExternalTasks: total(externalByEngine),
    deployedDefinitionKeys: first(deployedKeys),
    firingAlerts,
    pendingAlerts,
  }
}
