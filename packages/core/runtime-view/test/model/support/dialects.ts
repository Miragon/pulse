import camunda from "camunda-bpmn-moddle/resources/camunda.json" with { type: "json" }
import zeebe from "zeebe-bpmn-moddle/resources/zeebe.json" with { type: "json" }
import type { BpmnDialect } from "../../../src/ports/index.js"

export const CAMUNDA: BpmnDialect = {
  descriptor: camunda,
  fallback: true,
  implementations: [
    { kind: "class", property: "camunda:class" },
    { kind: "delegate", property: "camunda:delegateExpression" },
    { kind: "expression", property: "camunda:expression" },
    {
      kind: "workerTask",
      property: "camunda:topic",
      when: { property: "camunda:type", equals: "external" },
    },
  ],
  mappings: [
    {
      container: "camunda:InputOutput",
      inputs: "inputParameters",
      outputs: "outputParameters",
      target: "name",
      source: "value",
    },
  ],
  errorDefinitions: ["camunda:ErrorEventDefinition"],
  workerMarkers: ["ExternalTaskSubscription", "subscribe", "topicName"],
}

export const ZEEBE: BpmnDialect = {
  descriptor: zeebe,
  fallback: false,
  implementations: [{ kind: "workerTask", extension: "zeebe:TaskDefinition", property: "type" }],
  mappings: [
    {
      container: "zeebe:IoMapping",
      inputs: "inputParameters",
      outputs: "outputParameters",
      target: "target",
      source: "source",
    },
  ],
  errorDefinitions: [],
  workerMarkers: ["JobWorker", "ZeebeWorker", "jobType"],
}

export const DIALECTS: readonly BpmnDialect[] = [CAMUNDA, ZEEBE]
