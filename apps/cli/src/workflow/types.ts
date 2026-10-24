/**
 * Views printed by the workflow commands. Keys appear in the documented order,
 * absent values are left out, empty lists are kept. Types only.
 */

import type { PlannedRequest } from "../engine-port/engine-port.js"
import type { OperateError } from "../errors.js"
import type { Rec } from "./records.js"

export type InstanceState =
  "ACTIVE" | "SUSPENDED" | "COMPLETED" | "EXTERNALLY_TERMINATED" | "INTERNALLY_TERMINATED"

export interface DefinitionView {
  readonly key: string
  readonly version?: number
  readonly name?: string
  readonly id: string
}

interface WaitBase {
  /** Only when the wait is in a called instance. */
  readonly processInstanceId?: string
  readonly activityId: string
  readonly activityName?: string
  readonly activityType?: string
  /** The activity a boundary event is attached to. */
  readonly attachedTo?: string
  readonly since?: string
  readonly incidentId?: string
}

export type WaitKind =
  | "userTask"
  | "externalTask"
  | "timer"
  | "asyncContinuation"
  | "message"
  | "signal"
  | "conditional"
  | "other"

export type WaitState = WaitBase &
  (
    | {
        readonly kind: "userTask"
        readonly taskId: string
        readonly name?: string
        readonly assignee?: string
        readonly due?: string
      }
    | {
        readonly kind: "externalTask"
        readonly externalTaskId: string
        readonly topic: string
        readonly workerId?: string
        readonly lockExpirationTime?: string
        readonly retries?: number
        readonly errorMessage?: string
      }
    | {
        readonly kind: "timer"
        readonly jobId: string
        readonly dueDate: string
        readonly retries: number
        /** The job (or its job definition) is suspended: the job executor does not run it. */
        readonly suspended?: true
      }
    | {
        readonly kind: "asyncContinuation"
        readonly jobId: string
        readonly retries: number
        readonly dueDate?: string
        /** Left out when the wait state has an incident (the incident carries the message). */
        readonly exceptionMessage?: string
        readonly suspended?: true
      }
    | {
        readonly kind: "message" | "signal" | "conditional"
        readonly eventSubscriptionId: string
        readonly eventName?: string
        readonly executionId: string
      }
    | { readonly kind: "other"; readonly executionId: string }
  )

export interface IncidentView {
  readonly id: string
  readonly type: string
  readonly activityId: string
  readonly processInstanceId?: string
  readonly message?: string
  readonly rootCause?: string
  readonly jobId?: string
  readonly externalTaskId?: string
  readonly since: string
  readonly annotation?: string
  readonly stacktrace?: readonly string[]
}

export interface ChildView {
  readonly id: string
  readonly parentId: string
  readonly key: string
  readonly version?: number
  readonly businessKey?: string
  readonly state: "ACTIVE" | "SUSPENDED"
}

export interface TimelineIncident {
  readonly type: string
  readonly message?: string
  readonly state: "open" | "resolved" | "deleted"
}

export interface TimelineEntry {
  readonly activityId: string
  readonly activityName?: string
  readonly activityType: string
  readonly startTime: string
  readonly endTime?: string
  readonly durationMs?: number
  readonly canceled?: true
  readonly assignee?: string
  readonly calledProcessInstanceId?: string
  readonly incidents?: readonly TimelineIncident[]
}

/** How a wait ended successfully: the condition that held. */
export interface Waited {
  readonly until: string
  readonly elapsedMs: number
  readonly polls: number
}

export interface InstanceView {
  readonly id: string
  readonly businessKey?: string
  readonly definition: DefinitionView
  readonly state: InstanceState
  readonly startTime?: string
  readonly endTime?: string
  readonly durationMs?: number
  readonly deleteReason?: string
  readonly parentId?: string
  /** Only when it differs from `id`. */
  readonly rootId?: string
  readonly waitingAt: readonly WaitState[]
  readonly incidents: readonly IncidentView[]
  readonly propagatedIncidents?: number
  readonly children: readonly ChildView[]
  readonly variables?: Readonly<Record<string, unknown>>
  readonly timeline?: readonly TimelineEntry[]
  readonly truncated?: true
  readonly next: readonly string[]
  readonly waited?: Waited
}

/** An instance that ended without a history record (history level none). */
export interface EndedInstance {
  readonly id: string
  readonly state: "ENDED"
  readonly waited?: Waited
}

/** One request of a `--dry-run`: `summary` names the writes. */
/** A write of a workflow command, previewed by `--dry-run`. */
export interface PlannedWrite extends PlannedRequest {
  readonly summary: string
}

/**
 * What a workflow command produced: its view (and, for exit code 9, the error to report after
 * printing it), or the requests of a `--dry-run` with the plan of the writes.
 */
export type WorkflowResult<V> =
  | { readonly kind: "view"; readonly view: V; readonly failure?: OperateError }
  | {
      readonly kind: "dry-run"
      readonly plan?: unknown
      readonly requests: readonly PlannedRequest[]
    }

/** A process instance of the active tree. */
export interface TreeNode {
  readonly id: string
  readonly parentId?: string
  readonly definitionId: string
  readonly definitionKey?: string
  readonly businessKey?: string
  readonly suspended: boolean
  /** 0 for the selected instance. */
  readonly depth: number
}

/** The root cause of an incident, loaded for at most 10 incidents per run. */
export interface IncidentCause {
  readonly rootCause?: string
  readonly stacktrace?: readonly string[]
}

/** Everything `inspect` loaded for one instance; `instanceView` turns it into the view. */
export interface InstanceData {
  readonly id: string
  /** The ProcessInstanceDto; absent when the instance ended. */
  readonly runtime?: Rec
  /** The HistoricProcessInstanceDto; absent with history level none. */
  readonly history?: Rec
  /** The parent instance, when there is no history record. */
  readonly parentId?: string
  readonly tree: readonly TreeNode[]
  readonly truncated: boolean
  /** The activity instance tree of every instance of the tree. */
  readonly activityTrees: readonly Rec[]
  readonly incidents: readonly Rec[]
  readonly subscriptions: readonly Rec[]
  readonly tasks: readonly Rec[]
  readonly externalTasks: readonly Rec[]
  readonly jobs: readonly Rec[]
  readonly timerJobIds: ReadonlySet<string>
  readonly definitions: readonly Rec[]
  readonly jobDefinitions: readonly Rec[]
  /** The variable map of the process scope; absent with `--no-variables`. */
  readonly variables?: Rec
  /** Historic activity instances in BPMN order; only with `--history`. */
  readonly timeline?: readonly Rec[]
  readonly historicIncidents?: readonly Rec[]
  /** Root causes by incident id. */
  readonly causes: ReadonlyMap<string, IncidentCause>
  /** True when `--history` was given (the view then suggests no `--history`). */
  readonly historyRequested: boolean
}
