export class MigrationPlanRules {
  static readonly MAX_ID_LENGTH = 255
  static readonly MAX_VERSION = 2147483647
  private static readonly NAME = /^[\p{L}_][\p{L}\p{M}\p{N}_.·-]{0,254}$/u
  private static readonly SCOPE_SEPARATOR = "#"

  static isProcessId(value: unknown): value is string {
    return typeof value === "string" && MigrationPlanRules.NAME.test(value)
  }

  static isElementId(value: unknown): value is string {
    if (typeof value !== "string") {
      return false
    }
    const parts = value.split(MigrationPlanRules.SCOPE_SEPARATOR)
    return parts.length <= 2 && parts.every((part) => MigrationPlanRules.NAME.test(part))
  }

  static isVersion(value: unknown): value is number {
    return (
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= MigrationPlanRules.MAX_VERSION
    )
  }
}
