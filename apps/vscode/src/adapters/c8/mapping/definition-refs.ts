import { BpmnProcessId, DefinitionId, type DefinitionRef } from "../../../contract/index.js"
import type { DefinitionView, InstanceView } from "../rest/index.js"

export class DefinitionRefs {
  static of(definition: DefinitionView): DefinitionRef {
    return {
      id: DefinitionId(definition.key),
      bpmnProcessId: BpmnProcessId(definition.bpmnProcessId),
      version: definition.version,
      ...(definition.name === undefined ? {} : { name: definition.name }),
    }
  }

  static ofInstance(instance: InstanceView): DefinitionRef {
    return {
      id: DefinitionId(instance.definitionKey),
      bpmnProcessId: BpmnProcessId(instance.bpmnProcessId),
      version: instance.version,
      ...(instance.definitionName === undefined ? {} : { name: instance.definitionName }),
    }
  }
}
