/**
 * Shared helpers of the workflow command tests through `run()`
 * (src/cli/workflow/workflow*.test.ts): the fake workflow engine with a runtime whose sleeps
 * advance it, and the error line.
 */

import { execute, fakeRuntime, type FakeRuntimeOptions } from "./fake-runtime.js"
import { type Stage, WorkflowEngine } from "./workflow-engine.js"

type Run = Parameters<typeof execute>[0]

/**
 * The fake engine at `stage`, a runtime whose sleeps advance it, and `cli`, which runs `run` with
 * fresh stdout and stderr. The test passes its `run`: test/support never imports the command layer.
 */
export function workflowSetup(
  run: Run,
  stage: Stage = "approve",
  options: FakeRuntimeOptions = {},
) {
  const engine = new WorkflowEngine(stage)
  const runtime = fakeRuntime({
    fetch: engine.fetch,
    onSleep: () => {
      engine.tick()
    },
    ...options,
  })
  const cli = async (args: readonly string[]) => {
    runtime.stdout.chunks.length = 0
    runtime.stderr.chunks.length = 0
    return execute(run, args, runtime)
  }
  return { engine, runtime, cli }
}

export function errorOf(stderr: string): Record<string, unknown> {
  return (JSON.parse(stderr) as { error: Record<string, unknown> }).error
}
