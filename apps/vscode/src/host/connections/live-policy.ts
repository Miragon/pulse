import type { LiveSetting } from "../../core/index.js"
import type { Environment } from "../../core/protocol/index.js"

const DEFAULTS: Readonly<Record<Environment, LiveSetting>> = {
  local: "on",
  test: "on",
  production: "off",
  unclassified: "off",
}

export class LivePolicy {
  static settingFor(environment: Environment, user: unknown): LiveSetting {
    return LivePolicy.valueIn(user, environment) ?? DEFAULTS[environment]
  }

  static turnedOn(user: unknown, environment: Environment): Readonly<Record<string, unknown>> {
    const current = typeof user === "object" && user !== null ? user : {}
    return { ...current, [environment]: "on" }
  }

  private static valueIn(scope: unknown, environment: Environment): LiveSetting | undefined {
    if (typeof scope !== "object" || scope === null) {
      return undefined
    }
    const value = (scope as Readonly<Record<string, unknown>>)[environment]
    return value === "on" || value === "off" ? value : undefined
  }
}
