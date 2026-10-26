import type {
  DefinitionSummary,
  InstanceFilter,
  InstanceSummary,
  ProcessRuntime,
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
