import type {
  BpmnProcessId,
  CalledProcess,
  DefinitionId,
  DefinitionRef,
  ElementStatistics,
  ProcessRuntime,
  VersionSummary,
} from "@miragon/pulse-engine-core"
import type { ProcessReadCode } from "../format/process-screen-data.js"
import type { CallLinkModel } from "./instance-screen-model.js"

export type ProcessScreenReads = Pick<
  ProcessRuntime,
  "listVersions" | "getDiagramXml" | "getElementStatistics" | "getCalledProcesses"
>

export interface ProcessScreenRequest {
  readonly bpmnProcessId: BpmnProcessId
  readonly definitionId?: DefinitionId
  readonly version?: number
}

export interface ProcessFacts {
  readonly engine: string
  readonly asOf: Date
  readonly bpmnProcessId: BpmnProcessId
  readonly versions: readonly VersionSummary[]
  readonly selected: DefinitionId | undefined
  readonly diagramXml: string | undefined
  readonly statistics: readonly ElementStatistics[] | undefined
  readonly calledProcesses: readonly CalledProcess[] | undefined
}

export interface OlderVersionsModel {
  readonly code: "olderVersionsRun"
  readonly running: number
  readonly withIncident: number
  readonly show: DefinitionRef
}

export type ProcessNoticeModel = OlderVersionsModel

export interface ProcessScreenModel {
  readonly engine: string
  readonly asOf: Date
  readonly bpmnProcessId: BpmnProcessId
  readonly selected: VersionSummary | undefined
  readonly versions: readonly VersionSummary[]
  readonly badges: readonly ElementStatistics[]
  readonly calls: readonly CallLinkModel[]
  readonly notices: readonly ProcessNoticeModel[]
  readonly unread: readonly ProcessReadCode[]
}
