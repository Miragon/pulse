import type { BpmnProcessId, DefinitionId, ElementId, InstanceId, PageCursor } from "./ids.js"

export interface InstanceFilter {
  readonly bpmnProcessId?: BpmnProcessId
  readonly definitionId?: DefinitionId
  readonly lifecycle?: "running" | "ended"
  readonly withIncident?: boolean
  readonly businessKey?: string
  readonly activeElementId?: ElementId
  readonly instanceIds?: readonly InstanceId[]
}

export interface IncidentFilter {
  readonly bpmnProcessId?: BpmnProcessId
  readonly definitionId?: DefinitionId
  readonly instanceId?: InstanceId
}

export interface PageRequest {
  readonly limit: number
  readonly after?: PageCursor
}

export interface Page<Item> {
  readonly items: readonly Item[]
  readonly next?: PageCursor
}
