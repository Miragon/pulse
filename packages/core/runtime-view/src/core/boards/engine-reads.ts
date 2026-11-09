import {
  RuntimeError,
  type BpmnProcessId,
  type DefinitionId,
  type DefinitionSummary,
  type ElementStatistics,
  type Incident,
  type InstanceFilter,
  type InstanceSummary,
  type Page,
  type ProcessRuntime,
} from "../../contract/index.js"
import type { SharedDefinitions } from "../refresh/shared-definitions.js"
import { BoardVocabulary } from "./board-vocabulary.js"

export type Read<Value> = { readonly value: Value } | { readonly failed: true }

export class EngineReads {
  private readonly started = new Map<string, Promise<Read<unknown>>>()

  constructor(
    private readonly runtime: ProcessRuntime,
    private readonly definitions: SharedDefinitions,
  ) {}

  static valueOf<Value>(read: Read<Value>): Value | undefined {
    return "value" in read ? read.value : undefined
  }

  summaries(): Promise<Read<readonly DefinitionSummary[]>> {
    return this.once("summaries", () => this.definitions.read(0))
  }

  count(filter: InstanceFilter): Promise<Read<number>> {
    return this.once(`count|${JSON.stringify(filter)}`, () => this.runtime.countInstances(filter))
  }

  firstPage(filter: InstanceFilter): Promise<Read<readonly InstanceSummary[]>> {
    return this.once(`page|${JSON.stringify(filter)}`, async () => {
      const page = await this.runtime.searchInstances(filter, { limit: BoardVocabulary.LIST_LIMIT })
      return page.items
    })
  }

  diagram(definitionId: DefinitionId): Promise<Read<string>> {
    return this.once(`diagram|${definitionId}`, async () => {
      const xml = await this.runtime.getDiagramXml(definitionId)
      if (xml === undefined) {
        throw new RuntimeError("unexpectedResponse", "The engine has no diagram.")
      }
      return xml
    })
  }

  statistics(definitionId: DefinitionId): Promise<Read<readonly ElementStatistics[]>> {
    return this.once(`statistics|${definitionId}`, () =>
      this.runtime.getElementStatistics(definitionId),
    )
  }

  incidents(bpmnProcessId: BpmnProcessId | undefined): Promise<Read<Page<Incident>>> {
    return this.once(`incidents|${bpmnProcessId ?? ""}`, () =>
      this.runtime.searchIncidents(bpmnProcessId === undefined ? {} : { bpmnProcessId }, {
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
      (): Read<Value> => ({ failed: true }),
    )
    this.started.set(key, reading)
    return reading
  }
}
