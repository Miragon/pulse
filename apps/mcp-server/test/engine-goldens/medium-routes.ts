import type { EngineReply } from "./fake-engines.js"
import type { WorldRequest, WorldRoute } from "./medium-engines.js"
import { historyRoutes } from "./medium-history.js"
import {
  incidentTake,
  instantOf,
  incidentTypeOf,
  incidentActivityOf,
  namedIds,
  namedSegments,
  orMissing,
  Params,
  runningOf,
  runningSegments,
  type Take,
  versionsOf,
} from "./medium-query.js"
import {
  activityTree,
  assignedAt,
  definitionRow,
  diagramOf,
  externalTaskRow,
  incidentRow,
  type Instance,
  instanceRow,
  jobDefinitionRow,
  JOB_RETRIES,
  jobRow,
  stateOfInstance,
  taskRow,
  variableRows,
  variablesOf,
} from "./medium-rows.js"
import { type Segment, type TimeBound, total, within } from "./medium-segments.js"
import {
  ELEMENT_OF,
  engineDate,
  type MediumWorld,
  type State,
  type Version,
} from "./medium-world.js"

/**
 * The REST answers of the medium engine (medium-world.ts) at runtime: definitions and their
 * statistics, instances, incidents, jobs, user and external tasks, variables, each list and its
 * count from the same segments (medium-query.ts). The history's answers are medium-history.ts'.
 */

const json = (body: unknown): EngineReply => ({ body })
const counted = (segments: readonly Segment[]): EngineReply => json({ count: total(segments) })

/**
 * Every running instance's segments of the versions a read names that `take` takes, within the
 * read's time bounds. Nothing is suspended, so every instance and job is active.
 */
function segmentsOf(
  world: MediumWorld,
  params: Params,
  take: Take,
  bounds: readonly TimeBound[],
): Segment<Instance>[] {
  const versions = versionsOf(world, params)
  const ids = namedIds(world, params)
  params.flag("active")
  if (params.flag("suspended")) return []
  if (ids) return namedSegments(world, ids, take, { versions, bounds })
  return versions.flatMap((version) =>
    runningSegments(world, version, take).map((segment) => within(segment, bounds)),
  )
}

/** A bound of one time by two date parameters, none where neither is sent. */
function boundOf(params: Params, time: string, after: string, before: string): TimeBound[] {
  const from = params.date(after)
  const to = params.date(before)
  return from === undefined && to === undefined ? [] : [{ time, after: from, before: to }]
}

/**
 * A bound by a list of `gt_<date>` and `lt_<date>` (a job's `createTimes`, `dueDates`): none of
 * the world's jobs has a due date, so a bound on one takes none.
 */
function comparedBound(params: Params, name: string, time: string): TimeBound[] {
  const parts = params.list(name)?.map((part) => part.split("_")) ?? []
  const at = (operator: string) => {
    const date = parts.find(([op]) => op === operator)?.[1]
    return date === undefined ? undefined : instantOf(date)
  }
  return parts.length === 0 ? [] : [{ time, after: at("gt"), before: at("lt") }]
}

/** The instances `/process-instance` takes: by incident, element, business key. */
function instanceTake(params: Params): Take {
  const elements = params.list("activityIdIn")
  const type = params.get("incidentType")
  return (fact) =>
    (!params.flag("withIncident") || incidentTypeOf(fact) !== undefined) &&
    (type === undefined || incidentTypeOf(fact) === type) &&
    (elements === undefined || elements.includes(ELEMENT_OF[fact.state]))
}

/** The jobs a read takes: every instance at charge has one, failed for good or due. */
function jobTake(params: Params): Take {
  if (params.flag("timers") || params.flag("messages")) return () => false
  const failed = params.flag("noRetriesLeft") || params.flag("withException")
  const due = params.flag("withRetriesLeft") || params.flag("executable")
  return ({ state }) => (state === "chargeFailed" && !due) || (state === "charge" && !failed)
}

const taskTake = (params: Params): Take => {
  const assignee = params.get("assignee")
  const unassigned = params.flag("unassigned")
  const element = params.get("taskDefinitionKey")
  return ({ state, slot }) =>
    state === "review" &&
    (element === undefined || element === "review") &&
    (assignee === undefined || (assignee === "demo" && assignedAt(slot))) &&
    (!unassigned || !assignedAt(slot))
}

const externalTaskTake = (params: Params): Take => {
  if (params.flag("locked") || params.get("workerId") !== undefined) return () => false
  const failed = params.flag("noRetriesLeft")
  const left = params.flag("withRetriesLeft")
  return ({ state }) => (state === "notifyFailed" && !left) || (state === "notify" && !failed)
}

/** What a list read takes (its predicate and its time bounds), and how it sorts. */
interface Selection {
  take(params: Params): Take
  bounds?(params: Params): TimeBound[]
  /** The API's sorts and the segments' key each sorts by. */
  sorts?: Readonly<Record<string, string>>
  /**
   * The states of the rows the list holds, where one of its sorts reads a state's value (a job's
   * retries): its segments are then each one state's, with that state's keys.
   */
  byState?: Readonly<Partial<Record<State, Readonly<Record<string, number>>>>>
}

/** The segments of a list read: per state, with the state's keys, where the list sorts so. */
function selected(world: MediumWorld, params: Params, selection: Selection): Segment<Instance>[] {
  const take = selection.take(params)
  const bounds = selection.bounds?.(params) ?? []
  if (!selection.byState) return segmentsOf(world, params, take, bounds)
  return Object.entries(selection.byState).flatMap(([state, values]) =>
    segmentsOf(world, params, (fact) => fact.state === state && take(fact), bounds).map(
      (segment) => ({
        ...segment,
        keys: {
          ...segment.keys,
          ...Object.fromEntries(Object.entries(values).map(([name, value]) => [name, () => value])),
        },
      }),
    ),
  )
}

/** A list read and its count, by GET and by POST: `/<path>` and `/<path>/count`. */
function listed(
  world: MediumWorld,
  path: string,
  selection: Selection,
  row: (instance: Instance) => unknown,
): WorldRoute[] {
  const segments = (request: WorldRequest) => {
    const params = new Params(request)
    return { params, segments: selected(world, params, selection) }
  }
  const page = (request: WorldRequest) => {
    const { params, segments: found } = segments(request)
    return json(params.page(found, selection.sorts).map(row))
  }
  const count = (request: WorldRequest) => counted(segments(request).segments)
  return [
    { method: "GET", template: path, answer: page },
    { method: "POST", template: path, answer: page },
    { method: "GET", template: `${path}/count`, answer: count },
    { method: "POST", template: `${path}/count`, answer: count },
  ]
}

/**
 * The reads of one incident, job or user task by its id, the id of its instance behind one of
 * `prefixes`; a 404 for an id of none, or one whose instance holds no such object.
 */
function objectRoutes(world: MediumWorld): WorldRoute[] {
  const route = (
    template: string,
    prefixes: readonly string[],
    answer: (instance: Instance, id: string) => EngineReply | undefined,
  ): WorldRoute => ({
    method: "GET",
    template,
    answer: (_, { id }) => {
      const prefix = prefixes.find((candidate) => id.startsWith(candidate))
      const instance = prefix === undefined ? undefined : runningOf(world, id.slice(prefix.length))
      return orMissing(id, instance, (found) => answer(found, id))
    },
  })
  const job = (instance: Instance) =>
    ELEMENT_OF[stateOfInstance(world, instance)] === "charge" ? jobRow(world, instance) : undefined
  const task = (instance: Instance) =>
    stateOfInstance(world, instance) === "review" ? instance : undefined
  return [
    route("/incident/{id}", ["inc-"], (instance, id) => {
      const incident = incidentRow(world, instance)
      return incident?.id === id ? json(incident) : undefined
    }),
    route("/job/{id}/stacktrace", ["job-"], (instance) => {
      const failed = job(instance)?.exceptionMessage
      return failed ? { raw: stacktraceOf(failed), contentType: "text/plain" } : undefined
    }),
    route("/task/{id}", ["task-"], (instance) => task(instance) && json(taskRow(world, instance))),
    route(
      "/task/{id}/variables",
      ["task-"],
      (instance) => task(instance) && json(variablesOf(instance)),
    ),
  ]
}

const stacktraceOf = (message: string) =>
  [
    `org.cibseven.bpm.engine.ProcessEngineException: ${message}`,
    "\tat com.example.billing.ChargeDelegate.execute(ChargeDelegate.java:42)",
    "Caused by: com.example.payment.PaymentRefusedException: insufficient funds",
    "\tat com.example.payment.Gateway.charge(Gateway.java:17)",
    "",
  ].join("\n")

/** A version's numbers per element, as `/process-definition/{id}/statistics` answers them. */
function elementStatistics(world: MediumWorld, version: Version, params: Params) {
  const elements = ["review", "charge", "notify", ...(version.caller ? ["callBilling"] : [])]
  return elements.flatMap((element) => {
    const at = (take: Take) => total(runningSegments(world, version, take))
    const instances = at(({ state }) => ELEMENT_OF[state] === element)
    if (instances === 0) return []
    const types = ["failedJob", "failedExternalTask"].map((incidentType) => ({
      incidentType,
      incidentCount: at(
        (fact) => incidentActivityOf(fact) === element && incidentTypeOf(fact) === incidentType,
      ),
    }))
    return [
      {
        "@class": "org.operaton.bpm.engine.rest.dto.repository.ActivityStatisticsResultDto",
        id: element,
        instances,
        failedJobs: params.flag("failedJobs")
          ? at(({ state }) => element === "charge" && state === "chargeFailed")
          : 0,
        incidents: params.flag("incidents") ? types.filter((type) => type.incidentCount > 0) : [],
      },
    ]
  })
}

/** Every version's numbers, as `/process-definition/statistics` answers them. */
function definitionStatistics(world: MediumWorld, params: Params) {
  const roots = params.flag("rootIncidents")
  const incidents = roots || params.flag("incidents")
  return world.versions.map((version) => {
    const at = (take: Take) => total(runningSegments(world, version, take))
    const types = ["failedJob", "failedExternalTask"].map((incidentType) => ({
      incidentType,
      incidentCount: at((fact) => incidentTypeOf(fact) === incidentType && !(roots && fact.copy)),
    }))
    return {
      "@class": "org.operaton.bpm.engine.rest.dto.repository.ProcessDefinitionStatisticsResultDto",
      id: version.id,
      instances: version.running,
      failedJobs: params.flag("failedJobs") ? at(({ state }) => state === "chargeFailed") : 0,
      incidents: incidents ? types.filter((type) => type.incidentCount > 0) : [],
      definition: definitionRow(version),
    }
  })
}

/** The versions `/process-definition` takes: by id, key, latest, version number. */
function definitions(world: MediumWorld, params: Params): Version[] {
  const ids = params.list("processDefinitionIdIn") ?? params.list("processDefinitionId")
  const keys = params.list("keysIn") ?? params.list("key")
  const number = params.get("version")
  const after = params.date("deployedAfter")
  return world.versions.filter(
    (version) =>
      (ids === undefined || ids.includes(version.id)) &&
      (keys === undefined || keys.includes(version.key)) &&
      (!params.flag("latestVersion") || version.latest) &&
      (number === undefined || version.version === Number(number)) &&
      (after === undefined || version.deployed > after),
  )
}

/** The versions as one segment each, keyed by the place of their id and their number. */
const definitionSegments = (world: MediumWorld, versions: readonly Version[]) =>
  versions.map((version): Segment<Version> => ({
    count: 1,
    row: () => version,
    keys: { id: () => world.idRanks.get(version.id)!, version: () => version.version },
  }))

const versionSegment = (versions: readonly Version[]): Segment<Version> => ({
  count: versions.length,
  row: (j) => versions[j],
  keys: {},
})

function definitionRoutes(world: MediumWorld): WorldRoute[] {
  const byId =
    (answer: (version: Version, request: WorldRequest) => unknown) =>
    (request: WorldRequest, { id }: Readonly<Record<string, string>>) =>
      orMissing(id, world.byId.get(id), (version) => json(answer(version, request)))
  return [
    {
      method: "GET",
      template: "/process-definition",
      answer: (request) => {
        const params = new Params(request)
        const segments = definitionSegments(world, definitions(world, params))
        return json(params.page(segments, { id: "id", version: "version" }).map(definitionRow))
      },
    },
    {
      method: "GET",
      template: "/process-definition/count",
      answer: (request) => json({ count: definitions(world, new Params(request)).length }),
    },
    {
      method: "GET",
      template: "/process-definition/statistics",
      answer: (request) => json(definitionStatistics(world, new Params(request))),
    },
    { method: "GET", template: "/process-definition/{id}", answer: byId(definitionRow) },
    {
      method: "GET",
      template: "/process-definition/{id}/xml",
      answer: byId((version) => ({ id: version.id, bpmn20Xml: diagramOf(version) })),
    },
    {
      method: "GET",
      template: "/process-definition/{id}/statistics",
      answer: byId((version, request) => elementStatistics(world, version, new Params(request))),
    },
  ]
}

function instanceRoutes(world: MediumWorld): WorldRoute[] {
  const byId = (template: string, answer: (instance: Instance) => unknown): WorldRoute => ({
    method: "GET",
    template,
    answer: (_, { id }) =>
      orMissing(id, runningOf(world, id), (instance) => json(answer(instance))),
  })
  return [
    // A business key is `bk-` and the instance's id, so both sort by the id.
    ...listed(
      world,
      "/process-instance",
      { take: instanceTake, sorts: { instanceId: "id", businessKey: "id" } },
      instanceRow,
    ),
    byId("/process-instance/{id}", instanceRow),
    byId("/process-instance/{id}/variables", variablesOf),
    byId("/process-instance/{id}/activity-instances", (instance) => activityTree(world, instance)),
    {
      method: "GET",
      template: "/variable-instance",
      answer: (request) => {
        const ids = new Params(request).list("processInstanceIdIn") ?? []
        const instances = ids.map((id) => runningOf(world, id))
        return json(instances.flatMap((instance) => (instance ? variableRows(instance) : [])))
      },
    },
  ]
}

function workRoutes(world: MediumWorld): WorldRoute[] {
  return [
    ...listed(
      world,
      "/incident",
      {
        take: incidentTake,
        bounds: (params) =>
          boundOf(params, "incident", "incidentTimestampAfter", "incidentTimestampBefore"),
        sorts: { incidentTimestamp: "incident", incidentId: "id" },
      },
      (instance) => incidentRow(world, instance),
    ),
    ...listed(
      world,
      "/job",
      {
        take: jobTake,
        bounds: (params) => [
          ...comparedBound(params, "createTimes", "job"),
          ...comparedBound(params, "dueDates", "due"),
        ],
        sorts: { jobId: "id", jobRetries: "retries" },
        byState: {
          chargeFailed: { retries: JOB_RETRIES.chargeFailed },
          charge: { retries: JOB_RETRIES.charge },
        },
      },
      (instance) => jobRow(world, instance),
    ),
    ...listed(world, "/task", { take: taskTake, sorts: { created: "task" } }, (instance) =>
      taskRow(world, instance),
    ),
    ...listed(world, "/external-task", { take: externalTaskTake }, (instance) =>
      externalTaskRow(world, instance),
    ),
    {
      method: "GET",
      template: "/job-definition",
      answer: (request) => json(versionsOf(world, new Params(request)).map(jobDefinitionRow)),
    },
  ]
}

/** The answer of a read of what the world holds none of: every filter takes nothing. */
const none =
  (answer: unknown) =>
  (request: WorldRequest): EngineReply => {
    for (const name of [...request.query.keys(), ...Object.keys(request.body)])
      request.read.add(name)
    return json(answer)
  }

const ENGINE_ROUTES: readonly WorldRoute[] = [
  { method: "GET", template: "/version", answer: () => json({ version: "2.1.0" }) },
  {
    method: "GET",
    template: "/telemetry/data",
    answer: () =>
      json({
        installation: "medium",
        product: { name: "CIB seven", version: "2.1.0", edition: "community", internals: {} },
      }),
  },
  // No instance waits on a message or a signal, and no batch runs.
  { method: "GET", template: "/event-subscription", answer: none([]) },
  { method: "GET", template: "/batch/statistics", answer: none([]) },
  { method: "GET", template: "/batch/statistics/count", answer: none({ count: 0 }) },
]

/** A version's deployment, as `/deployment` lists it. */
const deploymentRow = (version: Version) => ({
  links: [],
  id: version.deploymentId,
  name: version.key,
  source: "process application",
  deploymentTime: engineDate(version.deployed),
  processApplicationDeployment: null,
  tenantId: null,
})

function deploymentRoutes(world: MediumWorld): WorldRoute[] {
  const deployed = (id: string) => world.versions.find((version) => version.deploymentId === id)
  return [
    {
      method: "GET",
      template: "/deployment",
      answer: (request) =>
        json(new Params(request).page([versionSegment(world.versions)]).map(deploymentRow)),
    },
    {
      method: "GET",
      template: "/deployment/count",
      answer: () => json({ count: world.versions.length }),
    },
    {
      method: "GET",
      template: "/deployment/{id}",
      answer: (_, { id }) => orMissing(id, deployed(id), (version) => json(deploymentRow(version))),
    },
  ]
}

/** Every route of one engine of the world. */
export function mediumRoutes(world: MediumWorld): WorldRoute[] {
  return [
    ...ENGINE_ROUTES,
    ...definitionRoutes(world),
    ...instanceRoutes(world),
    ...workRoutes(world),
    ...objectRoutes(world),
    ...deploymentRoutes(world),
    ...historyRoutes(world),
  ]
}
