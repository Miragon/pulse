/** Wait settings, view options and an engine at a stage, for the wait tests (src/workflow/wait*). */

import type { WaitSettings } from "../../src/workflow/wait.js"
import { depsOf } from "./engine-port.js"
import { type Stage, WorkflowEngine } from "./workflow-engine.js"

export const IDLE: WaitSettings = {
  conditions: [{ kind: "idle" }],
  timeoutMs: 60_000,
  failOnIncident: true,
  executeJobs: false,
}
export const VIEW = { variables: false, history: false, stacktrace: false }

export function setup(stage: Stage) {
  const engine = new WorkflowEngine(stage)
  return {
    engine,
    deps: depsOf(engine.fetch, () => {
      engine.tick()
    }),
  }
}
