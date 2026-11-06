import type { ElementImplementation, ImplementationRule } from "../../contract/index.js"
import type { ModdleElement } from "bpmn-moddle"
import { ModelParser } from "./model-parser.js"

export class ImplementationReader {
  static of(
    element: ModdleElement,
    rules: readonly ImplementationRule[],
  ): ElementImplementation | undefined {
    for (const rule of rules) {
      const value = ImplementationReader.valueOf(element, rule)
      if (value !== undefined) {
        return ImplementationReader.implementation(rule.kind, value)
      }
    }
    return undefined
  }

  private static valueOf(element: ModdleElement, rule: ImplementationRule): string | undefined {
    if (rule.when !== undefined && element.get(rule.when.property) !== rule.when.equals) {
      return undefined
    }
    const owner =
      rule.extension === undefined
        ? element
        : ModelParser.extensions(element).find((extension) => extension.$type === rule.extension)
    return ModelParser.text(owner, rule.property)
  }

  private static implementation(
    kind: ElementImplementation["kind"],
    value: string,
  ): ElementImplementation {
    switch (kind) {
      case "class":
        return { kind, className: value }
      case "delegate":
      case "expression":
        return { kind, expression: value }
      case "workerTask":
        return { kind, taskType: value }
    }
  }
}
