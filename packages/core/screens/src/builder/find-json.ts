import type { InstanceSummary } from "@miragon/pulse-engine-core"
import type { FindHitData, FindScreenData } from "../format/find-screen-data.js"
import { DefinitionJson } from "./definition-json.js"
import type { FindModel } from "./finder-model.js"
import { Fields } from "./present.js"

export class FindJson {
  static of(model: FindModel): FindScreenData {
    return {
      engine: model.engine,
      asOf: model.asOf.toISOString(),
      hits: model.hits.map((hit) => FindJson.hit(hit)),
      cut: model.cut,
      historyGap: model.historyGap === undefined ? null : { ...model.historyGap },
    }
  }

  private static hit(instance: InstanceSummary): FindHitData {
    const { id, definition, state, hasIncident, businessKey, startedAt, endedAt } = instance
    return {
      id,
      definition: DefinitionJson.of(definition),
      state,
      hasIncident,
      ...Fields.present({ businessKey, startedAt, endedAt }),
    }
  }
}
