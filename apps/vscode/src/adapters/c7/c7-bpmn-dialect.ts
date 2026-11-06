import type { BpmnDialect, ImplementationRule, MappingRule } from "../../contract/index.js"
import camunda from "camunda-bpmn-moddle/resources/camunda.json" with { type: "json" }

export class C7BpmnDialect implements BpmnDialect {
  readonly descriptor = camunda
  readonly fallback = true
  readonly implementations: readonly ImplementationRule[] = [
    { kind: "class", property: "camunda:class" },
    { kind: "delegate", property: "camunda:delegateExpression" },
    { kind: "expression", property: "camunda:expression" },
    {
      kind: "workerTask",
      property: "camunda:topic",
      when: { property: "camunda:type", equals: "external" },
    },
  ]
  readonly mappings: readonly MappingRule[] = [
    {
      container: "camunda:InputOutput",
      inputs: "inputParameters",
      outputs: "outputParameters",
      target: "name",
      source: "value",
    },
  ]
  readonly errorDefinitions: readonly string[] = ["camunda:ErrorEventDefinition"]
  readonly workerMarkers: readonly string[] = ["ExternalTaskSubscription", "subscribe", "topicName"]
}
