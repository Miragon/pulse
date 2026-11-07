import type { IncidentDetails, SourceLocation } from "../../../src/contract/index.js"
import type { InstanceChoice, MigrationTarget } from "../../../src/core/index.js"
import type { Environment } from "../../../src/core/protocol/index.js"
import type { Connection } from "../../../src/host/connections/connection.js"
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
