import { C8Adapter } from "../../../../src/adapters/c8/index.js"
import type { ProcessRuntime } from "../../../../src/contract/index.js"
import { fakeCamundaRest, REST_URL, type RestRoute } from "./fake-camunda-rest.js"

export const NONE = { kind: "none" } as const

export function runtimeWith(routes: readonly RestRoute[]) {
  const camunda = fakeCamundaRest(routes)
  const runtime: ProcessRuntime = new C8Adapter(camunda.send).runtime({
    endpoint: REST_URL,
    credentials: NONE,
  })
  return { camunda, runtime }
}

export function definition(key: string, id: string, version: number, extra: object = {}) {
  return {
    processDefinitionKey: key,
    processDefinitionId: id,
    version,
    name: `${id} name`,
    state: "ACTIVE",
    ...extra,
  }
}

export function instance(key: string, extra: object = {}) {
  return {
    processInstanceKey: key,
    processDefinitionKey: "100",
    processDefinitionId: "order",
    processDefinitionVersion: 1,
    processDefinitionName: "Order",
    state: "ACTIVE",
    hasIncident: false,
    startDate: "2026-11-05T10:00:00.000Z",
    ...extra,
  }
}

export const ENDED_AT = "2026-11-05T10:00:01.000Z"

export function element(key: string, elementId: string, type: string, extra: object = {}) {
  return {
    elementInstanceKey: key,
    elementId,
    elementName: `${elementId} name`,
    type,
    state: "ACTIVE",
    startDate: "2026-11-05T10:00:00.000Z",
    ...extra,
  }
}

export function job(key: string, elementInstanceKey: string, extra: object = {}) {
  return {
    jobKey: key,
    type: `job-${key}`,
    state: "CREATED",
    kind: "BPMN_ELEMENT",
    elementInstanceKey,
    retries: 3,
    ...extra,
  }
}
