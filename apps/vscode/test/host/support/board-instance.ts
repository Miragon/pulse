import {
  BpmnProcessId,
  DefinitionId,
  InstanceId,
  type InstanceSummary,
} from "@miragon/pulse-runtime-view/contract"

export function instance(id: string, bpmnProcessId: string): InstanceSummary {
  return {
    id: InstanceId(id),
    definition: {
      id: DefinitionId(`${bpmnProcessId}:2`),
      bpmnProcessId: BpmnProcessId(bpmnProcessId),
      version: 2,
      name: "Order fulfillment",
    },
    state: "running",
    hasIncident: false,
    startedAt: "2026-10-26T08:00:00.000Z" as InstanceSummary["startedAt"] & string,
  }
}
