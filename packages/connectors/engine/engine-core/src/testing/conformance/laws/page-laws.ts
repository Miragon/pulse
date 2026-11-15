import { BpmnProcessId } from "../../../model/ids.js"
import type { InstanceFilter } from "../../../model/queries.js"
import { Ensure } from "../ensure.js"
import { CASE, type ConformanceCase } from "../conformance-case.js"
import { InstanceReads } from "./instance-reads.js"
import { PageWalk } from "./page-walk.js"
import { WORLD_PROCESS } from "../world/world.js"

const ORDER = BpmnProcessId(WORLD_PROCESS.order)
const ONE_PER_PAGE = 1
const PAGE = { limit: 50 } as const

const instancesPagesFull: ConformanceCase = {
  name: CASE.instancesPagesFull,
  async run(harness) {
    for (const withIncident of [false, true]) {
      const law = `${this.name} (withIncident ${String(withIncident)})`
      const filter: InstanceFilter = { bpmnProcessId: ORDER, withIncident }
      const pages = await PageWalk.pages(
        (page) => harness.runtime.searchInstances(filter, page),
        ONE_PER_PAGE,
      )
      PageWalk.ensureFull(pages, ONE_PER_PAGE, law)
      const whole = await InstanceReads.search(harness, filter)
      Ensure.sameSet(
        pages.flat().map((instance) => instance.id),
        whole.map((instance) => instance.id),
        law,
      )
    }
  },
}

const incidentsPaging: ConformanceCase = {
  name: CASE.incidentsPaging,
  async run(harness) {
    const pages = await PageWalk.pages(
      (page) => harness.runtime.searchIncidents({}, page),
      ONE_PER_PAGE,
    )
    PageWalk.ensureFull(pages, ONE_PER_PAGE, this.name)
    const whole = await harness.runtime.searchIncidents({}, PAGE)
    Ensure.sameSet(
      pages.flat().map((incident) => incident.id),
      whole.items.map((incident) => incident.id),
      this.name,
    )
  },
}

export const PAGE_LAWS: readonly ConformanceCase[] = [instancesPagesFull, incidentsPaging]
