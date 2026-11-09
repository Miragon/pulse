import { describe, expect, it } from "vitest"
import { type Condition, measure } from "./conditions.js"
import { readStatus } from "./engine-status.js"
import { inspectInstance } from "./inspect.js"
import {
  CONDITION_OPERATIONS,
  CORE_OPERATIONS,
  INSPECT_OPERATIONS,
  STATUS_OPERATIONS,
} from "./operations.js"
import type { Route } from "./testing/fake-port.js"
import { fakePort } from "./testing/fake-port.js"
import { P } from "./testing/fixture.js"
import { APPROVE_INCIDENT, approveRoutes } from "./testing/inspect-routes.js"
import { NOW } from "./testing/status.js"

/** Routes for exactly the declared operations: any other one is refused by the fake port. */
function only(operations: readonly string[], routes: Readonly<Record<string, Route>>) {
  return Object.fromEntries(operations.map((id) => [id, routes[id] ?? (() => [])]))
}

describe("the declared operations", () => {
  it("are all inspect sends, the selection included", async () => {
    const port = fakePort(
      only(INSPECT_OPERATIONS, {
        ...approveRoutes(),
        getHistoricProcessInstances: () => [{ id: P, state: "ACTIVE" }],
      }),
    )
    await inspectInstance(
      port,
      { businessKey: "WF-1", latest: true },
      { variables: true, history: true, stacktrace: true },
    )
    const sent = new Set(port.calls.map((call) => call.operationId))
    expect(
      [...sent].filter((id) => !(INSPECT_OPERATIONS as readonly string[]).includes(id)),
    ).toEqual([])
  })

  it("are all status sends", async () => {
    const routes: Record<string, Route> = {
      getRestAPIVersion: () => ({ version: "7.24.0" }),
      getIncidents: () => [{ ...APPROVE_INCIDENT, processDefinitionId: "order:1:x" }],
      getStacktrace: () => "boom",
      getExternalTasks: () => [{ id: "e1", topicName: "mail", errorMessage: "x", retries: 0 }],
    }
    const port = fakePort(only(STATUS_OPERATIONS, routes))
    await readStatus({ port, now: () => NOW }, { keys: [], staleAfterMs: 300_000, maxGroups: 10 })
    const sent = new Set(port.calls.map((call) => call.operationId))
    expect([...sent].sort()).toEqual(
      STATUS_OPERATIONS.filter((id) => id !== "getExternalTaskErrorDetails").toSorted(),
    )
  })

  it("are all wait counts", async () => {
    const counts: Record<string, Route> = {}
    for (const id of CONDITION_OPERATIONS) counts[id] = () => ({ count: 0 })
    const port = fakePort(counts)
    const conditions: Condition[] = [
      { kind: "idle" },
      { kind: "task", key: "approve" },
      { kind: "activity", id: "book" },
    ]
    await measure(port, { id: "p1", ended: false, tree: ["p1"] }, conditions, true)
    const sent = new Set(port.calls.map((call) => call.operationId))
    expect([...sent].sort()).toEqual([...CONDITION_OPERATIONS].sort())
  })
})

describe("CORE_OPERATIONS", () => {
  it("is every operation of the composites and the wait, once each, in order", () => {
    const all = new Set<string>([
      ...INSPECT_OPERATIONS,
      ...STATUS_OPERATIONS,
      ...CONDITION_OPERATIONS,
    ])
    expect(CORE_OPERATIONS).toHaveLength(all.size)
    expect(new Set(CORE_OPERATIONS)).toEqual(all)
    expect(CORE_OPERATIONS).toEqual([...all].sort())
  })
})
