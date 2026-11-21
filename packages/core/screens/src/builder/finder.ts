import { InstanceId, type InstanceSummary } from "@miragon/pulse-engine-core"
import { HistoryGaps, type HistoryGapData } from "../format/history-gaps.js"
import type {
  FindFacts,
  FinderGapReads,
  FinderReads,
  FinderSearchReads,
  FindModel,
  FindSearch,
} from "./finder-model.js"

export class Finder {
  static readonly MOST = 20

  static async read(
    engine: string,
    text: string,
    reads: FinderReads,
    now: () => Date,
  ): Promise<FindModel> {
    Finder.check(text)
    const searched = Finder.search(text, reads, now)
    const historyGap = Finder.historyGap(reads).then(
      (gap) => gap ?? undefined,
      () => undefined,
    )
    return Finder.of({ engine, ...(await searched), historyGap: await historyGap })
  }

  static async search(
    text: string,
    reads: FinderSearchReads,
    now: () => Date,
  ): Promise<FindSearch> {
    Finder.check(text)
    const asOf = now()
    const [byId, byBusinessKey] = await Promise.all([
      reads.searchInstances({ instanceIds: [InstanceId(text)] }, { limit: 1 }),
      reads.searchInstances({ businessKey: text }, { limit: Finder.MOST }),
    ])
    return { asOf, byId, byBusinessKey }
  }

  static async historyGap(reads: FinderGapReads): Promise<HistoryGapData | null> {
    const definitions = await reads.listDefinitions()
    const counted = await reads.countInstances({})
    const running = definitions.reduce((total, summary) => total + summary.running, 0)
    return HistoryGaps.between(running, counted.count, counted.atLeast === true) ?? null
  }

  static of(facts: FindFacts): FindModel {
    const { engine, asOf, byId, byBusinessKey, historyGap } = facts
    const seen = new Set<string>()
    const hits = [...byId.items, ...byBusinessKey.items].filter((hit: InstanceSummary) => {
      const first = !seen.has(hit.id)
      seen.add(hit.id)
      return first
    })
    return {
      engine,
      asOf,
      hits,
      cut: byBusinessKey.next !== undefined,
      ...(historyGap === undefined ? {} : { historyGap }),
    }
  }

  private static check(text: string): void {
    if (text.trim() === "") {
      throw new RangeError("An instance is found by its id or its business key, never by no text")
    }
  }
}
