/**
 * The Camunda 8 cluster the server's Camunda 8 tests read: one order instance (a key beyond 2^53)
 * waiting at its service task with a job, a variable whose value is a long, empty searches
 * otherwise, an RFC 9457 problem for every other path. A copy of the C8 adapter's goldens world
 * (packages/connectors/c8/c8-adapter/test/goldens/cluster-world.ts) below this header: apps share
 * no code, so each surface keeps its copy, and scripts/error-path-goldens.test.mjs holds the two
 * equal, so a change to one changes the other in the same commit.
 */

import type { EngineAnswer, EngineReply, SentRequest } from "./fake-c8-cluster.js"

export const INSTANCE_KEY = "9007199254740993"

const DEFINITION_KEY = "2251799813685326"
const TASK_KEY = "9007199254741001"
const STARTED_AT = "2026-11-15T08:41:12.345Z"
const PROBLEM_TYPE = "application/problem+json"

export function topologyOf(version: string): EngineReply {
  return {
    body: {
      brokers: [
        {
          nodeId: 0,
          host: "camunda",
          port: 26501,
          partitions: [{ partitionId: 1, role: "leader", health: "healthy" }],
          version,
        },
      ],
      clusterId: "9bf35df6-cec5-4036-b899-c0de117d1b8a",
      clusterSize: 1,
      partitionsCount: 1,
      replicationFactor: 1,
      gatewayVersion: version,
      lastCompletedChangeId: "-1",
    },
  }
}

export function problemOf(status: number, title: string, detail: string, path: string) {
  return {
    status,
    contentType: PROBLEM_TYPE,
    body: { type: "about:blank", title, status, detail, instance: path },
  }
}

const TOPOLOGY = topologyOf("8.9.28")

const INSTANCE = {
  processDefinitionId: "pulse-order",
  processDefinitionName: "Order fulfillment",
  processDefinitionVersion: 2,
  processDefinitionVersionTag: null,
  startDate: STARTED_AT,
  endDate: null,
  state: "ACTIVE",
  hasIncident: false,
  tenantId: "<default>",
  processInstanceKey: INSTANCE_KEY,
  processDefinitionKey: DEFINITION_KEY,
  parentProcessInstanceKey: null,
  parentElementInstanceKey: null,
  rootProcessInstanceKey: INSTANCE_KEY,
  tags: [],
  businessId: "ORD-1001",
}

function elementOf(key: string, elementId: string, type: string, endDate: string | null) {
  return {
    processDefinitionId: "pulse-order",
    startDate: STARTED_AT,
    endDate,
    elementId,
    elementName: elementId === "Activity_ChargePayment" ? "Charge payment" : "Order received",
    type,
    state: endDate === null ? "ACTIVE" : "COMPLETED",
    hasIncident: false,
    tenantId: "<default>",
    elementInstanceKey: key,
    processInstanceKey: INSTANCE_KEY,
    rootProcessInstanceKey: INSTANCE_KEY,
    processDefinitionKey: DEFINITION_KEY,
    incidentKey: null,
  }
}

const CHARGE_PAYMENT = elementOf(TASK_KEY, "Activity_ChargePayment", "SERVICE_TASK", null)
const ORDER_RECEIVED = elementOf(
  "9007199254740999",
  "Event_OrderReceived",
  "START_EVENT",
  STARTED_AT,
)

const JOB = {
  jobKey: "9007199254741003",
  type: "charge-payment",
  worker: "",
  state: "CREATED",
  kind: "BPMN_ELEMENT",
  retries: 3,
  processDefinitionId: "pulse-order",
  processDefinitionKey: DEFINITION_KEY,
  processInstanceKey: INSTANCE_KEY,
  elementId: "Activity_ChargePayment",
  elementInstanceKey: TASK_KEY,
  tenantId: "<default>",
  creationTime: STARTED_AT,
}

const BIG_LONG = {
  name: "big",
  tenantId: "<default>",
  variableKey: "9007199254741005",
  scopeKey: INSTANCE_KEY,
  processInstanceKey: INSTANCE_KEY,
  rootProcessInstanceKey: INSTANCE_KEY,
  value: "9223372036854775807",
  isTruncated: false,
}

function pageOf(items: readonly unknown[]): EngineReply {
  const cursor = items.length === 0 ? null : "WzkwMDcxOTkyNTQ3NDEwMDFd"
  return {
    body: {
      page: {
        totalItems: items.length,
        hasMoreTotalItems: false,
        startCursor: cursor,
        endCursor: cursor,
      },
      items,
    },
  }
}

const SEARCHES: Readonly<Partial<Record<string, readonly unknown[]>>> = {
  "/v2/process-definitions/search": [],
  "/v2/process-definitions/statistics/process-instances": [],
  "/v2/process-instances/search": [],
  "/v2/user-tasks/search": [],
  "/v2/message-subscriptions/search": [],
  "/v2/incidents/search": [],
  "/v2/jobs/search": [JOB],
  "/v2/variables/search": [BIG_LONG],
}

interface ElementSearch {
  readonly filter?: { readonly state?: string }
}

function elementSearch(request: SentRequest): EngineReply {
  const search = JSON.parse(request.body ?? "{}") as ElementSearch
  const active = search.filter?.state === "ACTIVE"
  return pageOf(active ? [CHARGE_PAYMENT] : [CHARGE_PAYMENT, ORDER_RECEIVED])
}

function notFound(path: string): EngineReply {
  return problemOf(404, "Not Found", `No endpoint GET ${path}.`, path)
}

export const clusterWorld: EngineAnswer = (request) => {
  const path = request.target
  if (path === "/v2/topology") {
    return TOPOLOGY
  }
  if (path === `/v2/process-instances/${INSTANCE_KEY}`) {
    return { body: INSTANCE }
  }
  if (path === "/v2/element-instances/search") {
    return elementSearch(request)
  }
  const items = SEARCHES[path]
  return items === undefined ? notFound(path) : pageOf(items)
}
