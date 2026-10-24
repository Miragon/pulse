import type { WriteAction } from "../../core/index.js"
import type { BulkKind, Environment } from "../../core/protocol/index.js"
import type { EngineTarget } from "./engine-target.js"
import type { EnvironmentSettings } from "./pulse-settings.js"
import { TargetHosts } from "./target-hosts.js"

export type Confirmation = "none" | "modal" | "typeHost"

export type BulkConfirmation = "typeCount" | "typeCountHost"

const LEVELS: Readonly<Record<Environment, number>> = {
  local: 0,
  test: 1,
  unclassified: 2,
  production: 2,
}
const CONFIRMATIONS: readonly Confirmation[] = ["none", "modal", "typeHost"]
const ACTION_FLOORS: Readonly<Record<WriteAction | BulkKind, number>> = {
  retryIncident: LEVELS.local,
  setVariable: LEVELS.local,
  moveToken: LEVELS.test,
  cancelInstances: LEVELS.local,
  migrateInstances: LEVELS.local,
}

export class ConfirmationPolicy {
  static confirmationFor(
    target: EngineTarget,
    settings: EnvironmentSettings,
    action: WriteAction | BulkKind,
  ): Confirmation {
    const base = Math.max(
      TargetHosts.isLoopback(target) ? LEVELS.local : LEVELS.unclassified,
      ACTION_FLOORS[action],
    )
    const raised = [settings.user, ...settings.workspace].map(
      (scope) => ConfirmationPolicy.levelOf(target, scope?.[target.name]) ?? 0,
    )
    const level = Math.max(base, ...raised)
    return CONFIRMATIONS[level] ?? "typeHost"
  }

  static bulkConfirmationOf(confirmation: Confirmation): BulkConfirmation {
    return confirmation === "typeHost" ? "typeCountHost" : "typeCount"
  }

  private static levelOf(target: EngineTarget, value: unknown): number | undefined {
    if (typeof value !== "string" || !Object.hasOwn(LEVELS, value)) {
      return undefined
    }
    return value === "local" && !TargetHosts.isLoopback(target)
      ? undefined
      : LEVELS[value as Environment]
  }
}
