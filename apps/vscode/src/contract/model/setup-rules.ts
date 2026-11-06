import type { SetupValues } from "../ports/engine-setup.js"

export class SetupRules {
  static valueOf(values: SetupValues, key: string): string {
    return values[key] ?? ""
  }

  static notBlank(what: string): (value: string) => string | undefined {
    return (value) => (value.trim() === "" ? `Enter ${what}.` : undefined)
  }
}
