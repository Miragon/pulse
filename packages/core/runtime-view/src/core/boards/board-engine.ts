import type { BpmnProcessId, InstanceId, ProcessRuntime } from "../../contract/index.js"
import type { OpenOptions } from "../panels/panel-context.js"
import type { EngineBadge, InstanceListFilter, PanelState } from "../protocol/index.js"
import type { SharedDefinitions } from "../refresh/shared-definitions.js"

export type BoardEngine =
  | { readonly name: string; readonly configured: false }
  | {
      readonly name: string
      readonly configured: true
      readonly badge: EngineBadge
      readonly runtime: ProcessRuntime
      readonly definitions: SharedDefinitions
    }

export interface BoardNavigation {
  openInstance(engine: string, instanceId: InstanceId, options: OpenOptions): void
  openDefinition(
    engine: string,
    bpmnProcessId: BpmnProcessId,
    filter: InstanceListFilter,
    options: OpenOptions,
  ): void
  openEngine(engine: string, options: OpenOptions): void
  openFile(): void
  editEngines(): void
  setCredentials(engine: string): void
  copy(text: string, label: string): void
}

export interface BoardContext {
  readonly fileName: string
  readonly read: () => Promise<string>
  readonly engines: (names: readonly string[]) => readonly BoardEngine[]
  readonly navigation: BoardNavigation
  readonly publish: (state: PanelState) => void
  readonly now: () => Date
}
