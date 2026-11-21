import type { FindScreenData } from "../format/find-screen-data.js"

const ASKED = "2026-11-19T09:00:00.000Z"

export const WORLD_FIND_BY_BUSINESS_KEY: FindScreenData = {
  engine: "conformance",
  asOf: ASKED,
  hits: [
    {
      id: "fake-ORD-1003",
      definition: {
        id: "pulse-order:1",
        bpmnProcessId: "pulse-order",
        version: 1,
        name: "Order fulfillment",
      },
      state: "completed",
      hasIncident: false,
      businessKey: "ORD-1003",
      startedAt: "2026-10-21T08:00:00.000Z",
      endedAt: "2026-10-21T08:00:01.000Z",
    },
  ],
  cut: false,
  historyGap: null,
}

export const WORLD_FIND_BY_ID: FindScreenData = {
  engine: "conformance",
  asOf: ASKED,
  hits: [
    {
      id: "fake-label-of-DSP-3001",
      definition: {
        id: "pulse-label:1",
        bpmnProcessId: "pulse-label",
        version: 1,
        name: "Print label",
      },
      state: "running",
      hasIncident: true,
      startedAt: "2026-10-21T08:00:00.000Z",
    },
  ],
  cut: false,
  historyGap: null,
}
