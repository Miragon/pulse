import type { IncidentDetails, SourceLocation } from "@miragon/pulse-runtime-view/contract"
import type { InstanceChoice, MigrationTarget } from "@miragon/pulse-runtime-view/core"
import type { Environment } from "@miragon/pulse-runtime-view/protocol"
import type { Connection } from "@miragon/pulse-runtime-view/host-kit"
import type { FrameAction, Notice, ViewSpec } from "../protocol.js"
import type { WriteConfirmation } from "./write-confirmation.js"

export interface ServiceHost {
  readonly confirmation: WriteConfirmation
  pick(title: string, choices: readonly InstanceChoice[]): Promise<string | undefined>
  notice(notice: Notice): void
  showIncident(engine: string, title: string, details: IncidentDetails): void
  openLocation(location: SourceLocation): void
  editConnection(): void
  askForLogin(connection: Connection): void
  turnOnLiveUpdates(environment: Environment): void
  noteWrite(): void
}

export interface ViewNavigation {
  open(engine: string, spec: ViewSpec, origin: string): void
  openMigration(engine: string, target: MigrationTarget, origin: string): void
  goBack(key: string): void
  frameAction(key: string, action: FrameAction): void
}

export interface EffectsHost {
  readonly services: ServiceHost
  readonly navigation: ViewNavigation
}
