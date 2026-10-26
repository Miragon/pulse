import type { CounterEntry, CounterTile } from "../protocol/index.js"
import type { CounterWidget } from "./board-definition.js"
import { BoardFilters } from "./board-filters.js"
import { EngineReads } from "./engine-reads.js"
import type { ProbedEngine } from "./engine-probe.js"

export class CounterTiles {
  static async build(
    widget: CounterWidget,
    engines: readonly ProbedEngine[],
  ): Promise<CounterTile> {
    const query = BoardFilters.query(widget.filter)
    const entries = await Promise.all(
      engines.map(async (engine): Promise<CounterEntry> => {
        const count =
          engine.reads === undefined
            ? undefined
            : EngineReads.valueOf(await engine.reads.count(query))
        return CounterTiles.entry(widget, engine.status.name, count)
      }),
    )
    const known = entries.filter((entry) => entry.count !== undefined)
    return {
      kind: "counter",
      title: widget.title ?? BoardFilters.title(widget.filter),
      known: known.length,
      entries,
      ...(known.length === 0
        ? {}
        : { total: known.reduce((sum, entry) => sum + (entry.count ?? 0), 0) }),
      ...(widget.warnAbove === undefined ? {} : { warnAbove: widget.warnAbove }),
    }
  }

  private static entry(
    widget: CounterWidget,
    engine: string,
    count: number | undefined,
  ): CounterEntry {
    const above = count !== undefined && widget.warnAbove !== undefined && count > widget.warnAbove
    return {
      engine,
      target: {
        engine,
        filter: BoardFilters.listFilter(widget.filter),
        ...(widget.filter.process === undefined ? {} : { bpmnProcessId: widget.filter.process }),
      },
      ...(count === undefined ? {} : { count }),
      ...(above ? { above: true as const } : {}),
    }
  }
}
