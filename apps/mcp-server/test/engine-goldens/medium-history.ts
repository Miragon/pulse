import type { EngineReply } from "./fake-engines.js"
import type { WorldRequest, WorldRoute } from "./medium-engines.js"
import {
  type Fact,
  incidentTake,
  namedIds,
  type NamedCut,
  namedSegments,
  orMissing,
  Params,
  runningOf,
  runningSegments,
  type Take,
  versionsOf,
} from "./medium-query.js"
import {
  activityRows,
  historicEndedRow,
  historicRunningRow,
  incidentRow,
  type Instance,
  pathOf,
  stateOfInstance,
  stepsOf,
  taskRow,
  variableRows,
} from "./medium-rows.js"
import { type Segment, type TimeBound, total, within } from "./medium-segments.js"
import {
  ELEMENT_OF,
  ENDED_ID,
  idKeyOf,
  type MediumWorld,
  type State,
  TIMES,
  type Version,
} from "./medium-world.js"

/**
 * The history of the medium engine (medium-world.ts): every running instance as an active one and
 * each version's ended instances, completed an hour after they started, with the activities,
 * incidents, user tasks and variables of the running ones, each list and its count from the same
 * segments (medium-segments.ts) and each list in the order a read asks for where its keys hold it.
 */

const json = (body: unknown): EngineReply => ({ body })

/** The elements an ended instance passed: all of its diagram's. */
const passedBy = (version: Version) => [
  "start",
  "review",
  ...(version.caller ? ["callBilling"] : []),
  "charge",
  "notify",
  "end",
]

/** The ended instances of `version`, `count` of them from the number `from` on. */
function endedSegment(world: MediumWorld, version: Version, from = 0, count = version.ended) {
  const end = (j: number) => TIMES.ended(version, from + j)
  return {
    count,
    row: (j: number) => historicEndedRow(world, version, from + j),
    keys: {
      start: (j: number) => end(j) - TIMES.duration,
      end,
      duration: () => TIMES.duration,
      id: (j: number) => idKeyOf(version, from + j, true),
    },
  } satisfies Segment
}

function bounds(params: Params): TimeBound[] {
  const pairs = [
    ["start", "startedAfter", "startedBefore"],
    ["end", "finishedAfter", "finishedBefore"],
  ] as const
  return pairs.flatMap(([time, after, before]) => {
    const from = params.date(after)
    const to = params.date(before)
    return from === undefined && to === undefined ? [] : [{ time, after: from, before: to }]
  })
}

/** The running instances a history read takes: by the element they wait at, by incident. */
function runningTake(params: Params) {
  const active = params.list("activityIdIn")
  const executed = params.list("executedActivityIdIn")
  const incident = params.flag("withIncidents") || params.get("incidentStatus") === "open"
  return ({ state, copy }: Fact) =>
    (active === undefined || active.includes(ELEMENT_OF[state])) &&
    (executed === undefined || executed.includes(ELEMENT_OF[state])) &&
    (!incident || copy || state === "chargeFailed" || state === "notifyFailed")
}

/** Whether a history read takes the ended instances of `version`. */
function takesEnded(params: Params, version: Version): boolean {
  const executed = params.list("executedActivityIdIn")
  return (
    !params.flag("unfinished") &&
    params.list("activityIdIn") === undefined &&
    !params.flag("withIncidents") &&
    params.get("incidentStatus") === undefined &&
    (executed === undefined || executed.every((element) => passedBy(version).includes(element)))
  )
}

/** The history's rows of running instances: the segments' keys stay theirs. */
const asHistory = (world: MediumWorld, segment: Segment<Instance>): Segment => ({
  ...segment,
  row: (j) => historicRunningRow(world, segment.row(j)),
})

/** The history's instances a read takes. */
function historicSegments(world: MediumWorld, params: Params): Segment[] {
  const ids = namedIds(world, params)
  const versions = versionsOf(world, params)
  const timeBounds = bounds(params)
  const finished = params.flag("finished")
  if (ids) {
    const cut = { versions, bounds: timeBounds }
    const running = finished ? [] : namedSegments(world, ids, runningTake(params), cut)
    const ended = [...new Set(ids)].flatMap((id) => endedOf(world, id, params, cut))
    return [...running.map((segment) => asHistory(world, segment)), ...ended]
  }
  return versions.flatMap((version) => {
    const running = finished ? [] : runningSegments(world, version, runningTake(params))
    const ended = takesEnded(params, version) ? [endedSegment(world, version)] : []
    return [...running.map((segment) => asHistory(world, segment)), ...ended].map((segment) =>
      within(segment, timeBounds),
    )
  })
}

/** The ended instance an id names: its version and number; undefined for none. */
function endedAt(world: MediumWorld, id: string) {
  const match = ENDED_ID.exec(id)
  const version = match ? world.versionAt(Number(match[1]), Number(match[2])) : undefined
  const m = Number(match?.[3])
  return version && m < version.ended ? { version, m } : undefined
}

/** The ended instance an id names, where a read takes it: of its versions, within its bounds. */
function endedOf(world: MediumWorld, id: string, params: Params, cut: NamedCut): Segment[] {
  const at = endedAt(world, id)
  if (!at || !takesEnded(params, at.version) || !cut.versions.includes(at.version)) return []
  return [within(endedSegment(world, at.version, at.m, 1), cut.bounds)]
}

/**
 * A list read of the history and its count, by GET and by POST, over the same segments; `sorts`
 * are the API's sorts and the segments' key each sorts by.
 */
function historyList(
  path: string,
  segments: (params: Params) => Segment[],
  sorts: Readonly<Record<string, string>> = {},
): WorldRoute[] {
  const page = (request: WorldRequest) => {
    const params = new Params(request)
    return json(params.page(segments(params), sorts))
  }
  const count = (request: WorldRequest) => json({ count: total(segments(new Params(request))) })
  return [
    { method: "GET", template: path, answer: page },
    { method: "POST", template: path, answer: page },
    { method: "GET", template: `${path}/count`, answer: count },
    { method: "POST", template: `${path}/count`, answer: count },
  ]
}

const STATES: readonly State[] = [
  "review",
  "called",
  "chargeFailed",
  "charge",
  "notify",
  "notifyFailed",
]

/**
 * What a read of the running instances' history takes of each instance it takes: `width` rows by
 * its state, and the keys of its row `part` by the keys of its instance's segment.
 */
interface Parts {
  readonly take: Take
  readonly width: (state: State) => number
  readonly keys: (instances: Segment<Instance>, state: State, part: number) => Segment["keys"]
}

/** The instances a read of their history's parts takes, each segment one state's. */
function partTaken(world: MediumWorld, params: Params, take: Take) {
  const ids = namedIds(world, params)
  const versions = versionsOf(world, params)
  if (ids) {
    return namedSegments(world, ids, take, { versions, bounds: [] }).map((segment) => ({
      state: stateOfInstance(world, segment.row(0)),
      segment,
    }))
  }
  if (params.flag("finished")) return []
  return versions.flatMap((version) =>
    STATES.flatMap((state) =>
      runningSegments(world, version, (fact) => fact.state === state && take(fact)).map(
        (segment) => ({ state, segment }),
      ),
    ),
  )
}

/**
 * The parts of the running instances' history a read takes (their activities, incidents, user
 * tasks, variables), made by `rows`: of the instances the read names, else of every version's,
 * one segment for each part of each segment of instances, so the keys of each are monotone.
 */
function partsOf(
  world: MediumWorld,
  params: Params,
  parts: Parts,
  rows: (instance: Instance) => readonly unknown[],
): Segment[] {
  return partTaken(world, params, parts.take).flatMap(({ state, segment }) =>
    Array.from({ length: parts.width(state) }, (_, part): Segment => ({
      count: segment.count,
      row: (j) => rows(segment.row(j))[part],
      keys: parts.keys(segment, state, part),
    })),
  )
}

/** The elements in the text order of the ids of their activity instances (`<element>:<id>`). */
const ELEMENT_PLACES = new Map(
  ["start", "review", "callBilling", "charge", "notify", "end"]
    .sort((left, right) => (left < right ? -1 : 1))
    .map((element, place) => [element, place]),
)

/** The keys of an instance's step `part` in `state`: its start, its place, its id's place. */
function stepKeys(instances: Segment<Instance>, state: State, part: number): Segment["keys"] {
  const element = ELEMENT_PLACES.get(stepsOf(state)[part])!
  return {
    start: (j) => instances.keys.start(j) + part * TIMES.step,
    occurrence: () => part,
    id: (j) => element * 1e11 + instances.keys.id(j),
  }
}

/** The keys of a part that is the instance's one row of its kind: the instance's. */
const ownKeys = (instances: Segment<Instance>) => instances.keys

/** The incident of an instance the read took for holding one, as the history holds it. */
function historicIncidentRow(world: MediumWorld, instance: Instance) {
  const incident = incidentRow(world, instance)!
  return {
    ...incident,
    processDefinitionKey: instance.version.key,
    createTime: incident.incidentTimestamp,
    endTime: null,
    removalTime: null,
    rootProcessInstanceId: incident.processInstanceId,
    historyConfiguration: null,
    open: true,
    deleted: false,
    resolved: false,
  }
}

function historicTaskRow(world: MediumWorld, instance: Instance) {
  const task = taskRow(world, instance)
  return {
    ...task,
    processDefinitionKey: instance.version.key,
    startTime: task.created,
    endTime: null,
    duration: null,
    deleteReason: null,
    activityInstanceId: `review:${task.processInstanceId}`,
    rootProcessInstanceId: task.processInstanceId,
    removalTime: null,
  }
}

/** A version's numbers per element in the history: what runs there and what passed it. */
function historicElementStatistics(world: MediumWorld, version: Version, params: Params) {
  const after = params.date("startedAfter")
  const bound = after === undefined ? [] : [{ time: "start", after }]
  const running = (take: (state: State) => boolean) =>
    total(
      runningSegments(world, version, ({ state }) => take(state)).map((segment) =>
        within(segment, bound),
      ),
    )
  const ended = total([within(endedSegment(world, version), bound)])
  const finished = params.flag("finished")
  // Nothing was canceled: a count of the canceled ones is 0, asked or not.
  params.flag("canceled")
  return passedBy(version).map((element) => ({
    id: element,
    instances: running((state) => ELEMENT_OF[state] === element),
    finished: finished ? running((state) => pathOf(state).includes(element)) + ended : 0,
    canceled: 0,
    completeScope: element === "end" ? ended : 0,
    openIncidents: 0,
    resolvedIncidents: 0,
    deletedIncidents: 0,
  }))
}

/** Every route of the medium engine's history. */
export function historyRoutes(world: MediumWorld): WorldRoute[] {
  return [
    ...historyList("/history/process-instance", (params) => historicSegments(world, params), {
      instanceId: "id",
      startTime: "start",
      endTime: "end",
      duration: "duration",
    }),
    ...historyList(
      "/history/activity-instance",
      (params) =>
        partsOf(
          world,
          params,
          { take: () => true, width: (state) => stepsOf(state).length, keys: stepKeys },
          (instance) => activityRows(world, instance),
        ),
      { startTime: "start", occurrence: "occurrence", activityInstanceId: "id" },
    ),
    ...historyList(
      "/history/incident",
      (params) =>
        partsOf(
          world,
          params,
          { take: incidentTake(params), width: () => 1, keys: ownKeys },
          (instance) => [historicIncidentRow(world, instance)],
        ),
      { createTime: "incident", incidentId: "id" },
    ),
    ...historyList("/history/task", (params) =>
      partsOf(
        world,
        params,
        { take: ({ state }) => state === "review", width: () => 1, keys: ownKeys },
        (instance) => [historicTaskRow(world, instance)],
      ),
    ),
    ...historyList("/history/variable-instance", (params) =>
      partsOf(world, params, { take: () => true, width: () => 4, keys: () => ({}) }, variableRows),
    ),
    {
      method: "GET",
      template: "/history/process-definition/{id}/statistics",
      answer: (request, { id }) =>
        orMissing(id, world.byId.get(id), (version) =>
          json(historicElementStatistics(world, version, new Params(request))),
        ),
    },
    {
      method: "GET",
      template: "/history/process-instance/{id}",
      answer: (_, { id }) => {
        const running = runningOf(world, id)
        const ended = endedAt(world, id)
        const found = running
          ? historicRunningRow(world, running)
          : ended && historicEndedRow(world, ended.version, ended.m)
        return orMissing(id, found, json)
      },
    },
  ]
}
