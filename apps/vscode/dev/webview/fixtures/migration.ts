import type { MappingRow, MigrationView } from "../../../src/core/protocol/index.js"
import orderXml from "./order-fulfillment.bpmn"
import { AS_OF, LOCAL_ENGINE } from "./engines.js"

function same(elementId: string, label: string, waiting?: number): MappingRow {
  return {
    sourceElementId: elementId,
    sourceLabel: label,
    candidates: [{ elementId, label }],
    targetElementId: elementId,
    ...(waiting === undefined ? {} : { waiting }),
  }
}

const MAPPED_ROWS: readonly MappingRow[] = [
  same("Activity_ReserveStock", "Reserve stock", 1),
  same("Activity_CheckCredit", "Check credit", 5),
  same("Activity_ApproveOrder", "Approve order", 3),
  same("Event_WaitForPickup", "Wait for pickup"),
  same("Event_PaymentReceived", "Payment received"),
  same("Activity_ShipOrder", "Ship order", 1),
]

export const MIGRATION_VIEW: MigrationView = {
  kind: "migration",
  engine: {
    ...LOCAL_ENGINE,
    access: {
      writable: true,
      note: "Pulse may retry incidents, change variables, move tokens, cancel and migrate instances on local.",
    },
  },
  asOf: AS_OF,
  processName: "Order fulfillment",
  bpmnProcessId: "order-fulfillment",
  source: { definitionId: "order-fulfillment:6:91e0", version: 6, diagramXml: orderXml },
  target: { definitionId: "order-fulfillment:7:4a1c", version: 7, diagramXml: orderXml },
  targets: [
    { definitionId: "order-fulfillment:7:4a1c", version: 7, running: 12, withIncident: 2 },
    { definitionId: "order-fulfillment:5:0b7d", version: 5, running: 0, withIncident: 0 },
  ],
  latestVersion: 7,
  rows: MAPPED_ROWS,
  focused: "Activity_CheckCredit",
  count: 10,
  summary: "All 6 elements map by id · no problems · checked just now",
  offer: { status: "ready", label: "Migrate 10 instances…" },
  notices: [],
}

const UNMAPPED_APPROVE: MappingRow = {
  sourceElementId: "Activity_ApproveOrder",
  sourceLabel: "Approve order",
  candidates: [{ elementId: "Activity_ApproveOrder", label: "Approve order" }],
  waiting: 3,
  unmappedTokens: true,
}

export const UNMAPPED_MIGRATION_VIEW: MigrationView = {
  ...MIGRATION_VIEW,
  rows: [
    UNMAPPED_APPROVE,
    ...MAPPED_ROWS.filter((row) => row.sourceElementId !== "Activity_ApproveOrder"),
  ],
  focused: "Activity_ApproveOrder",
  summary: "5 mapped · 1 without a mapping · checked just now",
  offer: {
    status: "refused",
    reason: "3 of 10 wait at Approve order, which has no mapping in v7.",
    leaveOut: "Leave the 3 out",
  },
}

export const RUNNING_MIGRATION_VIEW: MigrationView = {
  ...MIGRATION_VIEW,
  offer: { status: "refused", reason: "Wait until migrating 10 instances ends." },
  bulk: {
    status: "running",
    notice: {
      tone: "info",
      title: "Migrating instances: 4 of 10 done",
      actions: [{ kind: "stopBulk", label: "Stop" }],
    },
    progress: { total: 10, done: 4, failed: 0 },
    announcement: "Migrating instances: 4 of 10 done",
  },
}
