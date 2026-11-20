import type { EngineScreenData } from "../format/engine-screen-data.js"
import type { InstanceScreenData } from "../format/instance-screen-data.js"
import { WORLD_DISPATCH_SCREEN } from "./world-dispatch-screen.js"
import { WORLD_LABEL_SCREEN } from "./world-label-screen.js"

export interface WorldScreens {
  readonly about: string
  readonly engine: EngineScreenData
  readonly instance: InstanceScreenData
  readonly calledInstance: InstanceScreenData
}

export const WORLD_SCREENS: WorldScreens = {
  about:
    "The screens the builder gives over the fixed world of the conformance kit of @miragon/pulse-engine-core/testing (FakeWorld.seed() in a FakeEngine), read at asOf for an engine named conformance, in their JSON form: the engine, the instance DSP-3001 that waits at its call activity for the incident of the instance it called, and that called instance.",
  engine: {
    engine: "conformance",
    asOf: "2026-11-19T09:00:00.000Z",
    info: { product: "Fake engine", version: "1.0.0" },
    processes: [
      {
        bpmnProcessId: "pulse-order",
        name: "Order fulfillment",
        latestVersion: 2,
        running: 3,
        withIncident: 1,
      },
      {
        bpmnProcessId: "pulse-dispatch",
        name: "Dispatch order",
        latestVersion: 1,
        running: 1,
        withIncident: 1,
      },
      {
        bpmnProcessId: "pulse-label",
        name: "Print label",
        latestVersion: 1,
        running: 1,
        withIncident: 1,
      },
    ],
    totals: { processes: 3, running: 5, withIncident: 3 },
  },
  instance: WORLD_DISPATCH_SCREEN,
  calledInstance: WORLD_LABEL_SCREEN,
}
