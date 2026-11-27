import type { EngineReply } from "./fake-engines.js"
import type { WorldRequest } from "./medium-engines.js"
import { type Instance, slotOf, stateOfInstance } from "./medium-rows.js"
import {
  pageOf,
  type Segment,
  type SortKey,
  sortedPageOf,
  type TimeBound,
  within,
} from "./medium-segments.js"
import {
  CALLED,
  COPY_SLOT,
  ELEMENT_OF,
  idKeyOf,
  INSTANCE_ID,
  instanceIdOf,
  type MediumWorld,
  PERIOD,
  Periodic,
  type State,
  stateOf,
  TIMES,
  type Version,
} from "./medium-world.js"

/**
 * How the medium engine (medium-world.ts) selects the rows of a read without listing them: a list
 * is a run of segments (medium-segments.ts), each the instances of one version whose state a
 * predicate takes, in the order of their numbers, so the newest first and by their ids.
 */

/**
 * What a read knows of an instance before it takes it: its state, its slot (a billing instance's
 * is its caller's), and whether it holds a copy of an incident at callBilling.
 */
export interface Fact {
  readonly state: State
  readonly slot: number
  readonly copy: boolean
}

/** Whether a read takes an instance. */
export type Take = (fact: Fact) => boolean

/** The incident type an instance's incident has; undefined for none. */
export function incidentTypeOf({ state, copy }: Fact): string | undefined {
  if (copy || state === "chargeFailed") return "failedJob"
  return state === "notifyFailed" ? "failedExternalTask" : undefined
}

/** The element an instance's incident stands at: a copy at the call activity. */
export const incidentActivityOf = ({ state, copy }: Fact) =>
  copy ? "callBilling" : ELEMENT_OF[state]

/** The incidents a read takes: by type and element. */
export function incidentTake(params: Params): Take {
  const type = params.get("incidentType")
  const activity = params.get("activityId")
  return (fact) => {
    const own = incidentTypeOf(fact)
    return (
      own !== undefined &&
      (type === undefined || own === type) &&
      (activity === undefined || incidentActivityOf(fact) === activity)
    )
  }
}

/** The running instances of `version` that `take` takes. */
export function runningSegments(
  world: MediumWorld,
  version: Version,
  take: Take,
): Segment<Instance>[] {
  if (version.key !== "billing") {
    const slots = slotsTaken(version.caller ? CALLER_FACTS : FACTS, take)
    return [segmentOf(version, slots, version.running, (n) => n)]
  }
  if (!version.latest) return []
  // Billing's instances follow their callers: one segment per calling version.
  const parents = slotsTaken(BILLING_FACTS, take)
  return [...world.callOffsets].map(([id, offset]) => {
    const caller = world.byId.get(id)!
    return segmentOf(version, parents, caller.running, (n) => offset + CALLED.below(n))
  })
}

const copyAt = (caller: boolean, slot: number) => caller && slot === COPY_SLOT

/** The facts of every slot, of a calling version's and another's instances. */
const factsOf = (caller: boolean): Fact[] =>
  Array.from({ length: PERIOD }, (_, slot) => ({
    state: stateOf(slot, caller),
    slot,
    copy: copyAt(caller, slot),
  }))
const FACTS = factsOf(false)
const CALLER_FACTS = factsOf(true)

/** The facts of billing's instances by their callers' slots: one whose charge failed. */
const BILLING_FACTS: Fact[] = CALLED.slots.map((slot) => ({
  state: slot === COPY_SLOT ? "chargeFailed" : "review",
  slot,
  copy: false,
}))

/** The patterns of slots made so far, by their slots: a read's take selects one of few. */
const PATTERNS = new Map<string, Periodic>()

/** The slots whose facts a read takes. */
function slotsTaken(facts: readonly Fact[], take: Take): Periodic {
  const slots = facts.filter(take).map(({ slot }) => slot)
  const key = slots.join(",")
  const known = PATTERNS.get(key) ?? new Periodic(slots)
  PATTERNS.set(key, known)
  return known
}

/** The fact of one running instance. */
export function factOf(world: MediumWorld, instance: Instance): Fact {
  const slot = slotOf(world, instance)
  const copy = copyAt(instance.version.caller, slot)
  return { state: stateOfInstance(world, instance), slot, copy }
}

/**
 * The keys of a version's running instances by their numbers: the times of their rows after their
 * start (the instance's, its incident's, its job's, its user task's), and the place of their ids.
 */
function instanceKeys(version: Version, nOf: (j: number) => number): Segment["keys"] {
  const start = (j: number) => TIMES.started(version, nOf(j))
  return {
    start,
    incident: (j) => start(j) + TIMES.incidentAfter,
    job: (j) => start(j) + TIMES.jobAfter,
    task: (j) => start(j) + TIMES.taskAfter,
    id: (j) => idKeyOf(version, nOf(j)),
  }
}

function segmentOf(
  version: Version,
  slots: Periodic,
  bound: number,
  numberOf: (n: number) => number,
): Segment<Instance> {
  const nOf = (j: number) => numberOf(slots.nth(j))
  return {
    count: slots.below(bound),
    row: (j) => ({ version, n: nOf(j) }),
    keys: instanceKeys(version, nOf),
  }
}

/** The segment of one running instance. */
const instanceSegment = (instance: Instance): Segment<Instance> => ({
  count: 1,
  row: () => instance,
  keys: instanceKeys(instance.version, () => instance.n),
})

/** The engine's answer about the object `found` an id names, or its 404 where it names none. */
export function orMissing<T>(
  id: string,
  found: T | undefined,
  answer: (value: T) => EngineReply | undefined,
): EngineReply {
  const missing = {
    status: 404,
    body: { type: "InvalidRequestException", message: `No object with id ${id}` },
  }
  return (found === undefined ? undefined : answer(found)) ?? missing
}

/** An engine date (`2026-10-09T13:55:00.000+0000`) as an instant. */
export const instantOf = (date: string) => Date.parse(date.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"))

/** A request's parameters, the query's and a POST body's alike, as text. */
export class Params {
  constructor(private readonly request: WorldRequest) {}

  get(name: string): string | undefined {
    this.request.read.add(name)
    const value = this.request.query.get(name) ?? this.request.body[name]
    if (value === undefined || value === null) return undefined
    if (Array.isArray(value)) return value.join(",")
    return typeof value === "string" ? value : JSON.stringify(value)
  }

  /** A list parameter: comma-separated in a query, an array in a body. */
  list(name: string): string[] | undefined {
    return this.get(name)?.split(",")
  }

  flag(name: string): boolean {
    return this.get(name) === "true"
  }

  /** A date parameter as an instant. */
  date(name: string): number | undefined {
    const value = this.get(name)
    return value === undefined ? undefined : instantOf(value)
  }

  /**
   * The page a read asks for of `segments`, in the order it asks for, where `sorts` names the
   * segments' key each sort of the API sorts by (`incidentTimestamp` by `incident`); else in the
   * segments' order.
   */
  page<Row>(
    segments: readonly Segment<Row>[],
    sorts: Readonly<Record<string, string>> = {},
  ): Row[] {
    const first = Number(this.get("firstResult") ?? 0)
    const max = Number(this.get("maxResults") ?? Number.MAX_SAFE_INTEGER)
    const by = this.orderOf(segments, sorts)
    return by ? sortedPageOf(segments, by, first, max) : pageOf(segments, first, max)
  }

  /**
   * The order a read asks for (`sortBy` and `sortOrder`, a POST's `sorting`) by the segments' keys;
   * undefined for none, and for one they cannot give (a sort `sorts` does not name, a key a segment
   * of rows lacks, a sort without its order), whose parameters then stay unread, so the request
   * shows them ignored.
   */
  private orderOf(
    segments: readonly Segment[],
    sorts: Readonly<Record<string, string>>,
  ): SortKey[] | undefined {
    const { query, body } = this.request
    const sortBy = query.get("sortBy") ?? body.sortBy
    const asked = Array.isArray(body.sorting)
      ? (body.sorting as Array<Record<string, unknown>>)
      : [{ sortBy, sortOrder: query.get("sortOrder") ?? body.sortOrder }]
    const held = (key: string) =>
      segments.every((segment) => segment.count === 0 || segment.keys[key] !== undefined)
    const by = asked.map(({ sortBy: name, sortOrder }) => {
      const key = Object.hasOwn(sorts, String(name)) ? sorts[String(name)] : undefined
      const ordered = sortOrder === "asc" || sortOrder === "desc"
      return ordered && key !== undefined && held(key)
        ? { key, descending: sortOrder === "desc" }
        : undefined
    })
    if (!by.every((key): key is SortKey => key !== undefined)) return undefined
    for (const name of ["sortBy", "sortOrder", "sorting"]) this.request.read.add(name)
    return by
  }
}

/** The versions a read names: by id, ids, key or keys; every version without any. */
export function versionsOf(world: MediumWorld, params: Params): Version[] {
  const ids = params.list("processDefinitionIdIn") ?? params.list("processDefinitionId")
  const keys = params.list("processDefinitionKeyIn") ?? params.list("processDefinitionKey")
  return world.versions.filter(
    (version) =>
      (ids === undefined || ids.includes(version.id)) &&
      (keys === undefined || keys.includes(version.key)),
  )
}

/** The running instance an id names, or undefined. */
export function runningOf(world: MediumWorld, id: string): Instance | undefined {
  const match = INSTANCE_ID.exec(id)
  if (!match) return undefined
  const version = world.versionAt(Number(match[1]), Number(match[2]))
  const n = Number(match[3])
  return version && n < version.running ? { version, n } : undefined
}

/** The id of the billing instance a calling instance waits on; none for any other. */
function calledOf(world: MediumWorld, id: string): string[] {
  const caller = runningOf(world, id)
  if (!caller || stateOfInstance(world, caller) !== "called") return []
  return [instanceIdOf(world.billing, world.calledBy(caller.version, caller.n))]
}

/** The id of the instance that called a billing instance; none for any other. */
function callerIdOf(world: MediumWorld, id: string): string[] {
  const called = runningOf(world, id)
  if (called?.version.key !== "billing") return []
  const caller = world.callerOf(called.n)
  return [instanceIdOf(caller.version, caller.n)]
}

/**
 * The instances a read names, by id or ids, business key, the instance that called them or the
 * one they called, under the runtime's and the history's names; undefined where it names none.
 */
export function namedIds(world: MediumWorld, params: Params): string[] | undefined {
  const ids =
    params.list("processInstanceIds") ??
    params.list("processInstanceIdIn") ??
    params.list("processInstanceId")
  if (ids) return ids
  const job = params.get("jobId")
  if (job !== undefined) return [job.replace(/^job-/, "")]
  const businessKey = params.get("businessKey") ?? params.get("processInstanceBusinessKey")
  if (businessKey !== undefined) return [businessKey.replace(/^bk-/, "")]
  const parent = params.get("superProcessInstance") ?? params.get("superProcessInstanceId")
  if (parent !== undefined) return calledOf(world, parent)
  const child = params.get("subProcessInstance")
  return child === undefined ? undefined : callerIdOf(world, child)
}

/** What a read of named instances keeps of them besides `take`: their versions, time bounds. */
export interface NamedCut {
  readonly versions: readonly Version[]
  readonly bounds: readonly TimeBound[]
}

/**
 * The running instances a read names that `take` takes, of `cut`'s versions and within its
 * bounds, each once: one segment each, so a sort places them as any others.
 */
export function namedSegments(
  world: MediumWorld,
  ids: readonly string[],
  take: Take,
  cut: NamedCut,
): Segment<Instance>[] {
  return [...new Set(ids)]
    .map((id) => runningOf(world, id))
    .filter(
      (instance): instance is Instance =>
        instance !== undefined &&
        cut.versions.includes(instance.version) &&
        take(factOf(world, instance)),
    )
    .map((instance) => within(instanceSegment(instance), cut.bounds))
}
