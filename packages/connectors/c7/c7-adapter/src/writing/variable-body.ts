import { autoTypedValue, toEngineVariable, type TypedValue } from "@miragon/pulse-c7-core"
import {
  RuntimeError,
  ValueKinds,
  type ValueKind,
  type VariableChange,
} from "@miragon/pulse-engine-core"
import { LosslessJson } from "../engine-rest/index.js"

const INTEGER_KINDS: ReadonlySet<ValueKind> = new Set<ValueKind>(["integer"])
const NUMBER_KINDS: ReadonlySet<ValueKind> = new Set<ValueKind>(["integer", "decimal"])

type EditorForm = (text: string) => unknown

export class VariableBody {
  private static readonly FORMS: ReadonlyMap<string, EditorForm> = new Map<string, EditorForm>([
    ["String", (text) => VariableBody.text(text)],
    ["Short", (text) => VariableBody.number(text, INTEGER_KINDS)],
    ["Integer", (text) => VariableBody.number(text, INTEGER_KINDS)],
    ["Long", (text) => VariableBody.number(text, INTEGER_KINDS)],
    ["Double", (text) => VariableBody.number(text, NUMBER_KINDS)],
    ["Boolean", (text) => (text === "true" || text === "false" ? text === "true" : undefined)],
    ["Date", (text) => VariableBody.text(text)],
    ["Json", (text) => (VariableBody.parsed(text) === undefined ? undefined : text)],
    ["Null", () => undefined],
  ])

  static of(change: VariableChange): string {
    const typed = VariableBody.typedValueOf(change)
    return LosslessJson.stringify(VariableBody.engineVariable(change.name, typed))
  }

  static parsed(text: string): unknown {
    try {
      return LosslessJson.parse(text)
    } catch {
      return undefined
    }
  }

  private static typedValueOf(change: VariableChange): TypedValue {
    const text = change.valueJson.trim()
    if (change.type === undefined) {
      return VariableBody.inferred(change.name, text)
    }
    const form = VariableBody.FORMS.get(change.type)
    if (form === undefined) {
      throw new RuntimeError("rejected", `Pulse does not change variables of type ${change.type}.`)
    }
    const value = text === "null" ? null : form(text)
    if (value === undefined) {
      throw VariableBody.invalid(change.name, change.type)
    }
    return { value, type: change.type }
  }

  private static inferred(name: string, text: string): TypedValue {
    const value = VariableBody.parsed(text)
    if (value === undefined) {
      throw new RuntimeError("rejected", `The new value of ${name} is not valid JSON.`)
    }
    const kind = ValueKinds.ofJson(text)
    if (kind === "string") {
      return { value, type: "String" }
    }
    if (kind === "json") {
      return { value: text, type: "Json" }
    }
    const typed = autoTypedValue(text)
    const finiteNumber = kind === "decimal" && Number.isFinite(Number(text))
    return finiteNumber && typed.type === "String" ? { value, type: "Double" } : typed
  }

  private static engineVariable(name: string, typed: TypedValue): unknown {
    try {
      return toEngineVariable(name, typed)
    } catch {
      throw VariableBody.invalid(name, typed.type)
    }
  }

  private static text(text: string): string | undefined {
    const value = VariableBody.parsed(text)
    return typeof value === "string" ? value : undefined
  }

  private static number(text: string, kinds: ReadonlySet<ValueKind>): unknown {
    return kinds.has(ValueKinds.ofJson(text)) ? VariableBody.parsed(text) : undefined
  }

  private static invalid(name: string, type: string): RuntimeError {
    return new RuntimeError("rejected", `The new value of ${name} is not a valid ${type}.`)
  }
}
