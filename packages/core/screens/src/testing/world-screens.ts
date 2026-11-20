import type { EngineScreenData } from "../format/engine-screen-data.js"
import type { InstanceListData } from "../format/instance-list-data.js"
import type { InstanceScreenData } from "../format/instance-screen-data.js"
import type { ProcessScreenData } from "../format/process-screen-data.js"
import { WORLD_DISPATCH_SCREEN } from "./world-dispatch-screen.js"
import { WORLD_LABEL_SCREEN } from "./world-label-screen.js"
import {
  WORLD_DISPATCH_PROCESS_SCREEN,
  WORLD_ORDER_SCREEN,
  WORLD_ORDER_V1_LIST,
  WORLD_ORDER_V1_SCREEN,
} from "./world-process-screens.js"

export interface WorldScreens {
  readonly about: string
  readonly engine: EngineScreenData
  readonly instance: InstanceScreenData
  readonly calledInstance: InstanceScreenData
  readonly process: ProcessScreenData
  readonly olderVersion: ProcessScreenData
  readonly callingProcess: ProcessScreenData
  readonly instanceList: InstanceListData
}

export const WORLD_SCREENS: WorldScreens = {
  about:
    "The screens the builder gives over the fixed world of the conformance kit of @miragon/pulse-engine-core/testing (FakeWorld.seed() in a FakeEngine), read at asOf for an engine named conformance, in their JSON form: the engine, the instance DSP-3001 that waits at its call activity for the incident of the instance it called, and that called instance; the process pulse-order at its latest version, which says that older versions still run, and at its version 1, where an incident stops an instance at an element; the process pulse-dispatch, whose call activity waits for an incident in the instance it called; and every instance of pulse-order's version 1, running and ended, in pages of 50 with the counts of each scope.",
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
  process: WORLD_ORDER_SCREEN,
  olderVersion: WORLD_ORDER_V1_SCREEN,
  callingProcess: WORLD_DISPATCH_PROCESS_SCREEN,
  instanceList: WORLD_ORDER_V1_LIST,
}
