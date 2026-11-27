import type { InstanceCount } from "@miragon/pulse-engine-core"
import type { CounterWidget } from "../format/board-definition.js"
import type { CounterModel, CounterReading } from "./board-model.js"
import type { ProbedEngine } from "./engine-probe.js"
import { EngineReads } from "./engine-reads.js"
import { FilterQuery } from "./filter-query.js"

export class CounterTiles {
  static async build(
    widget: CounterWidget,
    engines: readonly Promise<ProbedEngine>[],
  ): Promise<CounterModel> {
    const query = FilterQuery.of(widget.filter)
    const readings = await Promise.all(
      engines.map(async (probed): Promise<CounterReading> => {
        const engine = await probed
        const count =
          engine.reads === undefined
            ? undefined
            : EngineReads.valueOf(await engine.reads.count(query))
        return CounterTiles.reading(engine.model.name, count, widget.warnAbove)
      }),
    )
    const known = readings.flatMap((reading) =>
      reading.count === undefined ? [] : [reading.count],
    )
    return {
      kind: "counter",
      widget,
      readings,
      known: known.length,
      ...(known.length === 0 ? {} : { total: CounterTiles.total(known) }),
    }
  }

  private static total(counts: readonly InstanceCount[]): InstanceCount {
    return {
      count: counts.reduce((sum, counted) => sum + counted.count, 0),
      ...(counts.some((counted) => counted.atLeast === true) ? { atLeast: true as const } : {}),
    }
  }

  private static reading(
    engine: string,
    count: InstanceCount | undefined,
    warnAbove: number | undefined,
  ): CounterReading {
    return {
      engine,
      ...(count === undefined ? {} : { count }),
      ...CounterTiles.threshold(count, warnAbove),
    }
  }

  private static threshold(
    counted: InstanceCount | undefined,
    warnAbove: number | undefined,
  ): Pick<CounterReading, "above" | "undecided"> {
    if (counted === undefined || warnAbove === undefined) {
      return {}
    }
    if (counted.count > warnAbove) {
      return { above: true }
    }
    return counted.atLeast === true ? { undecided: true } : {}
  }
}
