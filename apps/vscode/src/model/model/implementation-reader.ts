import type { ElementImplementation } from "../../contract/index.js"
import type { ModdleElement } from "bpmn-moddle"
import { ModelParser } from "./model-parser.js"

export class ImplementationReader {
  static of(element: ModdleElement): ElementImplementation | undefined {
    const className = ModelParser.text(element, "camunda:class")
    if (className !== undefined) {
      return { kind: "class", className }
    }
    const delegate = ModelParser.text(element, "camunda:delegateExpression")
    if (delegate !== undefined) {
      return { kind: "delegate", expression: delegate }
    }
    const expression = ModelParser.text(element, "camunda:expression")
    if (expression !== undefined) {
      return { kind: "expression", expression }
    }
    const taskType = ImplementationReader.taskType(element)
    return taskType === undefined ? undefined : { kind: "workerTask", taskType }
  }

  private static taskType(element: ModdleElement): string | undefined {
    const topic = ModelParser.text(element, "camunda:topic")
    if (topic !== undefined && element.get("camunda:type") === "external") {
      return topic
    }
    const definition = ModelParser.extensions(element).find(
      (extension) => extension.$type === "zeebe:TaskDefinition",
    )
    return ModelParser.text(definition, "type")
  }
}
