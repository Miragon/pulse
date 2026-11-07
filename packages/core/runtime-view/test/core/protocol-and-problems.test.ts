import { RuntimeError, type RuntimeFailure } from "../../src/contract/index.js"
import { describe, expect, test } from "vitest"
import { Problems } from "../../src/core/panels/problems.js"
import { StatePublisher } from "../../src/core/panels/state-publisher.js"
import { MessageGuards } from "../../src/core/protocol/index.js"

const ENGINE = { name: "dev", environment: "test", host: "dev.example.com" } as const

describe("the protocol guards", () => {
  test("accept the live update intents and a hold only with a flag", () => {
    for (const type of ["pauseLiveUpdates", "resumeLiveUpdates", "turnOnLiveUpdates", "activity"]) {
      expect(MessageGuards.isWebviewIntent({ type })).toBe(true)
    }
    expect(MessageGuards.isWebviewIntent({ type: "holdLiveUpdates", held: true })).toBe(true)
    expect(MessageGuards.isWebviewIntent({ type: "holdLiveUpdates", held: "yes" })).toBe(false)
  })

  test("accept every intent type and nothing else", () => {
    expect(MessageGuards.isWebviewIntent({ type: "ready" })).toBe(true)
    expect(
      MessageGuards.isWebviewIntent({ type: "filterInstances", filter: { scope: "ended" } }),
    ).toBe(true)
    expect(
      MessageGuards.isWebviewIntent({ type: "filterInstances", filter: { scope: "everything" } }),
    ).toBe(false)
    expect(
      MessageGuards.isWebviewIntent({ type: "openInstance", instanceId: 42, toSide: false }),
    ).toBe(false)
    expect(MessageGuards.isWebviewIntent({ type: "copy", text: "x" })).toBe(false)
    expect(MessageGuards.isWebviewIntent({ type: "toString" })).toBe(false)
    expect(
      MessageGuards.isWebviewIntent({ type: "openInstance", instanceId: "x", toSide: false }),
    ).toBe(true)
    expect(MessageGuards.isWebviewIntent({ type: "state", revision: 1 })).toBe(false)
    expect(MessageGuards.isWebviewIntent({ type: "deleteEverything" })).toBe(false)
    expect(MessageGuards.isWebviewIntent({ type: 42 })).toBe(false)
    expect(MessageGuards.isWebviewIntent(null)).toBe(false)
    expect(MessageGuards.isWebviewIntent("ready")).toBe(false)
  })

  test("recognise state messages", () => {
    expect(MessageGuards.isStateMessage({ type: "state", revision: 1, state: {} })).toBe(true)
    expect(MessageGuards.isStateMessage({ type: "ready" })).toBe(false)
    expect(MessageGuards.isStateMessage(undefined)).toBe(false)
  })
})

describe("the problem shown for a failure", () => {
  test.each<[RuntimeFailure, string, boolean]>([
    ["unreachable", "Can't reach dev.", true],
    ["unauthorized", "dev rejected the credentials.", true],
    ["forbidden", "dev does not allow this request.", true],
    ["misconfigured", "The connection to dev is not set up correctly.", true],
    ["engineFailure", "dev failed to answer.", false],
    ["unexpectedResponse", "dev answered in an unexpected way.", false],
  ])('%s says "%s"', (failure, title, canEditConnection) => {
    expect(Problems.of(new RuntimeError(failure, "boom"), ENGINE)).toEqual({
      title,
      detail: "boom",
      canEditConnection,
      ...(failure === "unauthorized" ? { needsCredentials: true } : {}),
    })
  })

  test("adds the hint of the adapter", () => {
    const error = new RuntimeError("unauthorized", "HTTP 401.", { hint: "Set the credentials." })
    expect(Problems.of(error, ENGINE).detail).toBe("HTTP 401. Set the credentials.")
  })

  test("stays readable for errors that are not runtime errors", () => {
    expect(Problems.of(new Error("kaputt"), ENGINE)).toEqual({
      title: "Loading from dev failed.",
      detail: "kaputt",
      canEditConnection: false,
    })
    expect(Problems.of("weird", ENGINE).detail).toBe("weird")
  })
})

describe("every intent shape", () => {
  test.each([
    { type: "ready" },
    { type: "refresh" },
    { type: "loadMoreInstances" },
    { type: "copyHandover" },
    { type: "editConnection" },
    { type: "setCredentials" },
    { type: "selectVersion", definitionId: "order:1" },
    { type: "filterProcesses", filter: { scope: "withIncident", search: "ord" } },
    { type: "filterProcesses", filter: { scope: "all" } },
    { type: "openProcess", bpmnProcessId: "order", toSide: false },
    { type: "filterInstances", filter: { scope: "all", elementId: "Task", businessKey: "K" } },
    {
      type: "filterInstances",
      filter: {
        scope: "all",
        variables: [
          { name: "route", operator: "equals", value: "review" },
          { name: "amount", operator: "greaterThan", value: "5" },
          { name: "code", operator: "like", value: "ORD-*", as: "text" },
          { name: "paid", operator: "notEquals", value: "true", as: "boolean" },
          { name: "zip", operator: "equals", value: "", as: "text" },
        ],
      },
    },
    {
      type: "filterInstances",
      filter: {
        scope: "all",
        variables: [
          { name: "dueAt", operator: "lessThan", value: "2026-03-15T10:00", as: "date" },
          { name: "giftNote", operator: "notEquals", value: "", as: "null" },
        ],
      },
    },
    { type: "suggestVariableNames" },
    { type: "openInstance", instanceId: "i", toSide: true },
    { type: "openDefinition", bpmnProcessId: "order", definitionId: "order:1" },
    { type: "openIncidentDetails", incidentId: "x" },
    { type: "selectElement", elementId: "Task" },
    { type: "openModel" },
    { type: "openModel", incidentId: "x" },
    { type: "openCode" },
    { type: "openCode", incidentId: "x" },
    { type: "openCode", elementId: "Task" },
    { type: "openModel", elementId: "Task" },
    { type: "copy", text: "x", label: "Instance ID" },
  ])("accepts %o", (intent) => {
    expect(MessageGuards.isWebviewIntent(intent)).toBe(true)
  })

  test.each([
    { type: "selectVersion" },
    { type: "filterInstances", filter: null },
    { type: "filterInstances", filter: { scope: "running", elementId: 7 } },
    { type: "filterInstances", filter: { scope: "running", businessKey: false } },
    { type: "filterInstances", filter: { scope: "running", variables: "route=review" } },
    { type: "filterInstances", filter: { scope: "running", variables: [null] } },
    {
      type: "filterInstances",
      filter: {
        scope: "running",
        variables: Array.from({ length: 6 }, () => ({
          name: "route",
          operator: "equals",
          value: "review",
        })),
      },
    },
    ...[
      { name: "", operator: "equals", value: "review" },
      { name: " ", operator: "equals", value: "review" },
      { name: "route", operator: "between", value: "review" },
      { name: "route", operator: "equals", value: 7 },
      { name: "route", operator: "equals", value: "review", as: "date" },
      { name: "amount", operator: "greaterThan", value: "abc" },
      { name: "amount", operator: "lessThan", value: "5", as: "text" },
      { name: "route", operator: "like", value: "rev*", as: "number" },
      { name: "paid", operator: "equals", value: "yes", as: "boolean" },
      { name: "amount", operator: "equals", value: "4x", as: "number" },
      { name: "dueAt", operator: "equals", value: "tomorrow", as: "date" },
      { name: "giftNote", operator: "equals", value: "x", as: "null" },
    ].map((condition) => ({
      type: "filterInstances",
      filter: { scope: "running", variables: [condition] },
    })),
    { type: "openInstance", instanceId: "i" },
    { type: "openDefinition", bpmnProcessId: "order" },
    { type: "openIncidentDetails" },
    { type: "selectElement" },
    { type: "openModel", incidentId: 7 },
    { type: "openCode", incidentId: 7 },
    { type: "openModel", elementId: 7 },
    { type: "filterProcesses", filter: "all" },
    { type: "filterProcesses", filter: null },
    { type: "filterProcesses", filter: { scope: "running" } },
    { type: "filterProcesses", filter: { scope: "all", search: 3 } },
    { type: "openProcess", bpmnProcessId: "order" },
    { type: "openProcess", bpmnProcessId: 7, toSide: true },
  ])("rejects %o", (intent) => {
    expect(MessageGuards.isWebviewIntent(intent)).toBe(false)
  })
})

describe("the state publisher", () => {
  test("numbers every state with a growing revision", () => {
    const posted: unknown[] = []
    const publisher = new StatePublisher((message) => posted.push(message))
    const engine = { name: "e", environment: "local", host: "h" } as const

    publisher.publish({ status: "loading", title: "a", engine })
    publisher.publish({ status: "loading", title: "b", engine })

    expect(posted).toEqual([
      { type: "state", revision: 1, state: { status: "loading", title: "a", engine } },
      { type: "state", revision: 2, state: { status: "loading", title: "b", engine } },
    ])
  })
})
