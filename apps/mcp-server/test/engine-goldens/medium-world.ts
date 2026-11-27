import { NOW } from "./goldens.js"

/**
 * The medium engine of the request-count golden (request-counts.golden.test.ts): an engine of the
 * size the reads must hold up on (#691), tens of thousands of running instances, a few thousand of
 * them with an open root incident, a few hundred deployed versions, hundreds of thousands of ended
 * instances in the history, made from formulas rather than stored rows, so it answers every paged,
 * sorted and counted read by its parameters, each count the length of the list it counts, each
 * sorted page the rows the order asked for puts there (medium-segments.ts). The REST answers are
 * medium-routes.ts'.
 *
 * The engine deploys `keys` processes, `process-01` and on, the process of index `i` in
 * `1 + (7i mod 19)` versions, plus `billing` in three, which every third process calls. An
 * instance's state follows its slot, its number modulo 100 (`stateOf`): most wait at the user task
 * `review`, a tenth have the job of the asynchronous `charge` failed for good (an incident of type
 * failedJob), a tenth wait on that job, a fifth wait at the external task `notify`, where one in a
 * hundred failed (an incident of type failedExternalTask), and in a calling process a tenth wait
 * at `callBilling` on an instance of billing's latest version, one in a hundred of them on one
 * whose charge failed, so the caller holds a copy of that incident (medium-rows.ts).
 * Every time is a fixed distance before the goldens' clock, so nothing counts by the hour it runs.
 * Times tie as an engine's do, and a sort puts the ties side by side: instances of two versions
 * whose `3i + version` agree started in the same second, and the ended instances of one number in
 * versions of one number ended together.
 */

/** How many instances of a version share one pattern of states: an instance's slot. */
export const PERIOD = 100

/** The slot of a calling instance whose called instance's charge failed: it holds a copy. */
export const COPY_SLOT = 5

/** The states an instance can be in. */
export type State = "review" | "called" | "chargeFailed" | "charge" | "notify" | "notifyFailed"

/** The state of an instance by its slot; a calling process's fifth tenth waits at callBilling. */
export function stateOf(slot: number, caller: boolean): State {
  const tenth = slot % 10
  if (tenth === 5 && caller) return "called"
  if (tenth <= 5) return "review"
  if (tenth === 6) return "chargeFailed"
  if (tenth === 7) return "charge"
  return slot === 9 ? "notifyFailed" : "notify"
}

/** The element an instance in `state` waits at. */
export const ELEMENT_OF: Readonly<Record<State, string>> = {
  review: "review",
  called: "callBilling",
  chargeFailed: "charge",
  charge: "charge",
  notify: "notify",
  notifyFailed: "notify",
}

/** The numbers below `PERIOD` whose state is one of `states`, for a calling process or not. */
function slotsOf(states: readonly State[], caller: boolean): number[] {
  return Array.from({ length: PERIOD }, (_, slot) => slot).filter((slot) =>
    states.includes(stateOf(slot, caller)),
  )
}

/** The numbers whose slot is one of `slots`: how many lie below a bound, and the j-th of them. */
export class Periodic {
  /** For each `k` below `PERIOD`: how many of the slots lie below it. */
  private readonly before: readonly number[]

  constructor(readonly slots: readonly number[]) {
    this.before = Array.from({ length: PERIOD }, (_, k) => slots.filter((slot) => slot < k).length)
  }

  static of(states: readonly State[], caller: boolean): Periodic {
    return new Periodic(slotsOf(states, caller))
  }

  /** How many of the numbers lie below `bound`. */
  below(bound: number): number {
    return Math.floor(bound / PERIOD) * this.slots.length + this.before[bound % PERIOD]
  }

  /** The j-th of the numbers, from 0. */
  nth(j: number): number {
    const width = this.slots.length
    return PERIOD * Math.floor(j / width) + this.slots[j % width]
  }
}

/** The numbers of a calling version's instances that wait at callBilling. */
export const CALLED = Periodic.of(["called"], true)

/** One deployed version of a process. */
export interface Version {
  readonly key: string
  /** The process's index; `billing`'s is the engine's `keys`. */
  readonly index: number
  readonly version: number
  readonly id: string
  readonly latest: boolean
  /** Whether its diagram calls `billing` at callBilling. */
  readonly caller: boolean
  readonly running: number
  readonly ended: number
  readonly deploymentId: string
  /** When it was deployed: the latest ten days ago, each before it 25 days earlier. */
  readonly deployed: number
}

const pad = (n: number) => String(n + 1).padStart(2, "0")
const keyOf = (index: number) => `process-${pad(index)}`

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

/** The times of the world: a fixed distance before the goldens' clock. */
export const TIMES = {
  /** When the running instance `n` of a version started: the newest first. */
  started: (version: Version, n: number) =>
    NOW - 5 * MINUTE - n * 11 * MINUTE - (version.index * 3 + version.version) * 1000,
  /** When the ended instance `m` of a version ended: the newest first, an hour after its start. */
  ended: (version: Version, m: number) =>
    NOW - 30 * MINUTE - m * 17 * MINUTE - version.version * 1000,
  /** How long an ended instance ran. */
  duration: 60 * MINUTE,
  /** How long after the start of an instance's step the next one starts. */
  step: 1000,
  /** How long after its instance started a job was created, an incident raised, a task created. */
  jobAfter: MINUTE,
  incidentAfter: 2 * MINUTE,
  taskAfter: 30_000,
} as const

/** An engine date: `2026-10-09T13:55:00.000+0000`. */
export const engineDate = (time: number) => new Date(time).toISOString().replace("Z", "+0000")

/** The shape of one engine: how many processes it deploys besides billing. */
export interface WorldShape {
  readonly keys: number
}

/** One engine of the world: its versions and where each calling version's calls begin. */
export class MediumWorld {
  readonly versions: readonly Version[]
  readonly byId: ReadonlyMap<string, Version>
  /** For each calling version's id: the number of billing's first instance it called. */
  readonly callOffsets: ReadonlyMap<string, number>
  readonly billing: Version
  /** Each version's place in the text order of their ids, the sort key `id` of a definition. */
  readonly idRanks: ReadonlyMap<string, number>

  constructor(readonly shape: WorldShape) {
    const versions: Version[] = []
    for (let index = 0; index < shape.keys; index++) versions.push(...processVersions(index))
    const offsets = new Map<string, number>()
    let calls = 0
    for (const version of versions.filter(({ caller }) => caller)) {
      offsets.set(version.id, calls)
      calls += CALLED.below(version.running)
    }
    this.billing = billingVersion(shape.keys, calls)
    versions.push(...billingOlder(shape.keys), this.billing)
    this.versions = versions
    this.byId = new Map(versions.map((version) => [version.id, version]))
    this.callOffsets = offsets
    const ids = versions.map(({ id }) => id).sort((left, right) => (left < right ? -1 : 1))
    this.idRanks = new Map(ids.map((id, rank) => [id, rank]))
  }

  /** The versions of `key`, the newest first. */
  versionsOf(key: string): Version[] {
    return this.versions.filter((version) => version.key === key).reverse()
  }

  /** The version an id names by its process's index and its number. */
  versionAt(index: number, number: number): Version | undefined {
    return this.versions.find((version) => version.index === index && version.version === number)
  }

  /**
   * The calling instance of billing's instance `n`: of the last calling version whose calls begin
   * at or before it (they begin in order), its version and number.
   */
  callerOf(n: number): { version: Version; n: number } {
    let [id, offset] = [...this.callOffsets][0]
    for (const entry of this.callOffsets) if (entry[1] <= n) [id, offset] = entry
    return { version: this.byId.get(id)!, n: CALLED.nth(n - offset) }
  }

  /** The billing instance a calling instance in state `called` waits on. */
  calledBy(version: Version, n: number): number {
    return this.callOffsets.get(version.id)! + CALLED.below(n)
  }
}

function processVersions(index: number): Version[] {
  const count = 1 + ((index * 7) % 19)
  return Array.from({ length: count }, (_, at) => {
    const version = at + 1
    const latest = version === count
    return {
      key: keyOf(index),
      index,
      version,
      id: `${keyOf(index)}:${version}:d${pad(index)}v${version}`,
      latest,
      caller: index % 3 === 0,
      running: latest ? 400 + ((index * 53) % 600) : (version * 37 + index * 11) % 60,
      ended: latest ? 2000 + index * 37 : 400 + version * 13,
      deploymentId: `dep-${pad(index)}-${version}`,
      deployed: NOW - (10 + (count - version) * 25) * DAY,
    }
  })
}

const billingOf = (index: number, version: number, running: number): Version => ({
  key: "billing",
  index,
  version,
  id: `billing:${version}:b${version}`,
  latest: version === 3,
  caller: false,
  running,
  ended: 1500 - version * 100,
  deploymentId: `dep-billing-${version}`,
  deployed: NOW - (10 + (3 - version) * 25) * DAY,
})

/** Billing's first two versions: nothing runs on them. */
const billingOlder = (index: number) => [billingOf(index, 1, 0), billingOf(index, 2, 0)]

/** Billing's latest version: every instance of it was called. */
const billingVersion = (index: number, calls: number) => billingOf(index, 3, calls)

const digits = (value: number, width: number) => String(value).padStart(width, "0")

/**
 * An instance id: `pi-<index>-<version>-<n>`, each part of a fixed width
 * (`pi-27-19-000005`), so the text order of ids is the order of their numbers.
 */
export const instanceIdOf = (version: Version, n: number) =>
  `pi-${digits(version.index, 2)}-${digits(version.version, 2)}-${digits(n, 6)}`

/** An ended instance's id: `hpi-<index>-<version>-<m>`, the widths a running one's. */
export const endedIdOf = (version: Version, m: number) => `h${instanceIdOf(version, m)}`

/** The ids of a running and an ended instance, as their parts read them. */
export const INSTANCE_ID = /^pi-(\d{2})-(\d{2})-(\d{6})$/
export const ENDED_ID = /^hpi-(\d{2})-(\d{2})-(\d{6})$/

/**
 * An instance id's place in the text order of ids as a number, the sort key `id`: the ended
 * ones (`hpi-`) before the running ones (`pi-`), each by its process, version and number.
 */
export const idKeyOf = (version: Version, n: number, ended = false) =>
  (ended ? 0 : 1e10) + (version.index * 100 + version.version) * 1e6 + n
