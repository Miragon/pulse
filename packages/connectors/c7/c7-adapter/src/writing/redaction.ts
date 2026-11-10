import { engineDateInput } from "@miragon/pulse-c7-core"
import { LosslessJson } from "../engine-rest/index.js"
import { VariableBody } from "./variable-body.js"

const REDACTED = "‹value›"
const MIN_REDACTED_LENGTH = 3

export class Redaction {
  static readonly NOTHING = new Redaction([])

  constructor(private readonly secrets: readonly string[]) {}

  static ofValue(valueJson: string): Redaction {
    const text = valueJson.trim()
    const value = VariableBody.parsed(text)
    if (typeof value === "number" && Number.isFinite(value)) {
      return new Redaction([text, LosslessJson.stringify(value)])
    }
    if (typeof value !== "string") {
      return new Redaction([text])
    }
    const engineDate = engineDateInput(value)
    return new Redaction(engineDate === undefined ? [text, value] : [text, value, engineDate])
  }

  static ofText(text: string | undefined): Redaction {
    return text === undefined
      ? Redaction.NOTHING
      : new Redaction([text, text.trim(), JSON.stringify(text).slice(1, -1)])
  }

  applyTo(message: string): string {
    return this.secrets
      .filter((secret) => secret.length >= MIN_REDACTED_LENGTH)
      .reduce((text, secret) => text.replaceAll(secret, REDACTED), message)
  }
}
