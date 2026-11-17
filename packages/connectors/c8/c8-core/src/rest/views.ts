import type { PresentFields } from "./present.js"

export interface TopologyView {
  readonly gatewayVersion: string
}

export type DefinitionView = {
  readonly key: string
  readonly bpmnProcessId: string
  readonly version: number
} & PresentFields<{
  readonly name: string | undefined
  readonly versionTag: string | undefined
  readonly state: string | undefined
}>

export interface ProcessStatisticsView {
  readonly bpmnProcessId: string
  readonly withoutIncident: number
  readonly withIncident: number
}

export interface VersionStatisticsView {
  readonly key: string
  readonly withoutIncident: number
  readonly withIncident: number
}

export interface ElementStatisticsView {
  readonly elementId: string
  readonly active: number
  readonly incidents: number
}

export type InstanceView = {
  readonly key: string
  readonly definitionKey: string
  readonly bpmnProcessId: string
  readonly version: number
  readonly state: string
  readonly hasIncident: boolean
} & PresentFields<{
  readonly definitionName: string | undefined
  readonly startedAt: string | undefined
  readonly endedAt: string | undefined
  readonly parentKey: string | undefined
  readonly parentElementKey: string | undefined
  readonly businessId: string | undefined
}>

export type ElementInstanceView = {
  readonly key: string
  readonly elementId: string
  readonly type: string
  readonly state: string
  readonly startedAt: string
} & PresentFields<{
  readonly name: string | undefined
  readonly endedAt: string | undefined
  readonly incidentKey: string | undefined
}>

export type JobView = {
  readonly key: string
  readonly type: string
  readonly state: string
} & PresentFields<{
  readonly kind: string | undefined
  readonly elementInstanceKey: string | undefined
  readonly retries: number | undefined
  readonly createdAt: string | undefined
}>

export type UserTaskView = {
  readonly elementInstanceKey: string
} & PresentFields<{
  readonly assignee: string | undefined
  readonly dueDate: string | undefined
}>

export type MessageSubscriptionView = {
  readonly elementInstanceKey: string
  readonly elementId: string
} & PresentFields<{
  readonly messageName: string | undefined
  readonly correlationKey: string | undefined
}>

export type IncidentView = {
  readonly key: string
  readonly instanceKey: string
  readonly definitionKey: string
  readonly elementId: string
  readonly type: string
  readonly message: string
  readonly createdAt: string
} & PresentFields<{
  readonly elementInstanceKey: string | undefined
  readonly jobKey: string | undefined
}>

export interface VariableView {
  readonly name: string
  readonly value: string
  readonly truncated: boolean
  readonly scopeKey: string
  readonly instanceKey: string
}

export interface SearchPage<Item> {
  readonly items: readonly Item[]
  readonly total: number
  readonly capped: boolean
  readonly endCursor?: string
}

export interface Rows<Item> {
  readonly items: readonly Item[]
  readonly cut: boolean
}

export interface Window {
  readonly limit: number
  readonly after?: string
}

export type SearchFilter = Readonly<Record<string, unknown>>
