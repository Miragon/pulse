import { join } from "node:path"
import { BpmnProcessId, ElementId } from "@miragon/pulse-engine-core"
import type { EngineTarget } from "@miragon/pulse-runtime-view/host-kit"
import type { WorkspaceFiles } from "@miragon/pulse-runtime-view/ports"
import { describe, expect, test, vi } from "vitest"
import { CompositionRoot } from "../src/worker/composition-root.js"
import { OrcaWorkspaceFiles } from "../src/worker/orca-workspace-files.js"
import { LOCAL_TARGET } from "./local-target.js"

const CLUSTER: EngineTarget = {
  ...LOCAL_TARGET,
  name: "cluster",
  engine: "c8",
  endpoint: "http://localhost:8088/v2",
}

const MODELS: Readonly<Record<string, string>> = {
  "/shop/payment.bpmn": [
    '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn">',
    '<bpmn:process id="payment"><bpmn:serviceTask id="Activity_Charge" camunda:type="external" camunda:topic="charge-payment" />',
    "</bpmn:process></bpmn:definitions>",
  ].join(""),
  "/shop/shipping.bpmn": [
    '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:zeebe="http://camunda.org/schema/zeebe/1.0">',
    '<bpmn:process id="shipping"><bpmn:serviceTask id="Activity_Book"><bpmn:extensionElements>',
    '<zeebe:taskDefinition type="book-carrier" /></bpmn:extensionElements></bpmn:serviceTask>',
    "</bpmn:process></bpmn:definitions>",
  ].join(""),
  "/shop/migrated.bpmn": [
    '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"',
    ' xmlns:camunda="http://camunda.org/schema/1.0/bpmn" xmlns:zeebe="http://camunda.org/schema/zeebe/1.0">',
    '<bpmn:process id="migrated"><bpmn:serviceTask id="Activity_Charge"><bpmn:extensionElements>',
    '<zeebe:taskDefinition type="charge-payment" />',
    '<zeebe:ioMapping><zeebe:input source="=order.total" target="amount" /></zeebe:ioMapping>',
    "</bpmn:extensionElements></bpmn:serviceTask></bpmn:process></bpmn:definitions>",
  ].join(""),
}

const FILES: WorkspaceFiles = {
  find: (glob) => Promise.resolve(glob.endsWith(".bpmn") ? Object.keys(MODELS) : []),
  read: (uri) => Promise.resolve(MODELS[uri] ?? ""),
}

async function configurationOf(bpmnProcessId: string, elementId: string) {
  const { models } = CompositionRoot.create().localSources(FILES)
  const model = await models.modelOf(BpmnProcessId(bpmnProcessId))
  const element =
    model === undefined ? undefined : await models.elementIn(model, ElementId(elementId))
  return element?.configuration
}

describe("the composition root of the worker", () => {
  test("falls back to the local engine of the C7 adapter", () => {
    expect(CompositionRoot.create().engines.localTarget()).toEqual(LOCAL_TARGET)
  })

  test("wires the C7 adapter and the C8 adapter, each for its dialect", () => {
    const { engines } = CompositionRoot.create()
    const cockpit = {
      ...LOCAL_TARGET,
      webUiUrl: "http://localhost:8080/camunda/app/cockpit/default/",
    }
    const operate = { ...CLUSTER, webUiUrl: "http://localhost:8088/operate" }

    expect([engines.webUi(cockpit)?.name, engines.webUi(operate)?.name]).toEqual([
      "Cockpit",
      "Operate",
    ])
    expect(engines.commands(CLUSTER, { kind: "none" })).toBeUndefined()
    expect([engines.canWrite(LOCAL_TARGET), engines.canWrite(CLUSTER)]).toEqual([true, false])
  })

  test("reads Camunda 7, Camunda 8 and a model naming both with the adapters' BPMN dialects", async () => {
    expect((await configurationOf("payment", "Activity_Charge"))?.implementation).toEqual({
      kind: "workerTask",
      taskType: "charge-payment",
    })
    expect((await configurationOf("shipping", "Activity_Book"))?.implementation).toEqual({
      kind: "workerTask",
      taskType: "book-carrier",
    })
    expect(await configurationOf("migrated", "Activity_Charge")).toEqual({
      implementation: { kind: "workerTask", taskType: "charge-payment" },
      inputs: [{ target: "amount", source: "=order.total" }],
      outputs: [],
      errors: [],
    })
    expect(
      Object.keys(CompositionRoot.create().localSources(new OrcaWorkspaceFiles(() => []))),
    ).toEqual(["models", "code"])
  })

  test("finds the CLI's user config from the worker's environment, as the CLI does", () => {
    const isolated = join(process.env.XDG_CONFIG_HOME ?? "", "pulse-cli", "config.json")
    vi.stubEnv("PULSE_CLI_CONFIG", "/work/ci.json")
    const named = CompositionRoot.userConfig()
    vi.unstubAllEnvs()

    expect([named.path, named.explicit]).toEqual(["/work/ci.json", true])
    expect(CompositionRoot.userConfig().path).toBe(isolated)
  })
})
