import type { CallLinkData, DefinitionRefData } from "./instance-screen-data.js"

export type ProcessReadCode = "diagram" | "statistics" | "calledProcesses"

export interface VersionData {
  readonly definition: DefinitionRefData
  readonly running: number
  readonly withIncident: number
}

export interface ElementBadgeData {
  readonly elementId: string
  readonly running: number
  readonly incidents: number
  readonly incidentsInCalledInstances: number
}

export interface OlderVersionsData {
  readonly code: "olderVersionsRun"
  readonly running: number
  readonly withIncident: number
  readonly show: DefinitionRefData
}

export type ProcessNoticeData = OlderVersionsData

export type ProcessNoticeCode = ProcessNoticeData["code"]

export interface ProcessScreenData {
  readonly engine: string
  readonly asOf: string
  readonly bpmnProcessId: string
  readonly selected: DefinitionRefData | null
  readonly versions: readonly VersionData[]
  readonly badges: readonly ElementBadgeData[]
  readonly calls: readonly CallLinkData[]
  readonly notices: readonly ProcessNoticeData[]
  readonly unread: readonly ProcessReadCode[]
}
