import { BpmnProcessId, DefinitionId, type DefinitionRef } from "../../../contract/index.js"
import { Present, type HistoricInstanceView } from "../engine-cli/index.js"
import type { Mapper } from "./mapper.js"

export class HistoricDefinitionRefMapper implements Mapper<HistoricInstanceView, DefinitionRef> {
  map(row: HistoricInstanceView): DefinitionRef {
    return {
      id: DefinitionId(row.processDefinitionId),
      bpmnProcessId: BpmnProcessId(row.processDefinitionKey),
      version: row.processDefinitionVersion,
      ...Present.fields({ name: row.processDefinitionName }),
    }
  }
}
