import type { InstanceSummary } from "@miragon/pulse-engine-core"
import type {
  CallerData,
  CallLinkData,
  InstanceHeadData,
  InstanceScreenData,
} from "../format/instance-screen-data.js"
import type { CallerModel, CallLinkModel, InstanceScreenModel } from "./instance-screen-model.js"
import { DefinitionJson } from "./definition-json.js"
import { InstanceRowsJson } from "./instance-rows-json.js"
import { Fields } from "./present.js"

export class InstanceJson {
  static of(model: InstanceScreenModel): InstanceScreenData {
    return {
      engine: model.engine,
      asOf: model.asOf.toISOString(),
      instance: InstanceJson.head(model.instance),
      caller: model.caller === undefined ? null : InstanceJson.caller(model.caller),
      headline: model.headline ?? null,
      markers: model.markers.map(({ elementId, kind }) => ({ elementId, kind })),
      calls: InstanceJson.calls(model.calls),
      incidents: model.incidents.map((card) => InstanceRowsJson.card(card)),
      waits: model.waits.map((row) => InstanceRowsJson.wait(row)),
      path: model.path.map((row) => InstanceRowsJson.path(row)),
      variables: model.variables.map((variable) => InstanceRowsJson.variable(variable)),
      truncated: model.truncated,
      unread: [...model.unread],
    }
  }

  static calls(links: readonly CallLinkModel[]): CallLinkData[] {
    return links.map(({ elementId, target }): CallLinkData => {
      switch (target.kind) {
        case "instances":
          return {
            elementId,
            kind: "instances",
            instances: target.choices.map(({ instance, withIncident }) => ({
              id: instance.id,
              bpmnProcessId: instance.bpmnProcessId,
              ...Fields.tenant(instance.tenantId),
              state: instance.state,
              withIncident,
            })),
          }
        case "definition":
          return {
            elementId,
            kind: "definition",
            definition: DefinitionJson.of(target.definition),
          }
        case "missing":
          return {
            elementId,
            kind: "missing",
            bpmnProcessId: target.bpmnProcessId,
            ...Fields.tenant(target.tenantId),
          }
      }
    })
  }

  private static head(instance: InstanceSummary): InstanceHeadData {
    const { id, definition, state, hasIncident, businessKey, startedAt, endedAt } = instance
    return {
      id,
      definition: DefinitionJson.of(definition),
      state,
      hasIncident,
      ...Fields.present({ businessKey, startedAt, endedAt }),
    }
  }

  private static caller({ instanceId, found }: CallerModel): CallerData {
    if (found === undefined) {
      return { instanceId, found: null }
    }
    const { definition, state, businessKey } = found
    return {
      instanceId,
      found: {
        definition: DefinitionJson.of(definition),
        state,
        ...Fields.present({ businessKey }),
      },
    }
  }
}
