/**
 * The workflow commands (design §17) of the built CLI against one real engine: the fixture
 * `workflow.bpmn` (call activity with a user task in the child, external task, message, timer,
 * asynchronous job that fails, receive task) is deployed, started, inspected, advanced step by
 * step, waited for, retried and ended, like a developer or an agent would. The tests build on each
 * other.
 */

import { copyFile, mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { afterAll, beforeAll, describe } from "vitest"
import { assertCliBuilt, bindCli, type Cli } from "./support/cli.js"
import {
  ENGINE_START_TIMEOUT_MS,
  type EngineName,
  isEngineEnabled,
  type RunningEngine,
  startEngine,
} from "./support/engines.js"
import { expectSuccess, required } from "./support/expect.js"
import { FIXTURES } from "./support/fixtures.js"
import { makeTempDir, removeTempDir } from "./support/temp.js"
import { registerDeployAndAdvance } from "./workflow-scenario/deploy-and-advance.js"
import { registerStatusAndRetry } from "./workflow-scenario/status-and-retry.js"
import { BY_KEY, type InstanceOutput, type WorkflowScenario } from "./workflow-scenario/suite.js"

/** Another team's file with the same resource name (`workflow.bpmn`) and another process. */
const FOREIGN_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="other" targetNamespace="https://example.com/other">
  <bpmn:process id="other-process" isExecutable="true" camunda:historyTimeToLive="1">
    <bpmn:startEvent id="s" /><bpmn:sequenceFlow id="f" sourceRef="s" targetRef="e" /><bpmn:endEvent id="e" />
  </bpmn:process>
</bpmn:definitions>
`

export function registerWorkflowScenario(engineName: EngineName): void {
  describe.skipIf(!isEngineEnabled(engineName))(`workflow commands against ${engineName}`, () => {
    let engine: RunningEngine | undefined
    let workdir: string | undefined
    let cli: Cli = () => Promise.reject(new Error("the engine did not start"))
    const state: { deploymentId?: string; instanceId?: string } = {}

    const bpmnDir = () => join(required(workdir, "workdir"), "bpmn")

    beforeAll(async () => {
      assertCliBuilt()
      workdir = await makeTempDir(`operate-it-workflow-${engineName}-`)
      const configFile = join(workdir, "config.json")
      await writeFile(configFile, '{"profiles":{}}\n')
      await mkdir(join(workdir, "bpmn"))
      await copyFile(FIXTURES.workflow, join(workdir, "bpmn", "workflow.bpmn"))
      await mkdir(join(workdir, "other"))
      await writeFile(join(workdir, "other", "workflow.bpmn"), FOREIGN_BPMN)
      engine = await startEngine(engineName)
      cli = bindCli({
        url: engine.url,
        configFile,
        env: { XDG_CONFIG_HOME: workdir, OPERATE_PLATFORM: engine.platform },
      })
    }, ENGINE_START_TIMEOUT_MS)

    afterAll(async () => {
      await engine?.stop()
      await removeTempDir(workdir)
    })

    async function inspect(...extra: string[]): Promise<InstanceOutput> {
      return expectSuccess(await cli(["inspect", ...BY_KEY, ...extra])).json<InstanceOutput>()
    }

    const scenario: WorkflowScenario = {
      cli: (args, options) => cli(args, options),
      workdir: () => required(workdir, "workdir"),
      bpmnDir,
      state,
      inspect,
    }
    registerDeployAndAdvance(scenario)
    registerStatusAndRetry(scenario)
  })
}
