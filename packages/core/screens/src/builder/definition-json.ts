import type { DefinitionRef } from "@miragon/pulse-engine-core"
import type { DefinitionRefData } from "../format/instance-screen-data.js"
import { Fields } from "./present.js"

export class DefinitionJson {
  static of({ id, bpmnProcessId, tenantId, version, name }: DefinitionRef): DefinitionRefData {
    return { id, bpmnProcessId, ...Fields.tenant(tenantId), version, ...Fields.present({ name }) }
  }
}
