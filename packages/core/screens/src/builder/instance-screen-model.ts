import type {
  BpmnProcessId,
  CalledInstance,
  CalledProcess,
  DefinitionRef,
  ElementRun,
  Incident,
  IncidentDetails,
  IncidentId,
  InstanceDetail,
  InstanceId,
  InstanceSummary,
  ProcessRuntime,
  Variable,
  WaitState,
} from "@miragon/pulse-engine-core"
import type {
  CauseSourceCode,
  HeadlineData,
  IncidentTextKind,
  InstanceReadCode,
  MarkerData,
  PathStateCode,
} from "../format/instance-screen-data.js"

export type InstanceScreenReads = Pick<
  ProcessRuntime,
  "getInstanceDetail" | "getDiagramXml" | "getCalledProcesses" | "searchInstances"
>

export interface InstanceFacts {
  readonly engine: string
  readonly asOf: Date
  readonly detail: InstanceDetail
  readonly diagramXml: string | undefined
  readonly calledProcesses: readonly CalledProcess[] | undefined
  readonly caller: InstanceSummary | null | undefined
  readonly fullDetails?: ReadonlyMap<IncidentId, IncidentDetails>
}

export interface CalledInstanceRef {
  readonly instanceId: InstanceId
  readonly bpmnProcessId?: BpmnProcessId
}

export interface CalledInstanceChoice {
  readonly instance: CalledInstance
  readonly withIncident: boolean
}

export type CallTarget =
  | { readonly kind: "instances"; readonly choices: readonly CalledInstanceChoice[] }
  | { readonly kind: "definition"; readonly definition: DefinitionRef }
  | { readonly kind: "missing"; readonly bpmnProcessId: BpmnProcessId }

export interface CallLinkModel {
  readonly elementId: string
  readonly target: CallTarget
}

export interface IncidentCardModel {
  readonly incident: Incident
  readonly liesIn: CalledInstanceRef | undefined
  readonly text: IncidentTextKind | undefined
  readonly rootCauseLine: string | undefined
  readonly causeSource: CauseSourceCode | undefined
}

export interface WaitRowModel {
  readonly wait: WaitState
  readonly liesIn: CalledInstanceRef | undefined
}

export interface PathRowModel {
  readonly run: ElementRun
  readonly state: PathStateCode
  readonly durationMs: number | undefined
}

export interface CallerModel {
  readonly instanceId: InstanceId
  readonly read: boolean
  readonly found: InstanceSummary | undefined
}

export interface InstanceScreenModel {
  readonly engine: string
  readonly asOf: Date
  readonly instance: InstanceSummary
  readonly caller: CallerModel | undefined
  readonly headline: HeadlineData | undefined
  readonly markers: readonly MarkerData[]
  readonly calls: readonly CallLinkModel[]
  readonly incidents: readonly IncidentCardModel[]
  readonly waits: readonly WaitRowModel[]
  readonly path: readonly PathRowModel[]
  readonly variables: readonly Variable[]
  readonly truncated: boolean
  readonly unread: readonly InstanceReadCode[]
}
