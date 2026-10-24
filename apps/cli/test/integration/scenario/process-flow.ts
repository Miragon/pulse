/** The scenario's main flow: deploy, start, work through and finish an order, and an incident. */

import { readFile } from "node:fs/promises"
import { expect, it } from "vitest"
import { argv, globalFlag } from "../support/catalog.js"
import { ENGINES } from "../support/engines.js"
import { expectSuccess, required } from "../support/expect.js"
import {
  DECISION_KEY,
  EXTERNAL_TOPIC,
  FIXTURES,
  PROCESS_KEY,
  USER_TASK_NAME,
} from "../support/fixtures.js"
import type {
  Count,
  Deployment,
  Incident,
  PingOutput,
  ProcessDefinition,
  ProcessDefinitionXml,
  ProcessInstance,
  Task,
  TypedValue,
} from "../support/types.js"
import { type Scenario, WORKER_ID } from "./suite.js"

export function registerProcessFlow(scenario: Scenario): void {
  const {
    cli,
    engineName,
    engineUrl,
    state,
    startOrder,
    countInstances,
    completeUserTask,
    fetchAndLock,
  } = scenario

  it("ping reports the engine as reachable", async () => {
    const result = expectSuccess(await cli(["ping"]))
    const ping = result.json<PingOutput>()
    expect(ping).toMatchObject({ url: engineUrl(), reachable: true })
    expect(ping.version).toBe(ENGINES[engineName].version)
    expect(ping.engines).toContain("default")
  })

  it("deploys the BPMN process and the DMN decision", async () => {
    const result = await cli(
      argv("deployment create", [FIXTURES.orderProcess, FIXTURES.approvalDecision], {
        "deployment-name": "it",
      }),
    )
    const deployment = expectSuccess(result).json<Deployment>()
    expect(deployment.id).toEqual(expect.any(String))
    expect(deployment.name).toBe("it")
    expect(Object.values(deployment.deployedProcessDefinitions ?? {})).toEqual([
      expect.objectContaining({ key: PROCESS_KEY, resource: "order-process.bpmn" }),
    ])
    expect(Object.values(deployment.deployedDecisionDefinitions ?? {})).toEqual([
      expect.objectContaining({ key: DECISION_KEY, resource: "approval.dmn" }),
    ])
  })

  it("lists the process definition and prints its BPMN XML raw", async () => {
    const list = expectSuccess(await cli(argv("process-definition list", [], { key: PROCESS_KEY })))
    expect(list.json<ProcessDefinition[]>()).toEqual([
      expect.objectContaining({ key: PROCESS_KEY, version: 1 }),
    ])

    const xml = expectSuccess(await cli(argv("process-definition xml", [PROCESS_KEY])))
    expect(xml.stdout).toMatch(/^(<\?xml|<bpmn:definitions|<definitions)/)
    expect(xml.stdout.trim()).toBe((await readFile(FIXTURES.orderProcess, "utf8")).trim())

    const explicitJson = await cli([
      ...argv("process-definition xml", [PROCESS_KEY]),
      globalFlag("output"),
      "json",
    ])
    expect(expectSuccess(explicitJson).json<ProcessDefinitionXml>()).toMatchObject({
      bpmn20Xml: expect.stringContaining('id="order-process"'),
    })
  })

  it("starts a process instance with typed variables", async () => {
    const result = await cli(
      argv("process-definition start", [PROCESS_KEY], {
        businessKey: "B-1",
        variables: ["amount=250", "customer=ACME"],
      }),
    )
    const instance = expectSuccess(result).json<ProcessInstance>()
    expect(instance).toMatchObject({ id: expect.any(String), businessKey: "B-1", ended: false })
    state.orderId = instance.id

    const variables = expectSuccess(
      await cli(argv("process-instance get-variables", [instance.id])),
    )
    expect(variables.json<Record<string, TypedValue>>()).toMatchObject({
      amount: { type: "Integer", value: 250 },
      customer: { type: "String", value: "ACME" },
    })
  })

  it("finds the instance by business key and counts instances", async () => {
    const orderId = required(state.orderId, "orderId")
    const list = expectSuccess(await cli(argv("process-instance list", [], { businessKey: "B-1" })))
    expect(list.json<ProcessInstance[]>()).toEqual([
      expect.objectContaining({ id: orderId, businessKey: "B-1" }),
    ])

    const all = expectSuccess(await cli(argv("process-instance count")))
    expect(all.json<Count>().count).toBeGreaterThanOrEqual(1)
    expect(await countInstances({ businessKey: "B-1" })).toBe(1)
  })

  it("claims and completes the user task", async () => {
    const orderId = required(state.orderId, "orderId")
    const tasks = expectSuccess(
      await cli(argv("task list", [], { processInstanceId: orderId })),
    ).json<Task[]>()
    expect(tasks).toEqual([expect.objectContaining({ name: USER_TASK_NAME, assignee: null })])
    const taskId = required(tasks[0], "user task").id

    const claim = expectSuccess(await cli(argv("task claim", [taskId], { userId: "demo" })))
    expect(claim.stdout).toBe("")
    // Tomcat sends no reason phrase; the CLI fills in the standard one
    // the path relative to the REST root, as `pulse-cli api` takes it
    expect(claim.stderr).toBe(`Done: POST /task/${taskId}/claim → 204 No Content\n`)
    const claimed = await cli(
      argv("task list", [], { processInstanceId: orderId, assignee: "demo" }),
    )
    expect(expectSuccess(claimed).json<Task[]>()).toHaveLength(1)

    const complete = await cli(argv("task complete", [taskId], { variables: ["approved=true"] }))
    expect(expectSuccess(complete).stdout).toBe("")
    const remaining = await cli(argv("task list", [], { processInstanceId: orderId }))
    expect(expectSuccess(remaining).json<Task[]>()).toEqual([])
    const approved = await cli(argv("process-instance get-variable", [orderId, "approved"]))
    expect(expectSuccess(approved).json<TypedValue>()).toMatchObject({
      type: "Boolean",
      value: true,
    })
  })

  it("fetches, locks and completes the external task", async () => {
    const orderId = required(state.orderId, "orderId")
    const tasks = await fetchAndLock("B-1")
    expect(tasks).toEqual([
      expect.objectContaining({
        processInstanceId: orderId,
        topicName: EXTERNAL_TOPIC,
        workerId: WORKER_ID,
      }),
    ])
    const taskId = required(tasks[0], "external task").id

    const complete = await cli(
      argv("external-task complete", [taskId], {
        workerId: WORKER_ID,
        variables: ["charged=true"],
      }),
    )
    expect(expectSuccess(complete).stdout).toBe("")
  })

  it("reports the finished instance as COMPLETED in history", async () => {
    const orderId = required(state.orderId, "orderId")
    const result = expectSuccess(await cli(argv("historic-process-instance get", [orderId])))
    expect(result.json()).toMatchObject({ id: orderId, businessKey: "B-1", state: "COMPLETED" })
  })

  it("evaluates the approval decision", async () => {
    const small = await cli(
      argv("decision-definition evaluate-by-key", [DECISION_KEY], { variables: ["amount=100"] }),
    )
    expect(expectSuccess(small).json()).toEqual([
      { approved: expect.objectContaining({ type: "Boolean", value: true }) },
    ])
    const large = await cli(
      argv("decision-definition evaluate-by-key", [DECISION_KEY], { variables: ["amount=5000"] }),
    )
    expect(expectSuccess(large).json()).toEqual([
      { approved: expect.objectContaining({ type: "Boolean", value: false }) },
    ])
  })

  it("creates an incident when an external task fails without retries", async () => {
    const instanceId = await startOrder("B-2")
    await completeUserTask(instanceId)
    const tasks = await fetchAndLock("B-2", true)
    expect(tasks).toEqual([expect.objectContaining({ processInstanceId: instanceId })])
    const taskId = required(tasks[0], "external task").id

    const failure = await cli(
      argv("external-task handle-failure", [taskId], {
        workerId: WORKER_ID,
        errorMessage: "card declined",
        retries: 0,
        retryTimeout: 0,
      }),
    )
    expect(expectSuccess(failure).stdout).toBe("")

    const incidents = await cli(argv("incident list", [], { processInstanceId: instanceId }))
    expect(expectSuccess(incidents).json<Incident[]>()).toEqual([
      expect.objectContaining({
        processInstanceId: instanceId,
        incidentType: "failedExternalTask",
        incidentMessage: "card declined",
      }),
    ])

    // the automatic table columns put the informative fields first, within 120 columns
    const table = await cli([
      ...argv("incident list", [], { processInstanceId: instanceId }),
      globalFlag("output"),
      "table",
    ])
    const [header = "", row = ""] = expectSuccess(table).stdout.split("\n")
    expect(header).toMatch(/^id +activityId +incidentType +incidentMessage/)
    expect(row).toContain("failedExternalTask")
    expect(row).toContain("card declined")
  })
}
