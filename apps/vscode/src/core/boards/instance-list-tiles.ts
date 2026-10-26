import type { InstanceSummary } from "../../contract/index.js"
import type {
  BoardColumn,
  BoardInstanceRow,
  InstanceGroup,
  InstanceListTile,
} from "../protocol/index.js"
import { Labels } from "../views/labels.js"
import type { InstanceListWidget } from "./board-definition.js"
import { BoardFilters } from "./board-filters.js"
import { EngineReads } from "./engine-reads.js"
import type { ProbedEngine } from "./engine-probe.js"

export class InstanceListTiles {
  static async build(
    widget: InstanceListWidget,
    engines: readonly ProbedEngine[],
  ): Promise<InstanceListTile> {
    const query = BoardFilters.query(widget.filter)
    const groups = await Promise.all(
      engines.map(async (engine): Promise<InstanceGroup> => {
        const name = engine.status.name
        if (engine.reads === undefined) {
          return { engine: name, rows: [], unavailable: true }
        }
        const [page, total] = await Promise.all([
          engine.reads.firstPage(query),
          engine.reads.count(query),
        ])
        const items = EngineReads.valueOf(page)
        if (items === undefined) {
          return { engine: name, rows: [], unavailable: true }
        }
        const counted = EngineReads.valueOf(total)
        return {
          engine: name,
          rows: items.map((item) => InstanceListTiles.row(name, item)),
          ...(counted === undefined ? {} : { total: counted }),
        }
      }),
    )
    return {
      kind: "instanceList",
      title: widget.title ?? BoardFilters.title(widget.filter),
      columns: InstanceListTiles.columns(widget),
      groups,
    }
  }

  private static columns(widget: InstanceListWidget): readonly BoardColumn[] {
    const several = widget.engines.length > 1
    return several && !widget.columns.includes("engine")
      ? ["engine", ...widget.columns]
      : widget.columns
  }

  private static row(engine: string, item: InstanceSummary): BoardInstanceRow {
    return {
      engine,
      id: item.id,
      shortId: Labels.shortId(item.id),
      processName: item.definition.name ?? item.definition.bpmnProcessId,
      bpmnProcessId: item.definition.bpmnProcessId,
      version: item.definition.version,
      state: Labels.instanceState(item.state),
      hasIncident: item.hasIncident,
      ...(item.businessKey === undefined ? {} : { businessKey: item.businessKey }),
      ...(item.startedAt === undefined ? {} : { startedAt: item.startedAt }),
      ...(item.endedAt === undefined ? {} : { endedAt: item.endedAt }),
    }
  }
}
