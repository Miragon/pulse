import type { InstanceView } from "../../../src/core/protocol/index.js"
import { LOCAL_ENGINE, minutesBefore } from "./engines.js"
import { INSTANCE_WAITING, INSTANCE_WITH_CALLED_INCIDENT } from "./instance.js"

const INCIDENT_ID = "c0ffee00-1111-4222-8333-444455556666"

const WRITABLE_ENGINE = {
  ...LOCAL_ENGINE,
  access: {
    writable: true,
    note: "Pulse may retry incidents, change variables, move tokens and cancel instances on local.",
  },
}

export const WRITABLE_INSTANCE: InstanceView = {
  ...INSTANCE_WITH_CALLED_INCIDENT,
  engine: WRITABLE_ENGINE,
  markers: [{ elementId: "Activity_CheckCredit", kind: "incident" }],
  incidents: [
    {
      id: INCIDENT_ID,
      shortId: "c0ffee00…",
      elementId: "Activity_CheckCredit",
      typeLabel: "Failed external task",
      engineType: "failedExternalTask",
      message: "Card ending 4371 expired on 03/2025",
      rootCause: "CardExpiredException: Card ending 4371 expired on 03/2025",
      createdAt: minutesBefore(12),
      retriesLeft: 0,
      detailsLabel: "Stacktrace",
      retryable: true,
    },
  ],
  waitStates: [],
  variables: [
    { name: "amount", type: "Double", valueJson: "1240.5", truncated: false, editor: "decimal" },
    {
      name: "cardExpiry",
      type: "String",
      valueJson: '"03/2025"',
      truncated: false,
      editor: "text",
      shadowedAt: ["Activity_CheckCredit"],
    },
    {
      name: "cardExpiry",
      type: "String",
      valueJson: '"03/2025"',
      truncated: false,
      scopeElementId: "Activity_CheckCredit",
    },
    {
      name: "erpOrderNumber",
      type: "Long",
      valueJson: "9007199254740993",
      truncated: false,
      editor: "integer",
    },
    {
      name: "customer",
      type: "Json",
      valueJson: '{"id":"C-77","ledger":9007199254740993,"tags":[]}',
      truncated: false,
      editor: "json",
    },
    { name: "express", type: "Boolean", valueJson: "false", truncated: false, editor: "boolean" },
    { name: "iban", type: "Null", valueJson: "null", truncated: false, editor: "any" },
    { name: "invoice", type: "Object", valueJson: '"rO0ABXNy"', truncated: false },
  ],
}

export const WRITABLE_INCIDENT_ID = INCIDENT_ID

const APPROVE = "Activity_ApproveOrder"
const CANCEL_APPROVAL = "Cancels Approve order."

function target(elementId: string, label: string, warnings: readonly string[] = []) {
  return {
    elementId,
    label,
    effects: [
      CANCEL_APPROVAL,
      elementId === APPROVE
        ? "Approve order starts again, with its listeners and input mappings."
        : `Starts ${label}, with its listeners and input mappings, and runs on to the next wait.`,
    ],
    warnings,
  }
}

export const MOVABLE_INSTANCE: InstanceView = {
  ...INSTANCE_WAITING,
  engine: WRITABLE_ENGINE,
  waitStates: [
    ...INSTANCE_WAITING.waitStates,
    {
      elementId: "Activity_CheckCredit",
      elementName: "Check credit",
      kindLabel: "External task",
      since: minutesBefore(20),
      calledInstance: {
        instanceId: "called-1",
        shortId: "called-1",
        bpmnProcessId: "credit-scoring",
      },
      moveRefusal: "Open the called instance to move this token.",
    },
  ],
  moves: [
    {
      fromElementId: APPROVE,
      fromLabel: "Approve order",
      targets: [
        target("Activity_ReserveStock", "Reserve stock"),
        target("Gateway_CreditOk", "Credit ok?"),
        target(APPROVE, "Approve order"),
        target("Activity_ShipOrder", "Ship order", [
          "Ship order already holds a token; then it holds two.",
        ]),
      ],
      refused: [
        {
          elementId: "Event_OrderReceived",
          label: "Order received",
          reason: "A start event begins a new path; pick the element after it.",
        },
        {
          elementId: "Event_OrderShipped",
          label: "Order shipped",
          reason: "Moving the token to an end event can end the instance.",
        },
      ],
    },
  ],
}
