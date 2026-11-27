export type InstanceStateCode = "running" | "suspended" | "completed" | "terminated"

export type WaitKindCode =
  "userTask" | "workerTask" | "asyncContinuation" | "timer" | "message" | "signal" | "other"

export type MarkerKindCode = "completed" | "waiting" | "incident" | "incidentInCalledInstance"

export type IncidentTextKind = "stacktrace" | "errorMessage"

export type CauseSourceCode = "stacktrace" | "workerError" | "errorMessage"

export type PathStateCode = "active" | "completed" | "canceled"

export type CallLinkKind = "instances" | "definition" | "missing"

export type InstanceReadCode = "diagram" | "calledProcesses" | "caller"

export type ValueKindCode =
  "string" | "integer" | "decimal" | "boolean" | "date" | "json" | "null" | "opaque"

export interface DefinitionRefData {
  readonly id: string
  readonly bpmnProcessId: string
  readonly version: number
  readonly name?: string
}

export interface InstanceHeadData {
  readonly id: string
  readonly definition: DefinitionRefData
  readonly state: InstanceStateCode
  readonly hasIncident: boolean
  readonly businessKey?: string
  readonly startedAt?: string
  readonly endedAt?: string
}

export interface CallerFactsData {
  readonly definition: DefinitionRefData
  readonly state: InstanceStateCode
  readonly businessKey?: string
}

export interface CallerData {
  readonly instanceId: string
  readonly found: CallerFactsData | null
}

export interface CalledInstanceRefData {
  readonly instanceId: string
  readonly bpmnProcessId?: string
}

export type HeadlineData =
  | {
      readonly code: "incident"
      readonly incidentId: string
      readonly elementId: string
      readonly since: string
      readonly suspended: boolean
    }
  | {
      readonly code: "incidentInCalledInstance"
      readonly incidentId: string
      readonly elementId: string | null
      readonly liesIn: CalledInstanceRefData
      readonly since: string
      readonly suspended: boolean
    }
  | { readonly code: "incidents"; readonly count: number; readonly suspended: boolean }
  | { readonly code: "incidentsAtLeast"; readonly count: number; readonly suspended: boolean }
  | { readonly code: "suspended" }
  | { readonly code: "ended"; readonly state: "completed" | "terminated" }

export type HeadlineCode = HeadlineData["code"]

export interface MarkerData {
  readonly elementId: string
  readonly kind: MarkerKindCode
}

export interface CalledInstanceData {
  readonly id: string
  readonly bpmnProcessId: string
  readonly state: InstanceStateCode
  readonly withIncident: boolean
}

export type CallLinkData =
  | {
      readonly elementId: string
      readonly kind: "instances"
      readonly instances: readonly CalledInstanceData[]
    }
  | {
      readonly elementId: string
      readonly kind: "definition"
      readonly definition: DefinitionRefData
    }
  | { readonly elementId: string; readonly kind: "missing"; readonly bpmnProcessId: string }

export interface RootIncidentData {
  readonly id: string
  readonly instanceId: string
  readonly definition: DefinitionRefData
}

export interface IncidentJobData {
  readonly id: string
  readonly type?: string
}

export interface IncidentCardData {
  readonly rootIncident: RootIncidentData
  readonly liesIn: CalledInstanceRefData | null
  readonly elementId: string
  readonly type: string
  readonly message: string
  readonly createdAt: string
  readonly retriesLeft?: number
  readonly job?: IncidentJobData
  readonly text: IncidentTextKind | null
  readonly rootCauseLine: string | null
  readonly causeSource: CauseSourceCode | null
}

export interface WaitRowData {
  readonly elementId: string
  readonly kind: WaitKindCode
  readonly elementName?: string
  readonly since?: string
  readonly dueAt?: string
  readonly incidentId?: string
  readonly assignee?: string
  readonly taskType?: string
  readonly retriesLeft?: number
  readonly messageName?: string
  readonly signalName?: string
  readonly description?: string
  readonly liesIn: CalledInstanceRefData | null
}

export interface PathRowData {
  readonly elementId: string
  readonly elementName?: string
  readonly startedAt: string
  readonly endedAt?: string
  readonly state: PathStateCode
  readonly durationMs?: number
}

export interface VariableRowData {
  readonly name: string
  readonly valueJson: string
  readonly truncated: boolean
  readonly scopeElementId?: string
  readonly type?: string
  readonly kind?: ValueKindCode
}

export interface InstanceScreenData {
  readonly engine: string
  readonly asOf: string
  readonly instance: InstanceHeadData
  readonly caller: CallerData | null
  readonly headline: HeadlineData | null
  readonly markers: readonly MarkerData[]
  readonly calls: readonly CallLinkData[]
  readonly incidents: readonly IncidentCardData[]
  readonly waits: readonly WaitRowData[]
  readonly path: readonly PathRowData[]
  readonly variables: readonly VariableRowData[]
  readonly truncated: boolean
  readonly unread: readonly InstanceReadCode[]
}
