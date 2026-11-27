/**
 * The counts on a version's diagram (`getElementStatistics` of the engine contract): per element
 * the tokens waiting there, the incidents raised there and those copied up from a called
 * instance. A token held by an incident raised at its element counts as that incident, not as
 * active. Beside the contract's read, the same counts with each element's jobs without retries
 * (`withFailedJobs`), from the same one statistics read with `failedJobs`, for a surface that
 * shows both (the MCP server's process flow), so it reads a version's statistics once.
 *
 * Each count lies at an element of the diagram, as Camunda 8 reports it: Camunda 7 counts a
 * multi-instance body apart (`<id>#multiInstanceBody`, the token that waits at the body itself and
 * the incidents raised there, its failed job say, never beside the items it runs), and the reader
 * adds the body's counts to its activity's (`elementOfActivity`), so every surface that reads the
 * contract shows them on the activity. An incident that names no element counts at none.
 *
 * The statistics count every open incident of the version at its element, copies included. Camunda
 * 7 copies a called instance's incident only to the caller's call activity, so an element that is
 * no call activity holds root incidents alone and its count stands as the engine gives it. At a
 * call activity that holds incidents, the reader reads them whole to tell the root incidents (a
 * failed job before the call, say) from the copies (`isRootIncident`). A version without an
 * incident reads nothing more than its statistics, one with incidents its diagram's call
 * activities too, once per reader (a deployed version's XML never changes), its diagram through
 * the runtime's read (where the surface keeps diagrams, the diagram it keeps). Where they cannot be
 * told (a diagram that cannot be read, or read for sure), it reads the version's incidents whole,
 * and so it does where that read takes fewer requests than one per call activity and reads less
 * than a page of rows the statistics already counted.
 */

import { ElementId, type DefinitionId, type ElementStatistics } from "@miragon/pulse-engine-core"
import { elementOfActivity } from "../multi-instance-body.js"
import { type EnginePort, PARALLEL, type Query } from "../port.js"
import { isRootIncident } from "../root-incident.js"
import { mapLimit } from "../util.js"
import { callActivityIdsOf } from "./call-activity-tags.js"
import { type DiagramRead, diagramReadOf } from "./definition-rows.js"
import { engineIdOf } from "./engine-ids.js"
import { type IncidentRow, incidentRowsOf } from "./incident-rows.js"
import { JsonView } from "../json-view.js"
import { PAGE_SIZE, readAll } from "./read-all.js"

interface ElementCounts {
  active: number
  incidents: number
  incidentsInCalledInstances: number
  failedJobs: number
}

/** An element's counts on a version's diagram with its jobs without retries (`withFailedJobs`). */
export interface ElementStatisticsWithFailedJobs extends ElementStatistics {
  /** The jobs at the element whose retries are used up. */
  readonly failedJobs: number
}

interface ActivityRow {
  readonly activityId: string
  readonly instances: number
  readonly failedJobs: number
  /** The open incidents at the element, of every type, copies included. */
  readonly incidents: number
}

/**
 * The incidents read row by row: those of the elements in `read` (every element after a read of
 * the version's incidents), which the rows count instead of the statistics.
 */
interface IncidentRows {
  readonly read: ReadonlySet<string> | "every"
  readonly rows: readonly IncidentRow[]
}

/**
 * The incidents by their id, a unique order, so no row repeats on a later page or goes missing:
 * by time, incidents raised in the same millisecond (a mass failure's) come in no fixed order, and
 * an engine may page them so.
 */
const BY_ID = { sortBy: "incidentId", sortOrder: "asc" } as const

/** The versions whose call activities a reader keeps; past them the first kept one goes. */
const KEPT_VERSIONS = 64

/** Nothing read row by row: every count is the statistics'. */
const NONE: IncidentRows = { read: new Set(), rows: [] }

function incidentCountOf(row: JsonView): number {
  return row
    .optionalList("incidents")
    .reduce((sum, entry) => sum + entry.requiredNumber("incidentCount"), 0)
}

function activityRowsOf(answer: unknown): ActivityRow[] {
  return JsonView.listOf(answer, "activity statistics").map((row) => ({
    activityId: row.requiredString("id"),
    instances: row.requiredNumber("instances"),
    failedJobs: row.optionalNumber("failedJobs") ?? 0,
    incidents: incidentCountOf(row),
  }))
}

/** The requests `readAll` sends for `count` rows: a page holding fewer than 500 is the last. */
function pagesFor(count: number): number {
  return Math.floor(count / PAGE_SIZE) + 1
}

function sumOf(rows: readonly ActivityRow[], count: (row: ActivityRow) => number): number {
  return rows.reduce((sum, row) => sum + count(row), 0)
}

/**
 * Whether one read of every incident of a version costs less than a read per call activity that
 * holds one (`atCalls`, of `withIncidents`): fewer requests, and less than a page of rows the
 * statistics already counted (those at the other elements), so a mass failure at a task is never
 * read again to save a few reads of a row each.
 */
function wholeReadIsCheaper(
  withIncidents: readonly ActivityRow[],
  atCalls: readonly ActivityRow[],
): boolean {
  const total = sumOf(withIncidents, (row) => row.incidents)
  const atCallRows = sumOf(atCalls, (row) => row.incidents)
  const perCall = sumOf(atCalls, (row) => pagesFor(row.incidents))
  return pagesFor(total) < perCall && total - atCallRows < PAGE_SIZE
}

function countsFor(counts: Map<string, ElementCounts>, activityId: string): ElementCounts {
  const existing = counts.get(activityId)
  if (existing !== undefined) return existing
  const created = { active: 0, incidents: 0, incidentsInCalledInstances: 0, failedJobs: 0 }
  counts.set(activityId, created)
  return created
}

function countsOf(
  activities: readonly ActivityRow[],
  incidents: IncidentRows,
): Map<string, ElementCounts> {
  const counts = new Map<string, ElementCounts>()
  for (const element of activities) {
    const held = countsFor(counts, element.activityId)
    held.active = element.instances
    held.failedJobs = element.failedJobs
    if (incidents.read !== "every" && !incidents.read.has(element.activityId)) {
      held.incidents = element.incidents
    }
  }
  for (const incident of incidents.rows) {
    if (incident.activityId === undefined) continue
    const element = countsFor(counts, incident.activityId)
    if (isRootIncident(incident)) element.incidents += 1
    else element.incidentsInCalledInstances += 1
  }
  return counts
}

/**
 * The counts per element of the diagram from those per activity the engine reports: a
 * multi-instance body's added to the activity it repeats, each token held by an incident raised
 * where it waits counted as that incident.
 */
function onElements(counts: Map<string, ElementCounts>): ElementStatisticsWithFailedJobs[] {
  const byElement = new Map<string, ElementCounts>()
  for (const [activityId, held] of counts) {
    const element = countsFor(byElement, elementOfActivity(activityId))
    element.active += Math.max(0, held.active - held.incidents)
    element.incidents += held.incidents
    element.incidentsInCalledInstances += held.incidentsInCalledInstances
    element.failedJobs += held.failedJobs
  }
  return [...byElement].map(([elementId, held]) => ({ elementId: ElementId(elementId), ...held }))
}

/** Reads the counts on a version's diagram over the engine's port. */
export class ElementStatisticsReader {
  /** The call activities of each version read, by its id, in the order read. */
  private readonly callActivities = new Map<string, ReadonlySet<string>>()

  constructor(
    private readonly port: EnginePort,
    private readonly diagram: DiagramRead = diagramReadOf(port),
  ) {}

  /** The counts per element of the version `definitionId`; an id no engine assigns fails. */
  async of(definitionId: DefinitionId): Promise<ElementStatistics[]> {
    const counts = await this.read(definitionId, {})
    return counts.map(({ elementId, active, incidents, incidentsInCalledInstances }) => ({
      elementId,
      active,
      incidents,
      incidentsInCalledInstances,
    }))
  }

  /**
   * The counts per element of the version `definitionId` with each element's jobs without
   * retries, from one statistics read with `failedJobs`; an id no engine assigns fails.
   */
  withFailedJobs(definitionId: DefinitionId): Promise<ElementStatisticsWithFailedJobs[]> {
    return this.read(definitionId, { failedJobs: "true" })
  }

  private async read(
    definitionId: DefinitionId,
    statisticsQuery: Query,
  ): Promise<ElementStatisticsWithFailedJobs[]> {
    const id = engineIdOf(definitionId)
    const activities = activityRowsOf(
      await this.port.json("getActivityStatistics", {
        pathArgs: [id],
        query: { ...statisticsQuery, incidents: "true" },
      }),
    )
    const incidents = await this.incidentRows(id, activities)
    return onElements(countsOf(activities, incidents))
  }

  /**
   * The incidents the version `id` needs read row by row: none without an incident, those at its
   * call activities that hold one, else (call activities that cannot be told, or a read of the
   * version's incidents in fewer requests that reads less than a page of rows beyond theirs) the
   * version's.
   */
  private async incidentRows(
    id: string,
    activities: readonly ActivityRow[],
  ): Promise<IncidentRows> {
    const withIncidents = activities.filter((row) => row.incidents > 0)
    if (withIncidents.length === 0) return NONE
    const callActivities = await this.callActivitiesOf(id)
    if (callActivities === undefined) return this.everyIncident(id)
    const atCalls = withIncidents.filter((row) => callActivities.has(row.activityId))
    if (wholeReadIsCheaper(withIncidents, atCalls)) return this.everyIncident(id)
    const rows = await mapLimit(atCalls, PARALLEL, (row) =>
      this.incidents({ processDefinitionId: id, activityId: row.activityId }),
    )
    return { read: new Set(atCalls.map((row) => row.activityId)), rows: rows.flat() }
  }

  /**
   * The call activities of the version `id`, kept once read; undefined where they cannot be told,
   * its diagram's read failing too: the counts never need the diagram, a read of every incident
   * gives them as exactly.
   */
  private async callActivitiesOf(id: string): Promise<ReadonlySet<string> | undefined> {
    const kept = this.callActivities.get(id)
    if (kept !== undefined) return kept
    const xml = await this.diagram(id).catch(() => undefined)
    const read = callActivityIdsOf(xml)
    if (read === undefined) return undefined
    const [first = id] = this.callActivities.keys()
    if (this.callActivities.size >= KEPT_VERSIONS) this.callActivities.delete(first)
    this.callActivities.set(id, read)
    return read
  }

  private async everyIncident(id: string): Promise<IncidentRows> {
    return { read: "every", rows: await this.incidents({ processDefinitionId: id }) }
  }

  private async incidents(query: Query): Promise<IncidentRow[]> {
    return incidentRowsOf(await readAll(this.port, "getIncidents", { ...query, ...BY_ID }))
  }
}
