import type { WorldValue } from "../conformance/world/world.js"
import type { Variable } from "../model/read-models.js"

type TypedValue = Pick<Variable, "valueJson" | "type" | "kind">

export class FakeWorldValues {
  static of(value: WorldValue): TypedValue {
    if (value === null) {
      return { valueJson: "null", type: "Null", kind: "null" }
    }
    if (typeof value === "object") {
      return { valueJson: JSON.stringify(value.date), type: "Date", kind: "date" }
    }
    return typeof value === "number"
      ? { valueJson: JSON.stringify(value), type: "Integer", kind: "integer" }
      : { valueJson: JSON.stringify(value), type: "String", kind: "string" }
  }
}
