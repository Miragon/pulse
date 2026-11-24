import type {
  MigrationPlanView,
  PlanMappingRow,
  Problem,
} from "../../../src/core/protocol/index.js"
import orderXml from "./order-fulfillment.bpmn"
import { AS_OF, LOCAL_ENGINE } from "./engines.js"

function same(elementId: string, label: string, tokens?: number): PlanMappingRow {
  return {
    sourceElementId: elementId,
    sourceLabel: label,
    targetElementId: elementId,
    targetLabel: label,
    ...(tokens === undefined ? {} : { tokens }),
  }
}

const STARTS_NOTHING = {
  tone: "info",
  title: "This preview starts nothing.",
  detail: "Migrating in the definition panel doesn't use this file.",
  actions: [],
} as const

const READS = "Pulse reads v6 and v7 of order-fulfillment on local by their numbers."
const MOVES =
  "A migration moves only the instances you select in the definition panel, at most 1,000 at a time."
const PLAN_FILE = "order-fulfillment-v6-to-v7.migration.json"

const FACTS = [
  READS,
  MOVES,
  "12 instances run on v6, 2 with incident.",
  "Each migrates on its own; failed ones stay on v6.",
  "2 have an incident and keep it; retry them on v7.",
  "Called instances stay on their version.",
  "New or unmapped timers and subscriptions start now.",
  "Migrating can't be undone.",
]

export const MIGRATION_PLAN_VIEW: MigrationPlanView = {
  kind: "migrationPlan",
  engine: LOCAL_ENGINE,
  asOf: AS_OF,
  fileName: PLAN_FILE,
  processName: "Order fulfillment",
  bpmnProcessId: "order-fulfillment",
  source: { definitionId: "order-fulfillment:6:91e0", version: 6, diagramXml: orderXml },
  target: { definitionId: "order-fulfillment:7:4a1c", version: 7, diagramXml: orderXml },
  running: 12,
  withIncident: 2,
  rows: [
    same("Activity_ReserveStock", "Reserve stock", 1),
    same("Activity_CheckCredit", "Check credit", 5),
    same("Activity_ApproveOrder", "Approve order", 3),
    same("Event_WaitForPickup", "Wait for pickup"),
    same("Event_PaymentReceived", "Payment received"),
    same("Activity_ShipOrder", "Ship order", 1),
  ],
  focused: "Activity_CheckCredit",
  summary: "6 mapped · no problems",
  verdict: {
    fits: true,
    text: "The engine finds no problem in the plan, and every element where instances wait has a mapping in v7.",
  },
  facts: FACTS,
  notices: [STARTS_NOTHING],
}

export const BLOCKED_MIGRATION_PLAN_VIEW: MigrationPlanView = {
  ...MIGRATION_PLAN_VIEW,
  running: 1204,
  withIncident: 7,
  rows: [
    {
      sourceElementId: "Activity_ShipOrder",
      sourceLabel: "Ship order",
      targetElementId: "Activity_ShipParcel",
      targetLabel: "Activity_ShipParcel",
      refused: "v7 has no element Activity_ShipParcel.",
    },
    {
      ...same("Activity_CheckCredit", "Check credit", 5),
      problem:
        "The boundary event of Check credit has no mapping, so its subscription can't follow.",
    },
    {
      sourceElementId: "Activity_ApproveOrder",
      sourceLabel: "Approve order",
      tokens: 3,
      unmappedTokens: true,
    },
    same("Activity_ReserveStock", "Reserve stock", 1),
    same("Event_WaitForPickup", "Wait for pickup"),
    same("Event_PaymentReceived", "Payment received"),
  ],
  focused: "Activity_ShipOrder",
  summary: "4 mapped · 1 left out · 1 problem",
  verdict: {
    fits: false,
    text: "Pulse left out 1 mapping of the plan that doesn't fit v6 and v7 on local; the engine checked the rest.",
  },
  facts: [
    READS,
    "A migration moves only the instances you select in the definition panel.",
    "1,204 instances run on v6, 7 with incident.",
    "Each migrates on its own; failed ones stay on v6.",
    "7 have an incident and keep it; retry them on v7.",
    "Called instances stay on their version.",
    "New or unmapped timers and subscriptions start now.",
    "Migrating can't be undone.",
  ],
  notices: [
    STARTS_NOTHING,
    {
      tone: "warning",
      title: "More than 1,000 instances run on v6.",
      detail: "The definition panel migrates at most 1,000 at a time.",
      actions: [],
    },
    { tone: "info", title: "v7 is not the latest version (v8).", actions: [] },
    { tone: "info", title: "Pulse ignores 1 key of the file: title.", actions: [] },
  ],
}

export const BROKEN_PLAN_PROBLEM: Problem = {
  title: `Pulse can't preview ${PLAN_FILE}.`,
  detail: "The file is not valid JSON.",
  canEditConnection: false,
  file: PLAN_FILE,
}
