export type BoardColumn =
  "engine" | "process" | "version" | "businessKey" | "state" | "startedAt" | "endedAt" | "incident"

export interface BoardFilter {
  readonly process?: string
  readonly activeElement?: string
  readonly state: "running" | "ended"
  readonly withIncident?: boolean
  readonly businessKey?: string
}

interface WidgetBase {
  readonly title?: string
  readonly engines: readonly string[]
}

export interface CounterWidget extends WidgetBase {
  readonly widget: "counter"
  readonly filter: BoardFilter
  readonly warnAbove?: number
}

export interface InstanceListWidget extends WidgetBase {
  readonly widget: "instanceList"
  readonly filter: BoardFilter
  readonly columns: readonly BoardColumn[]
}

export interface IncidentSummaryWidget extends WidgetBase {
  readonly widget: "incidentSummary"
  readonly groupBy: "engine" | "process"
}

export interface ProcessDiagramWidget extends WidgetBase {
  readonly widget: "processDiagram"
  readonly process: string
}

export interface IncidentListWidget extends WidgetBase {
  readonly widget: "incidentList"
  readonly process?: string
}

type PlainProblemCode =
  | "notJson"
  | "notAnObject"
  | "notAList"
  | "missing"
  | "ignoredKey"
  | "schemaNotText"
  | "blankText"
  | "engineNames"
  | "tenantIds"
  | "diagramOnOneEngine"
  | "notWholeNumber"
  | "noColumns"
  | "notBoolean"
  | "elementWithoutProcess"
  | "elementOnEnded"
  | "endedWithIncident"
  | "tenantsNotRead"

interface PlainProblem {
  readonly path: string
  readonly code: PlainProblemCode
}

interface ChoiceProblem {
  readonly path: string
  readonly code: "unknownKey" | "notOneOf" | "variableColumn"
  readonly values: { readonly choices: readonly string[] }
}

interface VersionProblem {
  readonly path: string
  readonly code: "unknownVersion"
  readonly values: { readonly found: string; readonly reads: number }
}

interface OutsideProblem {
  readonly path: string
  readonly code: "engineOutsideBoard"
  readonly values: { readonly engines: readonly string[] }
}

interface LimitProblem {
  readonly path: string
  readonly code: "tooManyWidgets"
  readonly values: { readonly position: number; readonly max: number }
}

interface DiagramProblem {
  readonly path: string
  readonly code: "diagramTooLong"
  readonly values: { readonly title: string; readonly engine: string }
}

export type ProblemData =
  PlainProblem | ChoiceProblem | VersionProblem | OutsideProblem | LimitProblem | DiagramProblem

export interface CountData {
  readonly count: number
  readonly atLeast?: true
}

export interface DefinitionData {
  readonly id: string
  readonly bpmnProcessId: string
  readonly tenantId?: string
  readonly version: number
  readonly name?: string
}

export interface CounterReadingData {
  readonly engine: string
  readonly count?: CountData
  readonly above?: true
  readonly undecided?: true
}

export interface CounterData {
  readonly kind: "counter"
  readonly widget: CounterWidget
  readonly readings: readonly CounterReadingData[]
  readonly known: number
  readonly total?: CountData
}

export type InstanceStateData = "running" | "suspended" | "completed" | "terminated"

export interface InstanceData {
  readonly id: string
  readonly definition: DefinitionData
  readonly state: InstanceStateData
  readonly hasIncident: boolean
  readonly businessKey?: string
  readonly startedAt?: string
  readonly endedAt?: string
}

export interface InstanceGroupData {
  readonly engine: string
  readonly instances?: readonly InstanceData[]
  readonly total?: CountData
}

export interface InstanceListData {
  readonly kind: "instanceList"
  readonly widget: InstanceListWidget
  readonly groups: readonly InstanceGroupData[]
}

export interface IncidentSummaryRowData {
  readonly engine: string
  readonly process?: DefinitionData
  readonly withIncident?: number
}

export interface IncidentSummaryData {
  readonly kind: "incidentSummary"
  readonly widget: IncidentSummaryWidget
  readonly engines: number
  readonly known: number
  readonly total?: number
  readonly rows: readonly IncidentSummaryRowData[]
}

export interface BadgeData {
  readonly elementId: string
  readonly active: number
  readonly incidents: number
  readonly incidentsInCalledInstances: number
}

export interface ProcessDiagramData {
  readonly kind: "processDiagram"
  readonly widget: ProcessDiagramWidget
  readonly engine: string
  readonly latest?: DefinitionData
  readonly notDeployed?: true
  readonly badges?: readonly BadgeData[]
}

export interface IncidentData {
  readonly id: string
  readonly instanceId: string
  readonly definition: DefinitionData
  readonly elementId: string
  readonly type: string
  readonly message: string
  readonly createdAt: string
}

export interface IncidentGroupData {
  readonly engine: string
  readonly incidents?: readonly IncidentData[]
  readonly more?: true
}

export interface IncidentListData {
  readonly kind: "incidentList"
  readonly widget: IncidentListWidget
  readonly groups: readonly IncidentGroupData[]
}

export interface RefusedData {
  readonly kind: "refused"
  readonly widget?: string
  readonly title?: string
  readonly problems: readonly ProblemData[]
}

export type TileData =
  | CounterData
  | InstanceListData
  | IncidentSummaryData
  | ProcessDiagramData
  | IncidentListData
  | RefusedData
