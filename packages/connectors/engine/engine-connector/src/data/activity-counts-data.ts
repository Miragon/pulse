import type { Client } from "@miragon/pulse-c7-client"
import { getTasks, getTasksCount } from "@miragon/pulse-c7-client/sdk"
import { elementOfActivity, isRootIncident, mapLimit, PARALLEL } from "@miragon/pulse-c7-core"
import { DiagramBadges } from "@miragon/pulse-board/builder"
import { ElementId } from "@miragon/pulse-engine-core"
import {
  DiagramDecorations,
  type ElementBadgeData,
  type ElementDecorationData,
} from "@miragon/pulse-screens"
import { bpmnProcessNameOf, readBpmnNames } from "@miragon/pulse-widget-shell/server"
import { bpmnActivityIds, bpmnUserTaskIds } from "../lib/bpmn/bpmn-parse.js"
import { createCallerCache } from "../lib/engine/per-engine.js"
import { boundFailureText } from "../lib/mcp/failure-text.js"
import { placeOnDiagram } from "./activity-diagram.js"
import {
  type DefinitionVersion,
  fetchDefinitionVersions,
  fetchDefinitionXml,
  unknownKeyError,
} from "./definition-info.js"
import { type ElementCounts, readElementCounts } from "./element-counts.js"
import { countOf, optional, rowsOf } from "./engine-reads.js"
import { fetchRootCauses, type IncidentRow, scanIncidents } from "./incident-scan.js"
import { SCREEN_FLOOR_MS } from "./screens/screen-floor.js"

/**
 * A key's counts per activity (`engine_activity_counts`), the element counts the cockpit reads too:
 * with no version, every deployed version of the key in every tenant summed onto its newest
 * version's diagram (the process flow's "Running" sums one process's, a key in one tenant, so the
 * two agree on an engine without tenants); with one, that version's on its own diagram, as the web
 * app's process screen reads it. Per element the tokens without those a root incident raised there holds, the
 * open root incidents raised there and, apart, the incidents of the instances it called, its jobs
 * without retries (`readElementCounts`, on its floor of 30 s per caller), and its open user tasks
 * with the oldest (a count per user task that holds a token). The decorations are the screens'
 * diagram form (`DiagramDecorations` over `DiagramBadges`, an incident inside a collapsed
 * subprocess on its shape too) without call links. No XML: the definition id names the diagram.
 */

/** An incident's message and when it was raised. */
interface IncidentNote {
  message: string | null
  at: string
}

export interface ActivityCountsRow {
  activityId: string
  /** Its name in the diagram counted on; null where the diagram does not name it. */
  name: string | null
  /** False where only another version has it; null where the diagram could not be read. */
  inDiagram: boolean | null
  running: number
  openTasks: number
  /** When its oldest open task was created; null without one. */
  oldestOpenTask: string | null
  /** Open root incidents raised here. */
  incidents: number
  /** Open incidents of the instances it called: copies, counted in the called process. */
  incidentsInCalledInstances: number
  failedJobs: number
  /**
   * The newest of its incidents of each kind; null where it holds none, or where its newest lies
   * past the newest 200 incidents of the process (`INCIDENT_SCAN_LIMIT`), as in the cockpit.
   */
  latestIncident: IncidentNote | null
  /** Its message is the called instance's root incident's, which the copy stands for. */
  latestIncidentInCalledInstances: IncidentNote | null
}

export interface ActivityCountsData {
  engine: string
  processDefinitionKey: string
  processDefinitionName: string | null
  asOf: string
  /** The version whose diagram the counts go on: the one asked for, else the latest. */
  definitionId: string
  version: number
  /** The versions summed: the one asked for, else every deployed version. */
  versionsCounted: number
  decorations: ElementDecorationData[]
  activities: ActivityCountsRow[]
}

export interface ActivityCountsArgs {
  processDefinitionKey: string
  version?: number
}

/** The answers kept per engine and caller at most; past it the caller's least recently used one goes. */
const COUNTS_FLOOR_ENTRIES = 4

/**
 * Callers whose answers an engine keeps; past it the least recently active caller's go. Per engine
 * at most COUNTS_FLOOR_CALLERS × COUNTS_FLOOR_ENTRIES (128) answers.
 */
const COUNTS_FLOOR_CALLERS = 32

/**
 * The floor under the counts: a caller's same call within SCREEN_FLOOR_MS (30 s) gets the answer
 * read before, as the element counts under it do (`readElementCounts`). Per engine client and
 * CALLER; a failed read is not kept.
 */
const countsFloor = createCallerCache<ActivityCountsData>({
  maxEntries: COUNTS_FLOOR_ENTRIES,
  maxCallers: COUNTS_FLOOR_CALLERS,
  ttlMs: SCREEN_FLOOR_MS,
  now: () => Date.now(),
})

/** The version `version` of the key, newest tenant first; a number not deployed is refused. */
function versionOf(
  versions: readonly DefinitionVersion[],
  key: string,
  version: number,
): DefinitionVersion {
  const found = versions.find((candidate) => candidate.version === version)
  if (found !== undefined) return found
  const numbers = versions.map((candidate) => candidate.version).join(", ")
  throw new Error(
    `Version ${version} of process definition key "${key}" is not deployed on this engine ` +
      `(its versions: ${numbers}).`,
  )
}

/**
 * Whether open tasks can wait at `activityId`: a user task of the diagram, or an element the
 * diagram cannot tell (unread, or only another version has it).
 */
function mayHoldTasks(xml: string | null): (activityId: string) => boolean {
  if (xml === null) return () => true
  const userTasks = new Set(bpmnUserTaskIds(xml))
  const drawn = new Set(bpmnActivityIds(xml))
  return (activityId) => userTasks.has(activityId) || !drawn.has(activityId)
}

interface OpenTasks {
  count: number
  oldest: string | null
}

/** The open tasks at `activityId` in `scope`: their count, and the oldest's creation where any. */
async function openTasksAt(
  client: Client,
  scope: Record<string, string>,
  activityId: string,
): Promise<OpenTasks> {
  const query = { ...scope, taskDefinitionKey: activityId }
  const count = await getTasksCount({ client, query }).then(countOf)
  if (count === 0) return { count, oldest: null }
  const [oldest] = rowsOf<{ created?: string | null }>(
    await getTasks({
      client,
      query: { ...query, sortBy: "created", sortOrder: "asc", maxResults: 1 },
    }),
  )
  return { count, oldest: oldest?.created ?? null }
}

interface LatestIncidents {
  own?: IncidentRow
  called?: IncidentRow
}

/**
 * Per element, the newest incident of each kind the scan (newest first) holds, one at a
 * multi-instance body at the activity it repeats, where the counts lie (`elementOfActivity`).
 */
function latestIncidents(rows: readonly IncidentRow[]): Map<string, LatestIncidents> {
  const latest = new Map<string, LatestIncidents>()
  for (const row of rows) {
    const element = elementOfActivity(row.activityId)
    const rowsOfElement = latest.get(element) ?? {}
    rowsOfElement[isRootIncident(row) ? "own" : "called"] ??= row
    latest.set(element, rowsOfElement)
  }
  return latest
}

/** An incident's note: its message (a copy's, which holds none, its root incident's) and time. */
function noteOf(
  row: IncidentRow | undefined,
  message: string | null | undefined,
): IncidentNote | null {
  if (row === undefined) return null
  return { message: message ? boundFailureText(message) : null, at: row.incidentTimestamp }
}

/** A row's figures: the element's counts and its open tasks (none where none were counted). */
function countsOf(counts: ElementCounts, open: OpenTasks | undefined) {
  return {
    running: counts.active,
    openTasks: open?.count ?? 0,
    oldestOpenTask: open?.oldest ?? null,
    incidents: counts.incidents,
    incidentsInCalledInstances: counts.incidentsInCalledInstances,
    failedJobs: counts.failedJobs,
  }
}

const holdsAny = (counts: ElementCounts) =>
  counts.active + counts.incidents + counts.incidentsInCalledInstances + counts.failedJobs > 0

async function readActivityCounts(
  client: Client,
  engineId: string,
  args: ActivityCountsArgs,
  nowMs: number,
): Promise<ActivityCountsData> {
  const key = args.processDefinitionKey
  // Primary: an unknown key is a not-found error, never a view of zeros.
  const versions = await fetchDefinitionVersions(client, key)
  const latest = versions[0]
  if (latest === undefined) throw unknownKeyError(key)
  const diagram = args.version === undefined ? latest : versionOf(versions, key, args.version)
  const counted = args.version === undefined ? versions : [diagram]
  const scope: Record<string, string> =
    args.version === undefined ? { processDefinitionKey: key } : { processDefinitionId: diagram.id }

  const [elements, xml] = await Promise.all([
    readElementCounts(
      client,
      counted.map((version) => version.id),
    ),
    // Enrichment: an unread diagram names nothing and rolls nothing up to a collapsed shape.
    optional(fetchDefinitionXml(client, diagram.id)),
  ])
  const held = [...elements].filter(([, counts]) => holdsAny(counts))
  const withIncidents = held.some(
    ([, counts]) => counts.incidents + counts.incidentsInCalledInstances > 0,
  )
  const tasksAt = mayHoldTasks(xml)
  const taskElements = held.filter(([id, counts]) => counts.active > 0 && tasksAt(id))
  const [scan, tasks] = await Promise.all([
    // Enrichment: the newest incidents name each element's latest; unread, they are unknown.
    withIncidents
      ? optional(
          scanIncidents(
            client,
            args.version === undefined
              ? { processDefinitionKeyIn: key }
              : { processDefinitionId: diagram.id },
          ),
        )
      : Promise.resolve(null),
    mapLimit(taskElements, PARALLEL, ([id]) => openTasksAt(client, scope, id)),
  ])
  const tasksBy = new Map(taskElements.map(([id], i) => [id, tasks[i]]))
  const latestBy = latestIncidents(scan?.rows ?? [])
  // Enrichment: a copy holds no message; its root incident's, each read once, names the failure.
  const copies = [...latestBy.values()].flatMap(({ called }) => (called ? [called] : []))
  const roots = copies.length === 0 ? null : await optional(fetchRootCauses(client, copies))
  const place = placeOnDiagram(xml)
  const activities: ActivityCountsRow[] = held
    .map(([activityId, counts]) => {
      const { activityName, inDiagram } = place(activityId)
      const { own, called } = latestBy.get(activityId) ?? {}
      const open = tasksBy.get(activityId)
      return {
        activityId,
        name: activityName,
        inDiagram,
        ...countsOf(counts, open),
        latestIncident: counts.incidents > 0 ? noteOf(own, own?.incidentMessage) : null,
        latestIncidentInCalledInstances:
          counts.incidentsInCalledInstances > 0
            ? noteOf(called, roots?.get(called?.id ?? "")?.message)
            : null,
      }
    })
    .sort(
      (a, b) =>
        b.running - a.running ||
        b.incidents - a.incidents ||
        b.incidentsInCalledInstances - a.incidentsInCalledInstances ||
        a.activityId.localeCompare(b.activityId, "en"),
    )
  const statistics = activities.map((row) => ({
    elementId: ElementId(row.activityId),
    active: row.running,
    incidents: row.incidents,
    incidentsInCalledInstances: row.incidentsInCalledInstances,
  }))
  const badges: ElementBadgeData[] = DiagramBadges.of(xml ?? "", statistics).map((badge) => ({
    elementId: badge.elementId,
    running: badge.active,
    incidents: badge.incidents,
    incidentsInCalledInstances: badge.incidentsInCalledInstances,
  }))
  return {
    engine: engineId,
    processDefinitionKey: key,
    processDefinitionName: diagram.name ?? bpmnProcessNameOf(readBpmnNames(xml ?? ""), key),
    asOf: new Date(nowMs).toISOString(),
    definitionId: diagram.id,
    version: diagram.version,
    versionsCounted: counted.length,
    decorations: DiagramDecorations.of({ badges, calls: [] }),
    activities,
  }
}

/** The counts of `args` on the engine behind `client`, kept for 30 s per caller and arguments. */
export function buildActivityCountsData(
  client: Client,
  engineId: string,
  args: ActivityCountsArgs,
  nowMs?: number,
): Promise<ActivityCountsData> {
  const id = JSON.stringify([args.processDefinitionKey, args.version ?? null])
  return countsFloor(client, id, () =>
    readActivityCounts(client, engineId, args, nowMs ?? Date.now()),
  )
}
