import type { BpmnDialect, ImplementationRule, MappingRule } from "../../contract/index.js"
import zeebe from "zeebe-bpmn-moddle/resources/zeebe.json" with { type: "json" }

export class C8BpmnDialect implements BpmnDialect {
  readonly descriptor = zeebe
  readonly fallback = false
  readonly implementations: readonly ImplementationRule[] = [
    { kind: "workerTask", extension: "zeebe:TaskDefinition", property: "type" },
  ]
  readonly mappings: readonly MappingRule[] = [
    {
      container: "zeebe:IoMapping",
      inputs: "inputParameters",
      outputs: "outputParameters",
      target: "target",
      source: "source",
    },
  ]
  readonly errorDefinitions: readonly string[] = []
  readonly workerMarkers: readonly string[] = ["JobWorker", "ZeebeWorker", "jobType"]
}
