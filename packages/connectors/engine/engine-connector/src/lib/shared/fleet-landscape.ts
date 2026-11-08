import type { DefinitionStat, JobBacklogData } from "../../view-models.js"

/**
 * The cross-engine landscape, folded from each engine's own reads (CLAUDE.md, "Never aggregate a
 * RATE across engines"). Engines host different processes, so a rate or a duration summed over
 * engines would measure their process mix: every figure here is an absolute count, and a figure
 * over several engines is the plain sum of theirs. The backlog carries no process, so it alone is
 * compared engine by engine. The fold is pure; the widget reads the engines.
 */

/** What one engine answered; null until read, or when the read failed. */
export interface FleetEngineReads {
  engineId: string
  /** The engine overview's definitions: one row per key, counts over every version. */
  definitions: readonly DefinitionStat[] | null
  backlog: Omit<JobBacklogData, "engineId"> | null
}

/** One engine's row; every figure null while its read is missing, never a 0. */
export interface LandscapeEngine {
  engineId: string
  /** False while the engine's definitions are not read: no column of the matrix, no total. */
  read: boolean
  runningInstances: number | null
  openIncidents: number | null
  failedJobs: number | null
  executableJobs: number | null
  suspendedJobs: number | null
  jobsDueLater: number | null
  externalTasks: number | null
  definitionKeys: number | null
  /** Keys no other read engine deploys. */
  exclusiveDefinitionKeys: number | null
}

/** One process key across the engines that deploy it (of those read). */
interface LandscapeProcess {
  processDefinitionKey: string
  /** The first name an engine gives it, in the engines' order. */
  name: string | null
  engineIds: string[]
  shared: boolean
  /** Running instances on each engine that deploys the key. */
  runningByEngine: Record<string, number>
  runningTotal: number
  openIncidentsTotal: number
}

export interface FleetLandscapeFigures {
  engines: LandscapeEngine[]
  /** Shared keys first, then by running instances; never by a rate. */
  processes: LandscapeProcess[]
  totals: {
    engineCount: number
    /** The engines whose definitions are read; below `engineCount` every total is a lower bound. */
    readEngineCount: number
    processKeyCount: number
    sharedProcessKeyCount: number
    /** Sums over the read engines; null while none is read. */
    runningInstances: number | null
    openIncidents: number | null
  }
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0)

const incidentsOf = (definition: DefinitionStat) =>
  sum(definition.incidents.map((incident) => incident.incidentCount))

interface ReadEngine {
  engineId: string
  definitions: readonly DefinitionStat[]
}

function processesOf(engines: readonly ReadEngine[]): LandscapeProcess[] {
  const byKey = new Map<string, LandscapeProcess>()
  for (const { engineId, definitions } of engines) {
    for (const definition of definitions) {
      const process = byKey.get(definition.key) ?? {
        processDefinitionKey: definition.key,
        name: null,
        engineIds: [],
        shared: false,
        runningByEngine: {},
        runningTotal: 0,
        openIncidentsTotal: 0,
      }
      process.name ??= definition.name
      process.engineIds.push(engineId)
      process.runningByEngine[engineId] = definition.instances
      process.runningTotal += definition.instances
      process.openIncidentsTotal += incidentsOf(definition)
      byKey.set(definition.key, process)
    }
  }
  return [...byKey.values()]
    .map((process) => ({ ...process, shared: process.engineIds.length > 1 }))
    .sort(
      (a, b) =>
        Number(b.shared) - Number(a.shared) ||
        b.runningTotal - a.runningTotal ||
        a.processDefinitionKey.localeCompare(b.processDefinitionKey),
    )
}

type BacklogFigures = Pick<
  LandscapeEngine,
  "executableJobs" | "suspendedJobs" | "jobsDueLater" | "externalTasks"
>

const NO_BACKLOG: BacklogFigures = {
  executableJobs: null,
  suspendedJobs: null,
  jobsDueLater: null,
  externalTasks: null,
}

function backlogOf(backlog: FleetEngineReads["backlog"]): BacklogFigures {
  if (backlog === null) return NO_BACKLOG
  const { executableJobs, suspendedJobs, jobsDueLater, externalTasks } = backlog
  return { executableJobs, suspendedJobs, jobsDueLater, externalTasks }
}

type LoadFigures = Omit<LandscapeEngine, "engineId" | "read" | keyof BacklogFigures>

const NO_LOAD: LoadFigures = {
  runningInstances: null,
  openIncidents: null,
  failedJobs: null,
  definitionKeys: null,
  exclusiveDefinitionKeys: null,
}

/** `enginesOf`: how many read engines deploy each key. */
function loadOf(
  definitions: FleetEngineReads["definitions"],
  enginesOf: ReadonlyMap<string, number>,
): LoadFigures {
  if (definitions === null) return NO_LOAD
  return {
    runningInstances: sum(definitions.map((d) => d.instances)),
    openIncidents: sum(definitions.map(incidentsOf)),
    failedJobs: sum(definitions.map((d) => d.failedJobs)),
    definitionKeys: definitions.length,
    exclusiveDefinitionKeys: definitions.filter((d) => enginesOf.get(d.key) === 1).length,
  }
}

function engineRow(
  { engineId, definitions, backlog }: FleetEngineReads,
  enginesOf: ReadonlyMap<string, number>,
): LandscapeEngine {
  return {
    engineId,
    read: definitions !== null,
    ...loadOf(definitions, enginesOf),
    ...backlogOf(backlog),
  }
}

/** Folds the engines' reads, in the engines' order, into the landscape's figures. */
export function foldFleetLandscape(reads: readonly FleetEngineReads[]): FleetLandscapeFigures {
  const read = reads.flatMap(({ engineId, definitions }) =>
    definitions === null ? [] : [{ engineId, definitions }],
  )
  const processes = processesOf(read)
  const enginesOf = new Map(processes.map((p) => [p.processDefinitionKey, p.engineIds.length]))
  const engines = reads.map((r) => engineRow(r, enginesOf))
  const total = (figure: (engine: LandscapeEngine) => number | null) =>
    read.length === 0 ? null : sum(engines.map((engine) => figure(engine) ?? 0))
  return {
    engines,
    processes,
    totals: {
      engineCount: reads.length,
      readEngineCount: read.length,
      processKeyCount: processes.length,
      sharedProcessKeyCount: processes.filter((p) => p.shared).length,
      runningInstances: total((engine) => engine.runningInstances),
      openIncidents: total((engine) => engine.openIncidents),
    },
  }
}
