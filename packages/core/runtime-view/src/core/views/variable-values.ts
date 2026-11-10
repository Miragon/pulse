import { ValueKinds, type ValueKind } from "@miragon/pulse-engine-core"
import type { VariableEditor } from "../protocol/index.js"

const NUMBER_KINDS: ReadonlySet<ValueKind> = new Set<ValueKind>(["integer", "decimal"])
const WHOLE_NUMBER_EDITORS: ReadonlySet<VariableEditor> = new Set<VariableEditor>([
  "integer",
  "any",
])
const ZONED_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/

const EXPECTED: Readonly<Record<VariableEditor, string>> = {
  text: "text",
  integer: "a whole number",
  decimal: "a number",
  boolean: "true or false",
  date: "a date and time with a zone, such as 2026-10-22T10:00:00Z",
  json: "valid JSON",
  any: "valid JSON",
}

export interface VariableTarget {
  readonly name: string
  readonly editor: VariableEditor
  readonly type?: string
}

export class VariableValues {
  private static readonly CHECKS: Readonly<Record<VariableEditor, (text: string) => boolean>> = {
    text: (text) => typeof VariableValues.parsed(text) === "string",
    integer: (text) => ValueKinds.ofJson(text) === "integer",
    decimal: (text) => NUMBER_KINDS.has(ValueKinds.ofJson(text)),
    boolean: (text) => text === "true" || text === "false",
    date: (text) => VariableValues.isZonedTimestamp(text),
    json: (text) => VariableValues.parsed(text) !== undefined,
    any: (text) => VariableValues.parsed(text) !== undefined,
  }

  static whyInvalid(target: VariableTarget, valueJson: string): string | undefined {
    const text = valueJson.trim()
    if (text === "null") {
      return undefined
    }
    if (VariableValues.isBeyondWholeNumbers(target.editor, text)) {
      return VariableValues.beyondWholeNumbers(target)
    }
    return VariableValues.CHECKS[target.editor](text)
      ? undefined
      : `${target.name} takes ${EXPECTED[target.editor]} (${target.type ?? target.editor}).`
  }

  private static isBeyondWholeNumbers(editor: VariableEditor, text: string): boolean {
    return (
      WHOLE_NUMBER_EDITORS.has(editor) &&
      ValueKinds.ofJson(text) === "integer" &&
      !ValueKinds.isWholeNumber(text)
    )
  }

  private static beyondWholeNumbers(target: VariableTarget): string {
    const range = `${ValueKinds.WHOLE_NUMBER_MIN.toString()} to ${ValueKinds.WHOLE_NUMBER_MAX.toString()}`
    if (target.editor === "any") {
      return `Pulse writes no number without a fraction outside ${range}. Write ${target.name} as text to keep every digit.`
    }
    return `${target.name} takes a whole number (${target.type ?? target.editor}), and Pulse writes none outside ${range}.`
  }

  private static parsed(text: string): unknown {
    try {
      return JSON.parse(text) as unknown
    } catch {
      return undefined
    }
  }

  private static isZonedTimestamp(text: string): boolean {
    const value = VariableValues.parsed(text)
    return (
      typeof value === "string" && ZONED_TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value))
    )
  }
}
