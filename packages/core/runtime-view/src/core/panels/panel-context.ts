import type {
  BpmnProcessId,
  CodeLocator,
  DefinitionId,
  DefinitionRef,
  IncidentDetails,
  InstanceId,
  InstanceSummary,
  ModelSource,
  ProcessCommands,
  ProcessRuntime,
  SourceLocation,
} from "../../contract/index.js"
import type { BulkKind, EngineBadge, Environment, PanelState, Problem } from "../protocol/index.js"
import type { DiagramCache } from "../diagrams/diagram-cache.js"
import type { LiveContext } from "../refresh/live-context.js"
import type { SharedDefinitions } from "../refresh/shared-definitions.js"
import type { BulkRuns } from "./bulk-runs.js"

export interface OpenOptions {
  readonly toSide: boolean
}

export interface InstanceChoice {
  readonly instanceId: InstanceId
  readonly label: string
  readonly description: string
}

export type WriteAction = "retryIncident" | "setVariable" | "moveToken"

export interface WriteRequest {
  readonly action: WriteAction
  readonly title: string
  readonly facts: readonly string[]
  readonly confirmLabel: string
}

export interface MigrationTarget {
  readonly bpmnProcessId: BpmnProcessId
  readonly sourceDefinitionId: DefinitionId
  readonly instanceIds: readonly InstanceId[]
}

export interface BulkRequest {
  readonly action: BulkKind
  readonly title: string
  readonly facts: readonly string[]
  readonly confirmLabel: string
  readonly selected: number
  readonly count: number
  readonly countPrompt: string
  readonly warning: string
  readonly takesReason: boolean
  readonly reasonPrompt: string
  readonly auditFields?: Readonly<Record<string, string | number>>
}

export interface BulkOutcomeReport {
  readonly action: BulkKind
  readonly operationId: string
  readonly phase: "finished" | "stopped"
  readonly total: number
  readonly remaining: number
  readonly failed: number
  readonly arrived?: number
}

export interface BulkAnswer {
  readonly reason?: string
}

export type WebUiTarget =
  | { readonly kind: "engine" }
  | { readonly kind: "instance"; readonly instance: InstanceSummary }
  | { readonly kind: "definition"; readonly definition: DefinitionRef }

export interface LocalSources {
  readonly models: ModelSource
  readonly code: CodeLocator
}

export interface PanelEffects {
  openInstance(instanceId: InstanceId, options: OpenOptions): void
  openDefinition(
    bpmnProcessId: BpmnProcessId,
    definitionId: DefinitionId,
    options: OpenOptions,
  ): void
  openLatestDefinition(bpmnProcessId: BpmnProcessId, options: OpenOptions): void
  openMigration(target: MigrationTarget): void
  pickInstance(title: string, choices: readonly InstanceChoice[]): Promise<InstanceId | undefined>
  openWebUi(target: WebUiTarget): void
  goBack(): void
  showIncidentDetails(title: string, details: IncidentDetails): void
  copyToClipboard(text: string, label: string): void
  editConnection(): void
  setCredentials(): void
  reportProblem(problem: Problem): void
  confirmWrite(request: WriteRequest): Promise<boolean>
  confirmBulk(request: BulkRequest): Promise<BulkAnswer | undefined>
  reportBulkOutcome(report: BulkOutcomeReport): void
  reportWritten(message: string): void
  openModel(location: SourceLocation, elementId?: string): void
  openSource(location: SourceLocation): void
  turnOnLiveUpdates(environment: Environment): void
}

export interface PanelContext {
  readonly runtime: ProcessRuntime
  readonly engine: EngineBadge
  readonly diagrams: DiagramCache
  readonly definitions: SharedDefinitions
  readonly effects: PanelEffects
  readonly publish: (state: PanelState) => void
  readonly now: () => Date
  readonly wait: (milliseconds: number) => Promise<void>
  readonly commands?: ProcessCommands
  readonly sources?: LocalSources
  readonly live?: LiveContext
  readonly bulkRuns: BulkRuns
}
