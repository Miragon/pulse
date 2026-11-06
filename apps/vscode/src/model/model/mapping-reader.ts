import type { MappingRule, VariableMapping } from "../../contract/index.js"
import type { ModdleElement } from "bpmn-moddle"
import { ModelParser } from "./model-parser.js"

type Direction = "inputs" | "outputs"

export class MappingReader {
  static of(
    element: ModdleElement,
    rules: readonly MappingRule[],
    direction: Direction,
  ): VariableMapping[] {
    return ModelParser.extensions(element).flatMap((container) => {
      const rule = rules.find((each) => each.container === container.$type)
      return rule === undefined
        ? []
        : ModelParser.elements(container, rule[direction]).flatMap((parameter) =>
            MappingReader.mappingOf(parameter, rule),
          )
    })
  }

  private static mappingOf(parameter: ModdleElement, rule: MappingRule): VariableMapping[] {
    const target = ModelParser.text(parameter, rule.target)
    if (target === undefined) {
      return []
    }
    const source = ModelParser.text(parameter, rule.source)
    return [source === undefined ? { target } : { target, source }]
  }
}
