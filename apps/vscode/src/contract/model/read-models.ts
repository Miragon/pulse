import type {
  BpmnProcessId,
  DefinitionId,
  ElementId,
  IncidentId,
  InstanceId,
  IsoTimestamp,
} from './ids.js';

export interface EngineInfo {
  readonly product: string;
  readonly version: string;
}

export interface DefinitionRef {
  readonly id: DefinitionId;
  readonly bpmnProcessId: BpmnProcessId;
  readonly version: number;
  readonly name?: string;
}

export interface RuntimeCounts {
  readonly running: number;
  readonly withIncident: number;
}

export interface DefinitionSummary extends RuntimeCounts {
  readonly latest: DefinitionRef;
}

export interface VersionSummary extends RuntimeCounts {
  readonly definition: DefinitionRef;
}

export interface CalledProcess {
  readonly elementId: ElementId;
  readonly bpmnProcessId: BpmnProcessId;
  readonly definition?: DefinitionRef;
}

export interface ElementStatistics {
  readonly elementId: ElementId;
  readonly active: number;
  readonly incidents: number;
  readonly incidentsInCalledInstances: number;
}

export type InstanceState = 'running' | 'suspended' | 'completed' | 'terminated';

export interface InstanceSummary {
  readonly id: InstanceId;
  readonly definition: DefinitionRef;
  readonly state: InstanceState;
  readonly hasIncident: boolean;
  readonly businessKey?: string;
  readonly startedAt?: IsoTimestamp;
  readonly endedAt?: IsoTimestamp;
  readonly parentInstanceId?: InstanceId;
}

interface WaitStateBase {
  readonly instanceId: InstanceId;
  readonly elementId: ElementId;
  readonly elementName?: string;
  readonly attachedToElementId?: ElementId;
  readonly since?: IsoTimestamp;
  readonly incidentId?: IncidentId;
}

export type WaitState = WaitStateBase &
  (
    | { readonly kind: 'userTask'; readonly assignee?: string; readonly dueAt?: IsoTimestamp }
    | { readonly kind: 'workerTask'; readonly taskType: string; readonly retriesLeft?: number }
    | { readonly kind: 'asyncContinuation'; readonly retriesLeft?: number }
    | { readonly kind: 'timer'; readonly dueAt?: IsoTimestamp }
    | { readonly kind: 'message'; readonly messageName?: string; readonly correlationKey?: string }
    | { readonly kind: 'signal'; readonly signalName?: string }
    | { readonly kind: 'other'; readonly description: string }
  );

export type WaitStateKind = WaitState['kind'];

export interface IncidentDetails {
  readonly kind: 'stacktrace' | 'errorMessage';
  readonly text: string;
  readonly truncated: boolean;
}

export interface IncidentJob {
  readonly id: string;
  readonly type?: string;
}

export interface Incident {
  readonly id: IncidentId;
  readonly instanceId: InstanceId;
  readonly definition: DefinitionRef;
  readonly elementId: ElementId;
  readonly type: string;
  readonly message: string;
  readonly createdAt: IsoTimestamp;
  readonly retriesLeft?: number;
  readonly job?: IncidentJob;
  readonly details?: IncidentDetails;
}

export interface CalledInstance {
  readonly id: InstanceId;
  readonly parentInstanceId: InstanceId;
  readonly bpmnProcessId: BpmnProcessId;
  readonly state: InstanceState;
  readonly calledFromElementId?: ElementId;
}

export type VariableScope =
  { readonly kind: 'instance' } | { readonly kind: 'element'; readonly elementId: ElementId };

export type ValueKind =
  'string' | 'integer' | 'decimal' | 'boolean' | 'date' | 'json' | 'null' | 'opaque';

export interface Variable {
  readonly name: string;
  readonly scope: VariableScope;
  readonly valueJson: string;
  readonly truncated: boolean;
  readonly type?: string;
  readonly kind?: ValueKind;
}

export interface ElementRun {
  readonly elementId: ElementId;
  readonly elementName?: string;
  readonly startedAt: IsoTimestamp;
  readonly endedAt?: IsoTimestamp;
  readonly canceled: boolean;
}

export interface InstanceDetail {
  readonly instance: InstanceSummary;
  readonly path: readonly ElementRun[];
  readonly waitStates: readonly WaitState[];
  readonly incidents: readonly Incident[];
  readonly calledInstances: readonly CalledInstance[];
  readonly variables: readonly Variable[];
  readonly truncated: boolean;
}
