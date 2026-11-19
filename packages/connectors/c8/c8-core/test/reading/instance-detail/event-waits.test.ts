import { InstanceId } from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { matchingIn, page, problem } from "../../support/fake-transport.js"
import {
  aloneWaiting,
  detailWith,
  OPEN_USER_TASKS,
  searchesOf,
} from "../../support/instance-tree.js"
import { element, job } from "../../support/rows.js"

describe("the wait states of an instance at a task or an event", () => {
  test("read a user task in a transitional state as a user task", async () => {
    const { camunda, reader } = detailWith(
      aloneWaiting({
        active: [element("10", "Review", "USER_TASK")],
        jobs: page([job("50", "10", { type: "assign-check", kind: "TASK_LISTENER" })]),
        tasks: (body: string) =>
          page(
            body.includes('"ASSIGNING"') ? [{ elementInstanceKey: "10", assignee: "demo" }] : [],
          ),
      }),
    )

    const detail = await reader.read(InstanceId("1"))

    expect(detail?.waitStates).toEqual([
      expect.objectContaining({ elementId: "Review", kind: "userTask", assignee: "demo" }),
    ])
    expect(searchesOf(camunda, "POST /user-tasks/search").map((search) => search.filter)).toEqual([
      { processInstanceKey: "1", state: { $in: OPEN_USER_TASKS } },
    ])
  })

  test("read a migrated message subscription as the message it waits for", async () => {
    const { reader } = detailWith(
      aloneWaiting({
        active: [element("10", "AwaitPayment", "INTERMEDIATE_CATCH_EVENT")],
        subscriptions: (body: string) =>
          page(
            body.includes('"MIGRATED"')
              ? [
                  {
                    elementInstanceKey: "10",
                    elementId: "AwaitPayment",
                    messageName: "Payment received",
                    correlationKey: "ORD-1",
                  },
                ]
              : [],
          ),
      }),
    )

    const detail = await reader.read(InstanceId("1"))

    expect(detail?.waitStates).toEqual([
      expect.objectContaining({
        elementId: "AwaitPayment",
        kind: "message",
        messageName: "Payment received",
        correlationKey: "ORD-1",
      }),
    ])
  })

  test("read a catching event as other when its diagram is gone", async () => {
    const { reader } = detailWith([
      ...aloneWaiting({ active: [element("10", "Wait", "INTERMEDIATE_CATCH_EVENT")] }),
      {
        route: "GET /process-definitions/100/xml",
        answer: problem(404, "NOT_FOUND", "The process definition is gone."),
      },
    ])

    const detail = await reader.read(InstanceId("1"))

    expect(detail?.waitStates).toEqual([
      expect.objectContaining({
        elementId: "Wait",
        kind: "other",
        description: "INTERMEDIATE_CATCH_EVENT",
      }),
    ])
  })

  test("take only an element's own message subscription, never one of its boundary events", async () => {
    const { camunda, reader } = detailWith([
      ...aloneWaiting({
        active: [
          element("10", "AwaitPayment", "RECEIVE_TASK"),
          element("11", "Charge", "SERVICE_TASK", { incidentKey: "7" }),
        ],
        jobs: matchingIn([job("50", "11", { type: "charge", state: "ERROR_THROWN", retries: 0 })]),
        subscriptions: page([
          {
            elementInstanceKey: "10",
            elementId: "PaymentCanceled",
            messageName: "Order canceled",
            correlationKey: "ORD-1",
          },
          {
            elementInstanceKey: "10",
            elementId: "AwaitPayment",
            messageName: "Payment received",
            correlationKey: "ORD-1",
          },
          {
            elementInstanceKey: "11",
            elementId: "ChargeCanceled",
            messageName: "Order canceled",
            correlationKey: "ORD-1",
          },
        ]),
      }),
      {
        route: "GET /process-definitions/100/xml",
        answer: `<bpmn:receiveTask id="AwaitPayment" messageRef="Paid" />
           <bpmn:serviceTask id="Charge" />`,
      },
    ])

    const detail = await reader.read(InstanceId("1"))

    expect(detail?.waitStates).toEqual([
      expect.objectContaining({
        elementId: "AwaitPayment",
        kind: "message",
        messageName: "Payment received",
        correlationKey: "ORD-1",
      }),
      expect.objectContaining({
        elementId: "Charge",
        kind: "other",
        description: "SERVICE_TASK",
        incidentId: "7",
      }),
    ])
    expect(searchesOf(camunda, "POST /message-subscriptions/search")[0]?.sort).toEqual([
      { field: "messageSubscriptionKey", order: "ASC" },
    ])
  })

  test("read an event-based gateway as the message of the first event after it", async () => {
    const { reader } = detailWith(
      aloneWaiting({
        active: [element("10", "Choose", "EVENT_BASED_GATEWAY")],
        subscriptions: page([
          { elementInstanceKey: "10", elementId: "Paid", messageName: "Payment received" },
          { elementInstanceKey: "10", elementId: "Canceled", messageName: "Order canceled" },
        ]),
      }),
    )

    const detail = await reader.read(InstanceId("1"))

    expect(detail?.waitStates).toEqual([
      expect.objectContaining({
        elementId: "Choose",
        kind: "message",
        messageName: "Payment received",
      }),
    ])
  })
})
