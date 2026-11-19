import { InstanceId } from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { matchingIn, page } from "../../support/fake-transport.js"
import { aloneWaiting, detailWith, searchesOf } from "../../support/instance-tree.js"
import { element, job } from "../../support/rows.js"

describe("the wait states of an instance at a job", () => {
  test("take a listener job when the element has no job of its own, on a container too", async () => {
    const { reader } = detailWith(
      aloneWaiting({
        active: [
          element("10", "Charge", "SERVICE_TASK"),
          element("11", "Ship", "SUB_PROCESS", { incidentKey: "8" }),
          element("12", "Pack", "SUB_PROCESS"),
          element("13", "Legacy", "SERVICE_TASK"),
        ],
        jobs: page([
          job("50", "10", { type: "audit-start", kind: "EXECUTION_LISTENER" }),
          job("51", "11", {
            type: "notify-end",
            kind: "EXECUTION_LISTENER",
            state: "FAILED",
            retries: 0,
          }),
          job("52", "12", { kind: "EXECUTION_LISTENER", state: "COMPLETED" }),
          job("53", "13", { type: "legacy-listener", kind: "EXECUTION_LISTENER" }),
          { jobKey: "54", type: "legacy", state: "CREATED", elementInstanceKey: "13", retries: 1 },
        ]),
      }),
    )

    const detail = await reader.read(InstanceId("1"))

    expect(detail?.waitStates).toEqual([
      expect.objectContaining({
        elementId: "Charge",
        kind: "workerTask",
        taskType: "audit-start",
        retriesLeft: 3,
      }),
      expect.objectContaining({
        elementId: "Ship",
        kind: "workerTask",
        taskType: "notify-end",
        retriesLeft: 0,
        incidentId: "8",
      }),
      expect.objectContaining({
        elementId: "Legacy",
        kind: "workerTask",
        taskType: "legacy",
        retriesLeft: 1,
      }),
    ])
  })

  test("take the job of an ad-hoc sub-process before a listener job", async () => {
    const { reader } = detailWith(
      aloneWaiting({
        active: [
          element("10", "Agent", "AD_HOC_SUB_PROCESS", { incidentKey: "9" }),
          element("11", "Agent", "AD_HOC_SUB_PROCESS_INNER_INSTANCE"),
        ],
        jobs: page([
          job("50", "10", { type: "agent-listener", kind: "EXECUTION_LISTENER" }),
          job("51", "10", {
            type: "ai-agent",
            kind: "AD_HOC_SUB_PROCESS",
            state: "FAILED",
            retries: 0,
          }),
        ]),
      }),
    )

    const detail = await reader.read(InstanceId("1"))

    expect(detail?.waitStates).toEqual([
      expect.objectContaining({
        elementId: "Agent",
        kind: "workerTask",
        taskType: "ai-agent",
        retriesLeft: 0,
        incidentId: "9",
      }),
    ])
  })

  test("ask for the jobs of many active elements a thousand keys at a time", async () => {
    const active = Array.from({ length: 1001 }, (_, index) =>
      element(String(10_000 + index), `Task_${String(index)}`, "SERVICE_TASK"),
    )
    const { camunda, reader } = detailWith(
      aloneWaiting({
        active,
        jobs: matchingIn(
          active.map((each) => job(`${each.elementInstanceKey}0`, each.elementInstanceKey)),
        ),
      }),
    )

    const detail = await reader.read(InstanceId("1"))

    expect(detail?.waitStates).toHaveLength(1001)
    expect(detail?.waitStates.every((wait) => wait.kind === "workerTask")).toBe(true)
    expect(detail?.truncated).toBe(false)
    expect(
      searchesOf(camunda, "POST /jobs/search")
        .map(
          (search) => (search.filter.elementInstanceKey as { readonly $in: string[] }).$in.length,
        )
        .toSorted((left, right) => left - right),
    ).toEqual([2, 1000])
  })

  test("wait at the process for a start listener job on the process itself", async () => {
    const { camunda, reader } = detailWith(
      aloneWaiting({
        active: [],
        jobs: matchingIn([
          job("50", "1", {
            type: "audit-before",
            kind: "EXECUTION_LISTENER",
            listenerEventType: "START",
            state: "COMPLETED",
          }),
          job("51", "1", {
            type: "audit",
            kind: "EXECUTION_LISTENER",
            listenerEventType: "START",
            creationTime: "2026-11-05T10:00:00.500Z",
          }),
        ]),
      }),
    )

    const detail = await reader.read(InstanceId("1"))

    expect(detail?.waitStates).toEqual([
      {
        instanceId: "1",
        elementId: "order",
        elementName: "Order",
        kind: "workerTask",
        taskType: "audit",
        retriesLeft: 3,
        since: "2026-11-05T10:00:00.500Z",
      },
    ])
    expect(detail?.path).toEqual([])
    expect(searchesOf(camunda, "POST /jobs/search").map((search) => search.filter)).toEqual([
      { processInstanceKey: "1", elementInstanceKey: { $in: ["1"] } },
    ])
  })

  test("wait at the process for its failed end listener, with the incident", async () => {
    const { camunda, reader } = detailWith(
      aloneWaiting({
        active: [],
        jobs: matchingIn([
          job("60", "1", {
            type: "notify-end",
            kind: "EXECUTION_LISTENER",
            listenerEventType: "END",
            state: "FAILED",
            retries: 0,
          }),
        ]),
        incidents: page([
          {
            incidentKey: "9",
            processInstanceKey: "1",
            processDefinitionKey: "100",
            elementId: "order",
            elementInstanceKey: "1",
            errorType: "EXECUTION_LISTENER_NO_RETRIES",
            errorMessage: "the notifier is down",
            creationTime: "2026-11-05T10:05:00.000Z",
            jobKey: "60",
          },
        ]),
      }),
    )

    const detail = await reader.read(InstanceId("1"))

    expect(detail?.waitStates).toEqual([
      {
        instanceId: "1",
        elementId: "order",
        elementName: "Order",
        kind: "workerTask",
        taskType: "notify-end",
        retriesLeft: 0,
        incidentId: "9",
      },
    ])
    expect(detail?.incidents).toEqual([
      expect.objectContaining({ id: "9", retriesLeft: 0, job: { id: "60", type: "notify-end" } }),
    ])
    expect(searchesOf(camunda, "POST /jobs/search")).toHaveLength(1)
  })

  test("wait at a container that holds an incident of its own and no job", async () => {
    const { reader } = detailWith(
      aloneWaiting({
        active: [
          element("10", "Notify", "MULTI_INSTANCE_BODY", { incidentKey: "7" }),
          element("11", "Label", "CALL_ACTIVITY", { incidentKey: "8" }),
          element("12", "Prepare", "SUB_PROCESS", { incidentKey: "9" }),
          element("13", "Ship", "SUB_PROCESS", { hasIncident: true }),
          element("14", "Pack", "SERVICE_TASK", { incidentKey: "10" }),
        ],
        jobs: matchingIn([job("70", "14", { type: "pack", state: "FAILED", retries: 0 })]),
        subscriptions: page([
          {
            elementInstanceKey: "12",
            elementId: "PrepareCanceled",
            messageName: "Order canceled",
          },
        ]),
        incidents: page([
          {
            incidentKey: "9",
            processInstanceKey: "1",
            processDefinitionKey: "100",
            elementId: "Prepare",
            elementInstanceKey: "12",
            errorType: "IO_MAPPING_ERROR",
            errorMessage: "no variable found with name 'address'",
            creationTime: "2026-11-05T10:00:00.000Z",
          },
        ]),
      }),
    )

    const detail = await reader.read(InstanceId("1"))

    expect(detail?.waitStates.map((wait) => [wait.elementId, wait.kind, wait.incidentId])).toEqual([
      ["Notify", "other", "7"],
      ["Label", "other", "8"],
      ["Prepare", "other", "9"],
      ["Pack", "workerTask", "10"],
    ])
    expect(detail?.waitStates[2]).toMatchObject({ description: "SUB_PROCESS" })
    expect(detail?.incidents).toEqual([
      expect.objectContaining({ id: "9", elementId: "Prepare", type: "IO_MAPPING_ERROR" }),
    ])
  })
})
