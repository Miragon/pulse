import { JsonView } from "@miragon/pulse-c7-core/runtime"
import { LosslessJson, Present, type VariableView } from "../engine-rest/index.js"

export class InspectedVariables {
  static of(variables: Readonly<Record<string, unknown>> | undefined): VariableView[] {
    return Object.entries(variables ?? {}).map(([name, value]) =>
      InspectedVariables.variableOf(name, value),
    )
  }

  private static variableOf(name: string, value: unknown): VariableView {
    const typed = JsonView.ifObject(value)
    const type = typed?.value("type")
    if (typed === undefined || typeof type !== "string") {
      return { name, valueJson: LosslessJson.stringify(value) }
    }
    return {
      name,
      valueJson: LosslessJson.stringify(typed.value("value") ?? null),
      ...Present.fields({ type: type === "" ? undefined : type }),
    }
  }
}
