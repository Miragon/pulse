import type { BulkFailure, BulkOperation } from "../model/bulk-operations.js"
import type { BpmnProcessId, ElementId, InstanceId } from "../model/ids.js"
import type { MigrationPlan } from "../model/migrations.js"
import type {
  DefinitionRef,
  ElementRun,
  EngineInfo,
  Incident,
  IncidentDetails,
  InstanceSummary,
  Variable,
  WaitState,
} from "../model/read-models.js"

interface FakeCall {
  readonly elementId: ElementId
  readonly bpmnProcessId: BpmnProcessId
}

export interface FakeDefinition {
  readonly ref: DefinitionRef
  readonly xml: string
  readonly calls: readonly FakeCall[]
}

export interface FakeInstance {
  readonly summary: InstanceSummary
  readonly activeElementIds: readonly ElementId[]
  readonly waitStates: readonly WaitState[]
  readonly variables: readonly Variable[]
  readonly path?: readonly ElementRun[]
  readonly calledFromElementId?: ElementId
}

export interface FakeIncident {
  readonly incident: Incident
  readonly fullDetails: IncidentDetails
}

export interface FakeBulkOperation {
  readonly operation: BulkOperation
  readonly pending: readonly InstanceId[]
  readonly plan?: MigrationPlan
  readonly failures?: readonly BulkFailure[]
}

export interface FakeEngineState {
  readonly engine: EngineInfo
  readonly definitions: readonly FakeDefinition[]
  readonly instances: readonly FakeInstance[]
  readonly incidents: readonly FakeIncident[]
  readonly bulkOperations?: readonly FakeBulkOperation[]
}
