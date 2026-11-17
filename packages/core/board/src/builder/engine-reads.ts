import type {
  BpmnProcessId,
  DefinitionId,
  DefinitionSummary,
  ElementStatistics,
  Incident,
  InstanceCount,
  InstanceFilter,
  InstanceSummary,
  Page,
} from "@miragon/pulse-engine-core"
import { BoardVocabulary } from "../format/board-vocabulary.js"
import type { BoardReads } from "./board-reads.js"

export type Read<Value> =
  { readonly value: Value; readonly error?: undefined } | { readonly error: unknown }

export class EngineReads {
  private readonly started = new Map<string, Promise<Read<unknown>>>()

  constructor(private readonly reads: BoardReads) {}

  static valueOf<Value>(read: Read<Value>): Value | undefined {
    return "value" in read ? read.value : undefined
  }

  summaries(): Promise<Read<readonly DefinitionSummary[]>> {
    return this.once("summaries", () => this.reads.listDefinitions())
  }

  count(filter: InstanceFilter): Promise<Read<InstanceCount>> {
    return this.once(`count|${JSON.stringify(filter)}`, () => this.reads.countInstances(filter))
  }

  firstPage(filter: InstanceFilter): Promise<Read<readonly InstanceSummary[]>> {
    return this.once(`page|${JSON.stringify(filter)}`, async () => {
      const page = await this.reads.searchInstances(filter, { limit: BoardVocabulary.LIST_LIMIT })
      return page.items
    })
  }

  diagram(definitionId: DefinitionId): Promise<Read<string | undefined>> {
    return this.once(`diagram|${definitionId}`, () => this.reads.getDiagramXml(definitionId))
  }

  statistics(definitionId: DefinitionId): Promise<Read<readonly ElementStatistics[]>> {
    return this.once(`statistics|${definitionId}`, () =>
      this.reads.getElementStatistics(definitionId),
    )
  }

  incidents(bpmnProcessId: BpmnProcessId | undefined): Promise<Read<Page<Incident>>> {
    return this.once(`incidents|${bpmnProcessId ?? ""}`, () =>
      this.reads.searchIncidents(bpmnProcessId === undefined ? {} : { bpmnProcessId }, {
        limit: BoardVocabulary.LIST_LIMIT,
      }),
    )
  }

  private once<Value>(key: string, read: () => Promise<Value>): Promise<Read<Value>> {
    const known = this.started.get(key)
    if (known !== undefined) {
      return known as Promise<Read<Value>>
    }
    const reading = read().then(
      (value): Read<Value> => ({ value }),
      (error: unknown): Read<Value> => ({ error }),
    )
    this.started.set(key, reading)
    return reading
  }
}
