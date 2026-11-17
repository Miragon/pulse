import { BpmnProcessId, DefinitionId, type DefinitionRef } from "@miragon/pulse-engine-core"
import { type DefinitionView, type InstanceView, Present } from "../rest/index.js"

export class DefinitionRefs {
  static of(definition: DefinitionView): DefinitionRef {
    return {
      id: DefinitionId(definition.key),
      bpmnProcessId: BpmnProcessId(definition.bpmnProcessId),
      version: definition.version,
      ...Present.fields({ name: definition.name }),
    }
  }

  static ofInstance(instance: InstanceView): DefinitionRef {
    return {
      id: DefinitionId(instance.definitionKey),
      bpmnProcessId: BpmnProcessId(instance.bpmnProcessId),
      version: instance.version,
      ...Present.fields({ name: instance.definitionName }),
    }
  }
}
