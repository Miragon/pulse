import type { InstanceFilter } from "@miragon/pulse-engine-core"
import type { InstanceListWidget } from "../format/board-definition.js"
import type { InstanceGroupModel, InstanceListModel } from "./board-model.js"
import type { ProbedEngine } from "./engine-probe.js"
import { EngineReads } from "./engine-reads.js"
import { FilterQuery } from "./filter-query.js"

export class InstanceListTiles {
  static async build(
    widget: InstanceListWidget,
    engines: readonly Promise<ProbedEngine>[],
  ): Promise<InstanceListModel> {
    const query = FilterQuery.of(widget.filter)
    const groups = await Promise.all(
      engines.map((engine) => InstanceListTiles.group(engine, query)),
    )
    return { kind: "instanceList", widget, groups }
  }

  private static async group(
    probed: Promise<ProbedEngine>,
    query: InstanceFilter,
  ): Promise<InstanceGroupModel> {
    const engine = await probed
    const name = engine.model.name
    if (engine.reads === undefined) {
      return { engine: name }
    }
    const [page, total] = await Promise.all([
      engine.reads.firstPage(query),
      engine.reads.count(query),
    ])
    const instances = EngineReads.valueOf(page)
    if (instances === undefined) {
      return { engine: name }
    }
    const counted = EngineReads.valueOf(total)
    return { engine: name, instances, ...(counted === undefined ? {} : { total: counted }) }
  }
}
