import {
  ElementId,
  ValueKinds,
  type ValueKind,
  type Variable,
  type VariableScope,
} from "../../../contract/index.js"
import { Present, type VariableView } from "../engine-rest/index.js"
import type { Mapper } from "./mapper.js"

const KIND_OF_TYPE: ReadonlyMap<string, ValueKind> = new Map<string, ValueKind>([
  ["String", "string"],
  ["Short", "integer"],
  ["Integer", "integer"],
  ["Long", "integer"],
  ["Double", "decimal"],
  ["Boolean", "boolean"],
  ["Date", "date"],
  ["Json", "json"],
  ["Null", "null"],
])

export class VariableMapper implements Mapper<VariableView, Variable> {
  map(view: VariableView): Variable {
    return {
      name: view.name,
      scope: this.scopeOf(view),
      valueJson: this.valueJsonOf(view),
      truncated: false,
      kind: this.kindOf(view),
      ...Present.fields({ type: view.type }),
    }
  }

  private embeddedJsonOf(view: VariableView): string {
    const value: unknown = JSON.parse(view.valueJson)
    return typeof value === "string" ? value : view.valueJson
  }

  private valueJsonOf(view: VariableView): string {
    return view.type === "Json" ? this.embeddedJsonOf(view) : view.valueJson
  }

  private kindOf(view: VariableView): ValueKind {
    if (view.type === undefined) {
      return ValueKinds.ofJson(view.valueJson)
    }
    return KIND_OF_TYPE.get(view.type) ?? "opaque"
  }

  private scopeOf(view: VariableView): VariableScope {
    return view.scopeElementId === undefined
      ? { kind: "instance" }
      : { kind: "element", elementId: ElementId(view.scopeElementId) }
  }
}
