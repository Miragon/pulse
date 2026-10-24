import dispatchXml from "./dispatch.bpmn"
import labelXml from "./label.bpmn"
import orderXml from "./order.bpmn"

export const WORLD_PROCESS = {
  order: "pulse-order",
  dispatch: "pulse-dispatch",
  label: "pulse-label",
} as const

export const WORLD_ELEMENT = {
  orderReceived: "Event_OrderReceived",
  route: "Gateway_Route",
  shippedExpress: "Event_ShippedExpress",
  reviewOrder: "Activity_ReviewOrder",
  orderReviewed: "Event_OrderReviewed",
  chargePayment: "Activity_ChargePayment",
  printShippingLabel: "Activity_PrintShippingLabel",
  renderLabel: "Activity_RenderLabel",
} as const

export type WorldProcess = keyof typeof WORLD_PROCESS

export const WORLD_CALL = {
  caller: "dispatch",
  elementId: WORLD_ELEMENT.printShippingLabel,
  called: "label",
} as const satisfies {
  readonly caller: WorldProcess
  readonly elementId: string
  readonly called: WorldProcess
}

export type DeploymentAlias = "order@1" | "order@2" | "label@1" | "dispatch@1"

export interface WorldDeployment {
  readonly alias: DeploymentAlias
  readonly process: WorldProcess
  readonly version: number
}

export const WORLD_DEPLOYMENTS: readonly WorldDeployment[] = [
  { alias: "order@1", process: "order", version: 1 },
  { alias: "order@2", process: "order", version: 2 },
  { alias: "label@1", process: "label", version: 1 },
  { alias: "dispatch@1", process: "dispatch", version: 1 },
]

export type InstanceAlias = "ORD-1001" | "ORD-1002" | "ORD-1003" | "ORD-2001" | "DSP-3001"

export type CommandInstanceAlias =
  | "CMD-RETRY"
  | "CMD-TWICE"
  | "CMD-KEEP"
  | "CMD-EDIT"
  | "CMD-ENDED"
  | "CMD-SKIP"
  | "CMD-RERUN"
  | "CMD-TWIN"

export type BulkInstanceAlias = `CMD-BULK-${number}` | `CMD-STOP-${number}`

export type MigrationInstanceAlias = `CMD-MIG-${number}`

export type BulkSet = "cancel" | "stop"

export interface WorldInstance<Alias extends string = InstanceAlias> {
  readonly businessKey: Alias
  readonly deployment: DeploymentAlias
  readonly variables: Readonly<Record<string, string | number>>
}

export const WORLD_INSTANCES: readonly WorldInstance[] = [
  { businessKey: "ORD-1001", deployment: "order@1", variables: { route: "review" } },
  { businessKey: "ORD-1002", deployment: "order@1", variables: { route: "charge", amount: 42 } },
  { businessKey: "ORD-1003", deployment: "order@1", variables: { route: "express" } },
  { businessKey: "ORD-2001", deployment: "order@2", variables: { route: "review" } },
  { businessKey: "DSP-3001", deployment: "dispatch@1", variables: { orderId: "ORD-1001" } },
]

export const WORLD_LOCAL_VARIABLE = {
  instance: "ORD-1001",
  elementId: WORLD_ELEMENT.reviewOrder,
  name: "reviewNote",
  value: "Check the delivery address",
} as const satisfies { readonly instance: InstanceAlias } & Record<string, string>

const FAILING_ORDER = { route: "charge", amount: 42 } as const

export const WORLD_COMMAND_INSTANCES: readonly WorldInstance<CommandInstanceAlias>[] = [
  { businessKey: "CMD-RETRY", deployment: "order@2", variables: FAILING_ORDER },
  { businessKey: "CMD-TWICE", deployment: "order@2", variables: FAILING_ORDER },
  { businessKey: "CMD-KEEP", deployment: "order@2", variables: FAILING_ORDER },
  {
    businessKey: "CMD-EDIT",
    deployment: "order@2",
    variables: { route: "review", amount: 42, note: "first" },
  },
  { businessKey: "CMD-ENDED", deployment: "order@2", variables: { route: "express" } },
  { businessKey: "CMD-SKIP", deployment: "order@2", variables: FAILING_ORDER },
  { businessKey: "CMD-RERUN", deployment: "order@2", variables: { route: "review" } },
  { businessKey: "CMD-TWIN", deployment: "order@2", variables: { route: "review" } },
]

export const WORLD_SECOND_TOKEN = {
  instance: "CMD-TWIN",
  elementId: WORLD_ELEMENT.reviewOrder,
} as const satisfies { readonly instance: CommandInstanceAlias; readonly elementId: string }
export const WORLD_BULK_SIZE = 50

const WAITING_ORDER = { route: "review" } as const

export const WORLD_BULK_INSTANCES: Readonly<
  Record<BulkSet, readonly WorldInstance<BulkInstanceAlias>[]>
> = {
  cancel: Array.from({ length: WORLD_BULK_SIZE }, (_, index) => ({
    businessKey: `CMD-BULK-${index + 1}` as const,
    deployment: "order@2",
    variables: WAITING_ORDER,
  })),
  stop: Array.from({ length: WORLD_BULK_SIZE }, (_, index) => ({
    businessKey: `CMD-STOP-${index + 1}` as const,
    deployment: "order@2",
    variables: WAITING_ORDER,
  })),
}

export type MigrationSet = "whole" | "partial" | "skip" | "stay"

export const WORLD_MIGRATION_INSTANCES: Readonly<
  Record<MigrationSet, readonly WorldInstance<MigrationInstanceAlias>[]>
> = {
  whole: [
    { businessKey: "CMD-MIG-1", deployment: "order@1", variables: WAITING_ORDER },
    { businessKey: "CMD-MIG-2", deployment: "order@1", variables: WAITING_ORDER },
    { businessKey: "CMD-MIG-3", deployment: "order@1", variables: FAILING_ORDER },
  ],
  partial: [
    { businessKey: "CMD-MIG-11", deployment: "order@1", variables: WAITING_ORDER },
    { businessKey: "CMD-MIG-12", deployment: "order@1", variables: WAITING_ORDER },
    { businessKey: "CMD-MIG-13", deployment: "order@1", variables: FAILING_ORDER },
  ],
  skip: [{ businessKey: "CMD-MIG-21", deployment: "order@1", variables: WAITING_ORDER }],
  stay: [{ businessKey: "CMD-MIG-31", deployment: "order@1", variables: WAITING_ORDER }],
}

export const WORLD_MIGRATION = {
  source: "order@1",
  target: "order@2",
} as const satisfies { readonly source: DeploymentAlias; readonly target: DeploymentAlias }

export const NEUTRAL_DIAGRAMS: Readonly<Record<WorldProcess, string>> = {
  order: orderXml,
  dispatch: dispatchXml,
  label: labelXml,
}
