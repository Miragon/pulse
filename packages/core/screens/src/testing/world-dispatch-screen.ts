import type { InstanceScreenData } from "../format/instance-screen-data.js"

export const WORLD_DISPATCH_SCREEN: InstanceScreenData = {
  engine: "conformance",
  asOf: "2026-11-19T09:00:00.000Z",
  instance: {
    id: "fake-DSP-3001",
    definition: {
      id: "pulse-dispatch:1",
      bpmnProcessId: "pulse-dispatch",
      version: 1,
      name: "Dispatch order",
    },
    state: "running",
    hasIncident: true,
    businessKey: "DSP-3001",
    startedAt: "2026-10-21T08:00:00.000Z",
  },
  caller: null,
  headline: {
    code: "incidentInCalledInstance",
    incidentId: "incident-of-fake-label-of-DSP-3001",
    elementId: "Activity_PrintShippingLabel",
    liesIn: {
      instanceId: "fake-label-of-DSP-3001",
      bpmnProcessId: "pulse-label",
    },
    since: "2026-10-21T08:00:02.000Z",
    suspended: false,
  },
  markers: [
    {
      elementId: "Activity_PrintShippingLabel",
      kind: "incidentInCalledInstance",
    },
    {
      elementId: "Event_DispatchRequested",
      kind: "completed",
    },
  ],
  calls: [
    {
      elementId: "Activity_PrintShippingLabel",
      kind: "instances",
      instances: [
        {
          id: "fake-label-of-DSP-3001",
          bpmnProcessId: "pulse-label",
          state: "running",
          withIncident: true,
        },
      ],
    },
  ],
  incidents: [
    {
      rootIncident: {
        id: "incident-of-fake-label-of-DSP-3001",
        instanceId: "fake-label-of-DSP-3001",
        definition: {
          id: "pulse-label:1",
          bpmnProcessId: "pulse-label",
          version: 1,
          name: "Print label",
        },
      },
      liesIn: {
        instanceId: "fake-label-of-DSP-3001",
        bpmnProcessId: "pulse-label",
      },
      elementId: "Activity_RenderLabel",
      type: "failedTask",
      message: "Cannot resolve identifier",
      createdAt: "2026-10-21T08:00:02.000Z",
      retriesLeft: 0,
      job: {
        id: "job-of-fake-label-of-DSP-3001",
      },
      text: "stacktrace",
      rootCauseLine: "MissingBean: Cannot resolve identifier",
      causeSource: "stacktrace",
    },
  ],
  waits: [
    {
      elementId: "Activity_RenderLabel",
      kind: "asyncContinuation",
      incidentId: "incident-of-fake-label-of-DSP-3001",
      retriesLeft: 0,
      liesIn: {
        instanceId: "fake-label-of-DSP-3001",
        bpmnProcessId: "pulse-label",
      },
    },
  ],
  path: [
    {
      elementId: "Event_DispatchRequested",
      startedAt: "2026-10-21T08:00:00.000Z",
      state: "completed",
      endedAt: "2026-10-21T08:00:01.000Z",
      durationMs: 1000,
    },
    {
      elementId: "Activity_PrintShippingLabel",
      startedAt: "2026-10-21T08:00:01.000Z",
      state: "active",
    },
  ],
  variables: [
    {
      name: "orderId",
      valueJson: '"ORD-1001"',
      truncated: false,
      type: "String",
      kind: "string",
    },
  ],
  truncated: false,
  unread: [],
}
