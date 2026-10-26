import type { MoveOption } from "./move-models.js"
import type { BulkView, SelectionView } from "./bulk-views.js"
import type { Notice } from "./notices.js"

export type Environment = "local" | "test" | "production" | "unclassified"

export interface EngineAccess {
  readonly writable: boolean
  readonly note: string
}

export interface EngineBadge {
  readonly name: string
  readonly environment: Environment
  readonly host: string
  readonly product?: string
  readonly access?: EngineAccess
  readonly webUi?: string
}

export interface WebUiLink {
  readonly label: string
  readonly title: string
}

export type InstanceStateLabel = "Running" | "Suspended" | "Completed" | "Terminated"

export interface VersionOption {
  readonly definitionId: string
  readonly version: number
  readonly running: number
  readonly withIncident: number
}

export interface ElementBadge {
  readonly elementId: string
  readonly running: number
  readonly incidents: number
  readonly incidentsInCalledInstances: number
}

export interface CallLink {
  readonly elementId: string
  readonly label: string
  readonly missing?: true
}

export interface InstanceRow {
  readonly id: string
  readonly shortId: string
  readonly businessKey?: string
  readonly state: InstanceStateLabel
  readonly hasIncident: boolean
  readonly startedAt?: string
  readonly selectable?: true
  readonly selected?: true
}

export type InstanceScope = "running" | "withIncident" | "ended" | "all"

export type VariableOperator = "equals" | "notEquals" | "like" | "greaterThan" | "lessThan"

export type VariableValueType = "text" | "number" | "boolean"

export interface VariableConditionView {
  readonly name: string
  readonly operator: VariableOperator
  readonly value: string
  readonly as?: VariableValueType
}

export interface InstanceListFilter {
  readonly scope: InstanceScope
  readonly elementId?: string
  readonly businessKey?: string
  readonly variables?: readonly VariableConditionView[]
}

export type ScopeCounts = Readonly<Record<InstanceScope, number>>

export interface DefinitionView {
  readonly kind: "definition"
  readonly engine: EngineBadge
  readonly asOf: string
  readonly processName: string
  readonly bpmnProcessId: string
  readonly versions: readonly VersionOption[]
  readonly selectedDefinitionId: string
  readonly selectedVersion: number
  readonly diagramXml: string
  readonly badges: readonly ElementBadge[]
  readonly calls: readonly CallLink[]
  readonly instances: readonly InstanceRow[]
  readonly hasMoreInstances: boolean
  readonly filter: InstanceListFilter
  readonly scopeCounts: ScopeCounts
  readonly historyNote?: string
  readonly notices: readonly Notice[]
  readonly webUi?: WebUiLink
  readonly model?: LocalModelLink
  readonly selection?: SelectionView
  readonly bulk?: BulkView
}

export type MarkerKind = "waiting" | "incident" | "incidentInCalledInstance" | "completed" | "taken"

export interface ElementMarker {
  readonly elementId: string
  readonly kind: MarkerKind
}

export interface CalledInstanceLink {
  readonly instanceId: string
  readonly shortId: string
  readonly bpmnProcessId: string
}

export interface JobLink {
  readonly id: string
  readonly shortId: string
  readonly type?: string
}

export interface ModelSetting {
  readonly label: string
  readonly value: string
}

export interface ModelFacts {
  readonly fileName: string
  readonly settings: readonly ModelSetting[]
  readonly differsFromDeployed?: true
  readonly codeLabel?: string
}

interface LocalModelLink {
  readonly fileName: string
  readonly differsFromDeployed?: true
  readonly code?: { readonly elementId: string; readonly label: string }
}

export interface IncidentRow {
  readonly id: string
  readonly shortId: string
  readonly elementId: string
  readonly typeLabel: string
  readonly engineType: string
  readonly message: string
  readonly rootCause?: string
  readonly createdAt: string
  readonly retriesLeft?: number
  readonly detailsLabel?: string
  readonly inCalledInstance?: CalledInstanceLink
  readonly job?: JobLink
  readonly retryable?: true
  readonly model?: ModelFacts
}

export type PathState = "active" | "completed" | "canceled"

export interface PathRow {
  readonly elementId: string
  readonly elementName?: string
  readonly startedAt: string
  readonly endedAt?: string
  readonly duration?: string
  readonly state: PathState
}

export interface WaitRow {
  readonly elementId: string
  readonly elementName?: string
  readonly kindLabel: string
  readonly detail?: string
  readonly since?: string
  readonly dueAt?: string
  readonly calledInstance?: CalledInstanceLink
  readonly moveRefusal?: string
}

export type VariableEditor = "text" | "integer" | "decimal" | "boolean" | "date" | "json" | "any"

export interface VariableRow {
  readonly name: string
  readonly type?: string
  readonly valueJson: string
  readonly scopeElementId?: string
  readonly truncated: boolean
  readonly editor?: VariableEditor
  readonly shadowedAt?: readonly string[]
}

export type WriteTarget =
  | { readonly kind: "incident"; readonly incidentId: string }
  | { readonly kind: "variable"; readonly name: string }
  | { readonly kind: "token"; readonly fromElementId: string }

export type WriteState =
  | { readonly status: "pending" | "done" | "cancelled"; readonly target: WriteTarget }
  | { readonly status: "failed"; readonly target: WriteTarget; readonly message: string }

export interface ParentLink {
  readonly instanceId: string
  readonly label: string
}

export interface InstanceHeader {
  readonly id: string
  readonly shortId: string
  readonly businessKey?: string
  readonly state: InstanceStateLabel
  readonly processName: string
  readonly bpmnProcessId: string
  readonly version: number
  readonly definitionId: string
  readonly startedAt?: string
  readonly endedAt?: string
  readonly parent?: ParentLink
}

export interface InstanceView {
  readonly kind: "instance"
  readonly engine: EngineBadge
  readonly asOf: string
  readonly instance: InstanceHeader
  readonly diagramXml: string
  readonly markers: readonly ElementMarker[]
  readonly calls: readonly CallLink[]
  readonly headline?: Notice
  readonly incidents: readonly IncidentRow[]
  readonly waitStates: readonly WaitRow[]
  readonly path: readonly PathRow[]
  readonly variables: readonly VariableRow[]
  readonly truncated: boolean
  readonly moves?: readonly MoveOption[]
  readonly write?: WriteState
  readonly outcome?: Notice
  readonly notice?: Notice
  readonly webUi?: WebUiLink
  readonly model?: LocalModelLink
}

export type ProcessScope = "all" | "withIncident"

export interface ProcessListFilter {
  readonly scope: ProcessScope
  readonly search?: string
}

type ProcessScopeCounts = Readonly<Record<ProcessScope, number>>

export interface ProcessRow {
  readonly bpmnProcessId: string
  readonly name?: string
  readonly latestVersion: number
  readonly running: number
  readonly withIncident: number
}

export interface EngineView {
  readonly kind: "engine"
  readonly engine: EngineBadge
  readonly asOf: string
  readonly summary: string
  readonly processes: readonly ProcessRow[]
  readonly filter: ProcessListFilter
  readonly scopeCounts: ProcessScopeCounts
  readonly emptyText: string
  readonly webUi?: WebUiLink
}

export interface Problem {
  readonly title: string
  readonly detail: string
  readonly canEditConnection: boolean
  readonly needsCredentials?: true
}
