/**
 * End-to-end scenario of the built CLI against one real engine. The tests of one engine run in
 * order and build on each other (deploy → start → work → finish), like an agent session would.
 */

import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { afterAll, beforeAll, describe } from "vitest"
import { registerProcessFlow } from "./scenario/process-flow.js"
import { registerRequests } from "./scenario/requests.js"
import { type Scenario, WORKER_ID } from "./scenario/suite.js"
import { registerValues } from "./scenario/values.js"
import { argv } from "./support/catalog.js"
import { assertCliBuilt, bindCli, type Cli } from "./support/cli.js"
import {
  ENGINE_START_TIMEOUT_MS,
  type EngineName,
  isEngineEnabled,
  type RunningEngine,
  startEngine,
} from "./support/engines.js"
import { expectSuccess, required } from "./support/expect.js"
import { EXTERNAL_TOPIC, PROCESS_KEY } from "./support/fixtures.js"
import { makeTempDir, removeTempDir } from "./support/temp.js"
import type { Count, ExternalTask, ProcessInstance, Task } from "./support/types.js"

export function registerScenario(engineName: EngineName): void {
  describe.skipIf(!isEngineEnabled(engineName))(`pulse-cli against ${engineName}`, () => {
    let engine: RunningEngine | undefined
    let workdir: string | undefined
    let configFile = ""
    let cli: Cli = () => Promise.reject(new Error("the engine did not start"))
    const state: { orderId?: string } = {}

    const engineUrl = () => required(engine, "the engine").url

    beforeAll(async () => {
      assertCliBuilt()
      workdir = await makeTempDir(`pulse-cli-it-${engineName}-`)
      configFile = join(workdir, "config.json")
      // PULSE_CLI_CONFIG names the file explicitly, so it must exist (an empty one: no profiles)
      await writeFile(configFile, '{"profiles":{}}\n')
      engine = await startEngine(engineName)
      cli = bindCli({
        url: engine.url,
        configFile,
        // keep the real user config out of reach even if PULSE_CLI_CONFIG is removed
        env: { XDG_CONFIG_HOME: workdir, PULSE_CLI_PLATFORM: engine.platform },
      })
    }, ENGINE_START_TIMEOUT_MS)

    afterAll(async () => {
      await engine?.stop()
      await removeTempDir(workdir)
    })

    async function startOrder(businessKey: string, variables: readonly string[] = []) {
      const result = expectSuccess(
        await cli(argv("process-definition start", [PROCESS_KEY], { businessKey, variables })),
      )
      return result.json<ProcessInstance>().id
    }

    async function countInstances(filter: Readonly<Record<string, string>>): Promise<number> {
      const result = expectSuccess(await cli(argv("process-instance count", [], filter)))
      return result.json<Count>().count
    }

    async function completeUserTask(processInstanceId: string): Promise<void> {
      const tasks = expectSuccess(await cli(argv("task list", [], { processInstanceId })))
      const [task] = tasks.json<Task[]>()
      const taskId = required(task, `user task of ${processInstanceId}`).id
      expectSuccess(await cli(argv("task complete", [taskId])))
    }

    /** Locks the `charge-card` task of the instance with that business key. */
    async function fetchAndLock(businessKey: string, viaStdin = false): Promise<ExternalTask[]> {
      const topics = [{ topicName: EXTERNAL_TOPIC, lockDuration: 60_000, businessKey }]
      const body = JSON.stringify({ topics })
      const result = await cli(
        argv("external-task fetch-and-lock", [], {
          workerId: WORKER_ID,
          maxTasks: 1,
          body: viaStdin ? "-" : body,
        }),
        viaStdin ? { stdin: body } : {},
      )
      return expectSuccess(result).json<ExternalTask[]>()
    }

    const scenario: Scenario = {
      engineName,
      cli: (args, options) => cli(args, options),
      engineUrl,
      workdir: () => required(workdir, "workdir"),
      configFile: () => configFile,
      state,
      startOrder,
      countInstances,
      completeUserTask,
      fetchAndLock,
    }
    registerProcessFlow(scenario)
    registerRequests(scenario)
    registerValues(scenario)
  })
}
