import type { DefinitionId, InstanceCount } from "@miragon/pulse-engine-core"
import type { InstanceListFilterData, InstanceScopeCode } from "../format/instance-list-data.js"
import type { InstanceCountReads, ScopeCountsModel } from "./instance-list-model.js"
import { InstanceQuery } from "./instance-query.js"

type CountedScope = Exclude<InstanceScopeCode, "all">

export class InstanceCounts {
  static async read(
    reads: InstanceCountReads,
    definitionId: DefinitionId,
    filter: InstanceListFilterData,
    ended?: InstanceCount,
  ): Promise<ScopeCountsModel> {
    const count = (scope: CountedScope) =>
      reads.countInstances(InstanceQuery.of(definitionId, { ...filter, scope }))
    const [running, withIncident, endedCount] = await Promise.all([
      count("running"),
      count("withIncident"),
      ended === undefined ? count("ended") : Promise.resolve(ended),
    ])
    return InstanceCounts.of(running, withIncident, endedCount)
  }

  static of(
    running: InstanceCount,
    withIncident: InstanceCount,
    ended: InstanceCount,
  ): ScopeCountsModel {
    const atLeast: InstanceScopeCode[] = [
      ...(running.atLeast === true ? (["running"] as const) : []),
      ...(withIncident.atLeast === true ? (["withIncident"] as const) : []),
      ...(ended.atLeast === true ? (["ended"] as const) : []),
      ...(running.atLeast === true || ended.atLeast === true ? (["all"] as const) : []),
    ]
    return {
      running: running.count,
      withIncident: withIncident.count,
      ended: ended.count,
      all: running.count + ended.count,
      ...(atLeast.length === 0 ? {} : { atLeast }),
    }
  }

  static endedOf(counts: ScopeCountsModel): InstanceCount {
    return counts.atLeast?.includes("ended") === true
      ? { count: counts.ended, atLeast: true }
      : { count: counts.ended }
  }
}
