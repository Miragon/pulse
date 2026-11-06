import { C7BpmnDialect } from "../../../src/adapters/c7/c7-bpmn-dialect.js"
import { C8BpmnDialect } from "../../../src/adapters/c8/c8-bpmn-dialect.js"

export const DIALECTS = [new C7BpmnDialect(), new C8BpmnDialect()]
