import type { InstanceCount } from "@miragon/pulse-engine-core"
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
      ...(known.some((entry) => entry.atLeast === true) ? { totalAtLeast: true as const } : {}),
      ...(widget.warnAbove === undefined ? {} : { warnAbove: widget.warnAbove }),
      ...(widget.filter.withIncident === true ? { incident: true as const } : {}),
    }
  }

  private static entry(
    widget: CounterWidget,
    engine: string,
    counted: InstanceCount | undefined,
  ): CounterEntry {
    const filter = BoardFilters.listFilter(widget.filter)
    const process = widget.filter.process
    return {
      engine,
      ...(filter === undefined
        ? {}
        : {
            target: {
              engine,
              filter,
              ...(process === undefined ? {} : { bpmnProcessId: process }),
            },
          }),
      ...(counted === undefined ? {} : { count: counted.count }),
      ...(counted?.atLeast === true ? { atLeast: true as const } : {}),
      ...CounterTiles.threshold(counted, widget.warnAbove),
    }
  }

  private static threshold(
    counted: InstanceCount | undefined,
    warnAbove: number | undefined,
  ): Pick<CounterEntry, "above" | "undecided"> {
    if (counted === undefined || warnAbove === undefined) {
      return {}
    }
    if (counted.count > warnAbove) {
      return { above: true }
    }
    return counted.atLeast === true ? { undecided: true } : {}
  }
}
