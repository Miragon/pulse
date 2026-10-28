import {
  engineMatcher,
  selector,
  type EngineFilterInput,
  type PrometheusClient,
  type PromSample,
} from "../prometheus.js"
import { METRIC_NAMES as M, type GaugeName } from "../metric-names.js"
import { asOfNow, engineState } from "./helpers.js"

const byKey = (gauge: GaugeName, sel: string) =>
  `sum by (engine_id, process_definition_key)(${engineState(gauge, sel)})`

export interface EngineLandscapeEngine {
  engineId: string
  /** `false` needs the expected engine ids: a silent engine is otherwise indistinguishable from none. */
  reporting: boolean
  runningInstances: number | null
  openIncidents: number | null
  failedJobs: number | null
  executableJobs: number | null
  suspendedJobs: number | null
  jobsDueFuture: number | null
  openExternalTasks: number | null
  deployedDefinitionKeys: number | null
  exclusiveDefinitionKeys: number | null
}

export interface EngineLandscapeProcess {
  processDefinitionKey: string
  engineIds: string[]
  shared: boolean
  runningByEngine: Record<string, number>
  runningTotal: number
  openIncidentsTotal: number
  failedJobsTotal: number
}

export interface EngineLandscapeResult {
  engines: EngineLandscapeEngine[]
  processes: EngineLandscapeProcess[]
  sharedProcessKeys: string[]
  totals: {
    engineCount: number
    reportingEngineCount: number
    processKeyCount: number
    sharedProcessKeyCount: number
    runningInstances: number | null
    openIncidents: number | null
    failedJobs: number | null
  }
  /** Optional: payloads recorded before it existed lack it. */
  asOf?: string
}

interface Cell {
  engineId: string
  processDefinitionKey: string
  value: number
}

export async function engineLandscape(
  ch: PrometheusClient,
  params: { engine?: EngineFilterInput } = {},
): Promise<EngineLandscapeResult> {
  const asOf = asOfNow()
  const sel = selector(engineMatcher(params.engine))

  const [
    deployed,
    running,
    incidents,
    failedJobs,
    executable,
    suspended,
    dueFuture,
    externalTasks,
  ] = await Promise.all([
    ch.instant(byKey(M.processDefinitionsDeployed, sel)),
    ch.instant(byKey(M.processInstancesRunning, sel)),
    ch.instant(byKey(M.incidentsOpen, sel)),
    ch.instant(byKey(M.jobsFailed, sel)),
    ch.instant(engineState(M.jobsExecutable, sel)),
    ch.instant(engineState(M.jobsSuspended, sel)),
    ch.instant(engineState(M.jobsDueFuture, sel)),
    ch.instant(engineState(M.externalTasksOpen, sel)),
  ])

  const deployedCells = cells(deployed)
  const runningCells = cells(running)
  const incidentCells = cells(incidents)
  const failedCells = cells(failedJobs)
  // Live state counts as presence: an undeployed key with running instances must stay in the matrix.
  const presence = [...deployedCells, ...runningCells, ...incidentCells, ...failedCells]

  const reporting = new Set(
    [deployed, running, incidents, failedJobs, executable, suspended, dueFuture, externalTasks]
      .flat()
      .map((s) => s.metric.engine_id)
      .filter((id): id is string => !!id),
  )
  const engineIds = [...new Set([...expectedEngineIds(params.engine), ...reporting])].sort()

  const keysOn = (engineId: string): string[] => [
    ...new Set(presence.filter((c) => c.engineId === engineId).map((c) => c.processDefinitionKey)),
  ]
  const enginesWithKey = (key: string): string[] =>
    [
      ...new Set(presence.filter((c) => c.processDefinitionKey === key).map((c) => c.engineId)),
    ].sort()

  const engines: EngineLandscapeEngine[] = engineIds.map((engineId) => {
    if (!reporting.has(engineId)) return silentEngine(engineId)
    const keys = keysOn(engineId)
    return {
      engineId,
      reporting: true,
      runningInstances: sumBy(runningCells, (c) => c.engineId === engineId),
      openIncidents: sumBy(incidentCells, (c) => c.engineId === engineId),
      failedJobs: sumBy(failedCells, (c) => c.engineId === engineId),
      executableJobs: engineValue(executable, engineId),
      suspendedJobs: engineValue(suspended, engineId),
      jobsDueFuture: engineValue(dueFuture, engineId),
      openExternalTasks: engineValue(externalTasks, engineId),
      deployedDefinitionKeys: keys.length,
      exclusiveDefinitionKeys: keys.filter((k) => enginesWithKey(k).length === 1).length,
    }
  })

  const processes: EngineLandscapeProcess[] = [
    ...new Set(presence.map((c) => c.processDefinitionKey)),
  ]
    .map((processDefinitionKey) => {
      const on = enginesWithKey(processDefinitionKey)
      const runningByEngine: Record<string, number> = {}
      for (const engineId of on) {
        const value = sumBy(
          runningCells,
          (c) => c.engineId === engineId && c.processDefinitionKey === processDefinitionKey,
        )
        if (value !== 0) runningByEngine[engineId] = value
      }
      const forKey = (list: Cell[]) =>
        sumBy(list, (c) => c.processDefinitionKey === processDefinitionKey)
      return {
        processDefinitionKey,
        engineIds: on,
        shared: on.length > 1,
        runningByEngine,
        runningTotal: forKey(runningCells),
        openIncidentsTotal: forKey(incidentCells),
        failedJobsTotal: forKey(failedCells),
      }
    })
    .sort(
      (a, b) =>
        Number(b.shared) - Number(a.shared) ||
        b.runningTotal - a.runningTotal ||
        a.processDefinitionKey.localeCompare(b.processDefinitionKey),
    )

  const sharedProcessKeys = processes.filter((p) => p.shared).map((p) => p.processDefinitionKey)
  const reportingEngineCount = engines.filter((e) => e.reporting).length
  const total = (list: Cell[]) => (reportingEngineCount > 0 ? sumBy(list, () => true) : null)

  return {
    asOf,
    engines,
    processes,
    sharedProcessKeys,
    totals: {
      engineCount: engines.length,
      reportingEngineCount,
      processKeyCount: processes.length,
      sharedProcessKeyCount: sharedProcessKeys.length,
      runningInstances: total(runningCells),
      openIncidents: total(incidentCells),
      failedJobs: total(failedCells),
    },
  }
}

// A row of zeros would read as an idle, healthy engine.
function silentEngine(engineId: string): EngineLandscapeEngine {
  return {
    engineId,
    reporting: false,
    runningInstances: null,
    openIncidents: null,
    failedJobs: null,
    executableJobs: null,
    suspendedJobs: null,
    jobsDueFuture: null,
    openExternalTasks: null,
    deployedDefinitionKeys: null,
    exclusiveDefinitionKeys: null,
  }
}

function expectedEngineIds(engine: EngineFilterInput): string[] {
  if (engine === undefined || engine === null) return []
  const ids = Array.isArray(engine) ? engine : [engine]
  return ids.filter((id) => id.length > 0)
}

// `sum by (engine_id, process_definition_key)` yields one sample per pair, so `sumBy` adds across pairs only.
function cells(samples: PromSample[]): Cell[] {
  const out: Cell[] = []
  for (const s of samples) {
    const engineId = s.metric.engine_id
    const processDefinitionKey = s.metric.process_definition_key
    if (!engineId || !processDefinitionKey) continue
    out.push({ engineId, processDefinitionKey, value: Math.round(s.value) })
  }
  return out
}

const sumBy = (list: Cell[], match: (c: Cell) => boolean): number =>
  list.reduce((sum, c) => (match(c) ? sum + c.value : sum), 0)

const engineValue = (samples: PromSample[], engineId: string): number =>
  Math.round(samples.find((s) => s.metric.engine_id === engineId)?.value ?? 0)
