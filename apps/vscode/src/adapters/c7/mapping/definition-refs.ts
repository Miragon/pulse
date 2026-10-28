import { BpmnProcessId, DefinitionId, type DefinitionRef } from "../../../contract/index.js"
import { Present, type DefinitionView, type HistoricInstanceView } from "../engine-rest/index.js"

export class DefinitionRefs {
  static of(definition: DefinitionView): DefinitionRef {
    return {
      id: DefinitionId(definition.id),
      bpmnProcessId: BpmnProcessId(definition.key),
      version: definition.version,
      ...Present.fields({ name: definition.name }),
    }
  }

  static ofInstance(row: HistoricInstanceView): DefinitionRef {
    return DefinitionRefs.of({
      id: row.processDefinitionId,
      key: row.processDefinitionKey,
      version: row.processDefinitionVersion,
      ...Present.fields({ name: row.processDefinitionName }),
    })
  }
}
