import { BpmnProcessId, ElementId, InstanceId, IsoTimestamp } from "../../../model/ids.js"
import type { InstanceFilter } from "../../../model/queries.js"
import { Ensure } from "../ensure.js"
import { CASE, type ConformanceCase } from "../conformance-case.js"
import { InstanceReads, MAX_PAGES } from "./instance-reads.js"
import { WORLD_ELEMENT, WORLD_PROCESS } from "../world/world.js"

const ORDER = BpmnProcessId(WORLD_PROCESS.order)
const DISPATCH = BpmnProcessId(WORLD_PROCESS.dispatch)
const MOST_IDS = 1000

const instancesByVersionAndLifecycle: ConformanceCase = {
  name: CASE.instancesByVersionAndLifecycle,
  async run(harness) {
    const items = await InstanceReads.search(harness, {
      definitionId: harness.world.definitionIds["order@1"],
      lifecycle: "running",
    })
    Ensure.sameSet(
      items.map((item) => item.id),
      InstanceReads.idsOf(harness, ["ORD-1001", "ORD-1002"]),
      this.name,
    )
    const versions = new Set(items.map((item) => item.definition.version))
    Ensure.that(
      versions.size === 1 && versions.has(1),
      this.name,
      "every item references version 1",
    )
  },
}

const instancesAcrossVersions: ConformanceCase = {
  name: CASE.instancesAcrossVersions,
  async run(harness) {
    const items = await InstanceReads.search(harness, {
      bpmnProcessId: ORDER,
      lifecycle: "running",
    })
    Ensure.sameSet(
      items.map((item) => item.id),
      InstanceReads.idsOf(harness, ["ORD-1001", "ORD-1002", "ORD-2001"]),
      this.name,
    )
  },
}

const instancesWithIncident: ConformanceCase = {
  name: CASE.instancesWithIncident,
  async run(harness) {
    const withIncident = await InstanceReads.search(harness, {
      bpmnProcessId: ORDER,
      withIncident: true,
    })
    Ensure.sameSet(
      withIncident.map((item) => item.id),
      InstanceReads.idsOf(harness, ["ORD-1002"]),
      this.name,
    )
    const running = await InstanceReads.search(harness, {
      bpmnProcessId: ORDER,
      lifecycle: "running",
    })
    const flagged = running.filter((item) => item.hasIncident).map((item) => item.id)
    Ensure.sameSet(flagged, InstanceReads.idsOf(harness, ["ORD-1002"]), this.name)
    const callers = await InstanceReads.search(harness, {
      bpmnProcessId: DISPATCH,
      withIncident: true,
    })
    Ensure.sameSet(
      callers.map((item) => item.id),
      InstanceReads.idsOf(harness, ["DSP-3001"]),
      `${this.name} (an incident in a called instance flags its caller)`,
    )
  },
}

const instancesEndedByBusinessKey: ConformanceCase = {
  name: CASE.instancesEndedByBusinessKey,
  async run(harness) {
    const items = await InstanceReads.search(harness, { businessKey: "ORD-1003" })
    Ensure.that(items.length === 1, this.name, `expected one instance, got ${items.length}`)
    const ended = Ensure.defined(items[0], this.name, "no instance")
    Ensure.that(ended.state === "completed", this.name, `state is ${ended.state}`)
    Ensure.that(ended.businessKey === "ORD-1003", this.name, "business key is missing")
    const startedAt = Ensure.defined(ended.startedAt, this.name, "startedAt is missing")
    const endedAt = Ensure.defined(ended.endedAt, this.name, "endedAt is missing")
    Ensure.that(
      startedAt <= endedAt,
      this.name,
      `ended at ${endedAt}, before it started at ${startedAt}`,
    )
  },
}

const instancesByActiveElement: ConformanceCase = {
  name: CASE.instancesByActiveElement,
  async run(harness) {
    const items = await InstanceReads.search(harness, {
      bpmnProcessId: ORDER,
      lifecycle: "running",
      activeElementId: ElementId(WORLD_ELEMENT.reviewOrder),
    })
    Ensure.sameSet(
      items.map((item) => item.id),
      InstanceReads.idsOf(harness, ["ORD-1001", "ORD-2001"]),
      this.name,
    )
    const beforeAsyncTask = await InstanceReads.search(harness, {
      bpmnProcessId: ORDER,
      lifecycle: "running",
      activeElementId: ElementId(WORLD_ELEMENT.chargePayment),
    })
    Ensure.sameSet(
      beforeAsyncTask.map((item) => item.id),
      InstanceReads.idsOf(harness, ["ORD-1002"]),
      this.name,
    )
  },
}

const instancesPaging: ConformanceCase = {
  name: CASE.instancesPaging,
  async run(harness) {
    const seen: InstanceId[] = []
    let page = await harness.runtime.searchInstances({ bpmnProcessId: ORDER }, { limit: 1 })
    for (let pages = 1; pages <= MAX_PAGES; pages += 1) {
      Ensure.that(page.items.length <= 1, this.name, `a page of limit 1 held ${page.items.length}`)
      seen.push(...page.items.map((item) => item.id))
      if (page.next === undefined) {
        break
      }
      page = await harness.runtime.searchInstances(
        { bpmnProcessId: ORDER },
        { limit: 1, after: page.next },
      )
    }
    Ensure.sameSet(
      seen,
      InstanceReads.idsOf(harness, ["ORD-1001", "ORD-1002", "ORD-1003", "ORD-2001"]),
      this.name,
    )
  },
}

const instancesNewestFirst: ConformanceCase = {
  name: CASE.instancesNewestFirst,
  async run(harness) {
    const first = await InstanceReads.search(harness, { bpmnProcessId: ORDER })
    const started = first.map((item) => item.startedAt ?? "")
    Ensure.that(
      started.every((at, index) => index === 0 || (started[index - 1] ?? "") >= at),
      this.name,
      `started ${Ensure.describe(started)}`,
    )
    const second = await InstanceReads.search(harness, { bpmnProcessId: ORDER })
    Ensure.that(
      Ensure.describe(first.map((item) => item.id)) ===
        Ensure.describe(second.map((item) => item.id)),
      this.name,
      "two reads returned another order",
    )
  },
}

const instancesUtcTimestamps: ConformanceCase = {
  name: CASE.instancesUtcTimestamps,
  async run(harness) {
    const items = await InstanceReads.search(harness, { bpmnProcessId: ORDER })
    const timestamps = items.flatMap((item) => [item.startedAt, item.endedAt])
    for (const timestamp of timestamps) {
      if (timestamp !== undefined) {
        Ensure.that(IsoTimestamp(timestamp) === timestamp, this.name, `${timestamp} is not UTC ISO`)
      }
    }
    Ensure.that(
      timestamps.some((timestamp) => timestamp !== undefined),
      this.name,
      "no timestamps",
    )
  },
}

const instancesCounted: ConformanceCase = {
  name: CASE.instancesCounted,
  async run(harness) {
    for (const filter of InstanceReads.countedFilters(harness)) {
      const [count, items] = await Promise.all([
        harness.runtime.countInstances(filter),
        InstanceReads.searchAll(harness, filter),
      ])
      Ensure.that(
        count.count === items.length && count.atLeast === undefined,
        this.name,
        `${JSON.stringify(filter)} counted ${Ensure.describe(count)}, the search found ${items.length}`,
      )
    }
  },
}

const instancesByIds: ConformanceCase = {
  name: CASE.instancesByIds,
  async run(harness) {
    const { instanceIds, unknown } = harness.world
    const wanted = [instanceIds["ORD-1001"], instanceIds["ORD-1003"]]
    const noise = Array.from({ length: MOST_IDS - wanted.length }, (_, index) =>
      InstanceId(`${unknown.instanceId}-${index}`),
    )
    const filter: InstanceFilter = { instanceIds: [...noise, ...wanted] }
    const found = await InstanceReads.search(harness, filter)
    Ensure.sameSet(
      found.map((instance) => instance.id),
      wanted,
      this.name,
    )
    const counted = await harness.runtime.countInstances(filter)
    Ensure.that(counted.count === wanted.length, this.name, `counted ${Ensure.describe(counted)}`)
    const running = await InstanceReads.search(harness, { ...filter, lifecycle: "running" })
    Ensure.sameSet(
      running.map((instance) => instance.id),
      [instanceIds["ORD-1001"]],
      this.name,
    )
    const ofVersion = await InstanceReads.search(harness, {
      definitionId: harness.world.definitionIds["order@2"],
      instanceIds: [instanceIds["ORD-1001"], instanceIds["ORD-2001"]],
    })
    Ensure.sameSet(
      ofVersion.map((instance) => instance.id),
      [instanceIds["ORD-2001"]],
      this.name,
    )
    const none = await InstanceReads.search(harness, { instanceIds: [] })
    const noneCounted = await harness.runtime.countInstances({ instanceIds: [] })
    Ensure.that(
      none.length === 0 && noneCounted.count === 0,
      this.name,
      `an empty id list found ${none.length} and counted ${noneCounted.count}`,
    )
  },
}

export const INSTANCE_LAWS: readonly ConformanceCase[] = [
  instancesByVersionAndLifecycle,
  instancesAcrossVersions,
  instancesWithIncident,
  instancesEndedByBusinessKey,
  instancesByActiveElement,
  instancesPaging,
  instancesNewestFirst,
  instancesUtcTimestamps,
  instancesCounted,
  instancesByIds,
]
