import type { BpmnProcessId, DefinitionId, ProcessRuntime } from "@miragon/pulse-engine-core"
import type { SourceLocation } from "../../ports/index.js"
import type { DiagramCache } from "../diagrams/diagram-cache.js"
import type { OpenOptions } from "../panels/panel-context.js"
import type { EngineBadge, PanelState } from "../protocol/index.js"

export interface PlanSource {
  readonly fileName: string
  readonly location: SourceLocation
  size(): Promise<number>
  read(): Promise<string>
  write(text: string): Promise<boolean>
}

export interface PlanNavigation {
  openDefinition(
    bpmnProcessId: BpmnProcessId,
    definitionId: DefinitionId,
    options: OpenOptions,
  ): void
  openFile(): void
  goBack(): void
  copy(text: string, label: string): void
  editConnection(): void
  setCredentials(): void
}

export interface PlanContext {
  readonly source: PlanSource
  readonly runtime: ProcessRuntime
  readonly diagrams: DiagramCache
  readonly engine: EngineBadge
  readonly navigation: PlanNavigation
  readonly publish: (state: PanelState) => void
  readonly now: () => Date
  readonly wait: (milliseconds: number) => Promise<void>
}
