import { describe, expect, test } from "vitest"
import { MessageGuards } from "../../src/core/protocol/index.js"
import type {
  IncidentRow,
  InstanceView,
  LiveUpdates,
  VariableRow,
} from "../../src/core/protocol/index.js"
import { VariableValues } from "../../src/core/views/variable-values.js"
import { WriteOutcomes } from "../../src/core/views/write-outcomes.js"
import { WriteRequests } from "../../src/core/views/write-requests.js"

const INCIDENT: IncidentRow = {
  id: "incident-1",
  shortId: "incident-1",
  elementId: "Activity_ChargePayment",
  typeLabel: "Failed job",
  engineType: "failedJob",
  message: "Card expired",
  createdAt: "2026-10-21T08:00:00Z",
  detailsLabel: "Stacktrace",
  retryable: true,
}

function viewWith(overrides: Partial<InstanceView>): InstanceView {
  return {
    kind: "instance",
    engine: { name: "shop-dev", environment: "local", host: "localhost:18090" },
    asOf: "2026-10-21T08:00:00Z",
    instance: {
      id: "instance-1",
      shortId: "instance-1",
      state: "Running",
      processName: "Order fulfillment",
      bpmnProcessId: "order-fulfillment",
      version: 3,
      definitionId: "order-fulfillment:3",
    },
    diagramXml: "",
    markers: [],
    calls: [],
    incidents: [],
    waitStates: [],
    path: [],
    variables: [],
    truncated: false,
    ...overrides,
  }
}

describe("the outcome of a retry", () => {
  test("reports a new incident at the same element as failed again, its actions stay on the card", () => {
    const again = { ...INCIDENT, id: "incident-2", rootCause: "CardExpiredException: 03/2025" }
    expect(WriteOutcomes.afterRetry(INCIDENT, viewWith({ incidents: [again] }))).toEqual({
      tone: "danger",
      title: "Failed again at Activity_ChargePayment.",
      detail: "CardExpiredException: 03/2025",
      actions: [],
    })
  })

  test("reports a failure without details without an action", () => {
    const again: IncidentRow = {
      id: "incident-3",
      shortId: "incident-3",
      elementId: INCIDENT.elementId,
      typeLabel: INCIDENT.typeLabel,
      engineType: INCIDENT.engineType,
      message: INCIDENT.message,
      createdAt: INCIDENT.createdAt,
    }
    expect(WriteOutcomes.afterRetry(INCIDENT, viewWith({ incidents: [again] })).actions).toEqual([])
  })

  test("reports an instance that moved on", () => {
    expect(WriteOutcomes.afterRetry(INCIDENT, viewWith({}))).toEqual({
      tone: "info",
      title: "Moved on from Activity_ChargePayment.",
      actions: [],
    })
  })

  test("names the element with its name when the instance waits there", () => {
    const view = viewWith({
      waitStates: [
        {
          elementId: "Activity_ChargePayment",
          elementName: "Charge payment",
          kindLabel: "Worker task",
        },
      ],
    })
    expect(WriteOutcomes.afterRetry(INCIDENT, view).title).toBe(
      "Waiting at Charge payment for the next attempt.",
    )
    expect(WriteOutcomes.afterRetry(INCIDENT, view, true).detail).toContain(
      "keeps checking for a minute",
    )
    expect(WriteOutcomes.afterRetry(INCIDENT, view).detail).toContain("Refresh later")
  })
})

const FRESH = { ageMs: 1200 }

describe("the confirmation of a write", () => {
  test("says how old the data is and whether live updates keep it current", () => {
    const facts = (ageMs: number, live?: LiveUpdates) =>
      WriteRequests.retry(viewWith({}), INCIDENT, { ageMs, live }).facts.at(-1)
    expect(facts(1200)).toBe("Data read just now")
    expect(facts(125_000, { status: "live", everySeconds: 30 })).toBe("Data read 2 min 5 s ago")
    expect(facts(125_000, { status: "paused", reason: "user" })).toBe(
      "Data read 2 min 5 s ago · live updates are paused",
    )
    expect(facts(9000, { status: "reconnecting", retryAt: "2026-10-21T09:00:20.000Z" })).toBe(
      "Data read 9.0 s ago · the last live update failed",
    )
    expect(facts(9000, { status: "stopped", reason: "refused" })).toBe(
      "Data read 9.0 s ago · live updates stopped",
    )
    expect(facts(9000, { status: "off", environment: "production", everySeconds: 30 })).toBe(
      "Data read 9.0 s ago · live updates are off",
    )
  })

  test("names the called instance a retry runs in", () => {
    const inCalled = {
      ...INCIDENT,
      inCalledInstance: { instanceId: "child-1", shortId: "child-1", bpmnProcessId: "shipment" },
    }
    const request = WriteRequests.retry(
      viewWith({ instance: { ...viewWith({}).instance, businessKey: "ORD-1" } }),
      inCalled,
      FRESH,
    )
    expect(request.facts).toEqual([
      "Instance ORD-1 (instance-1) · Order fulfillment v3",
      "In called instance shipment child-1",
      "Failed job: Card expired",
      "Retries 0 → 1",
      "Data read just now",
    ])
  })

  test("warns that a local variable of the failing element hides the change", () => {
    const row: VariableRow = {
      name: "amount",
      valueJson: "x".repeat(80),
      truncated: false,
      editor: "text",
      shadowedAt: ["Activity_ChargePayment"],
    }
    const request = WriteRequests.variableChange(viewWith({}), row, '"short"', FRESH)
    expect(request.facts).toEqual([
      "Instance instance-1 · Order fulfillment v3",
      `Value: ${"x".repeat(59)}… → "short"`,
      "Activity_ChargePayment keeps its own amount; this change does not reach it.",
      "Data read just now",
    ])
  })

  test("names the type a null variable will get", () => {
    const row: VariableRow = {
      name: "iban",
      type: "Null",
      valueJson: "null",
      truncated: false,
      editor: "any",
    }
    expect(WriteRequests.variableChange(viewWith({}), row, '"4117"', FRESH).facts[1]).toBe(
      'Null → text: null → "4117"',
    )
    expect(WriteRequests.variableChange(viewWith({}), row, "4117", FRESH).facts[1]).toBe(
      "Null → whole number: null → 4117",
    )
  })

  test("offers no retry after a change when there is not exactly one retryable incident", () => {
    expect(WriteOutcomes.afterChange("amount", viewWith({})).actions).toEqual([])
    const two = [INCIDENT, { ...INCIDENT, id: "incident-2" }]
    expect(WriteOutcomes.afterChange("amount", viewWith({ incidents: two })).actions).toEqual([])
  })
})

describe("an outcome next to the incident headline", () => {
  const headline = {
    tone: "danger" as const,
    title: "1 incident",
    detail: "CardExpiredException",
    actions: [],
  }

  test("stays a strip of its own, also when the same incident failed again", () => {
    const failed = { tone: "danger" as const, title: "Failed again at X.", actions: [] }
    const view = WriteOutcomes.shownIn(viewWith({ headline, incidents: [INCIDENT] }), failed)
    expect(view.outcome).toBe(failed)
    expect(view.headline).toBe(headline)

    const changed = { tone: "info" as const, title: "Changed amount.", actions: [] }
    expect(
      WriteOutcomes.shownIn(viewWith({ headline, incidents: [INCIDENT] }), changed).outcome,
    ).toBe(changed)
    expect(WriteOutcomes.shownIn(viewWith({}), undefined).outcome).toBeUndefined()
  })
})

describe("the value check", () => {
  test.each([
    ["text", '"hello"', true],
    ["text", "hello", false],
    ["integer", "-12", true],
    ["integer", "1.5", false],
    ["decimal", "1.5e3", true],
    ["decimal", "abc", false],
    ["boolean", "false", true],
    ["boolean", "yes", false],
    ["date", '"2026-10-22T10:00:00Z"', true],
    ["date", '"2026-10-22T10:00:00+02:00"', true],
    ["date", '"2026-10-22T10:00:00"', false],
    ["date", '"2026-13-45T10:00:00Z"', false],
    ["json", '{"a":[1,2]}', true],
    ["json", "{broken", false],
    ["integer", "null", true],
    ["any", '"text"', true],
    ["any", "text", false],
  ] as const)("%s accepts %s: %s", (editor, valueJson, valid) => {
    const problem = VariableValues.whyInvalid({ name: "value", editor }, valueJson)
    expect(problem === undefined).toBe(valid)
  })

  test("names the variable, what it takes and its type", () => {
    expect(
      VariableValues.whyInvalid({ name: "when", editor: "date", type: "Date" }, '"soon"'),
    ).toBe("when takes a date and time with a zone, such as 2026-10-22T10:00:00Z (Date).")
  })
})

describe("the write intents", () => {
  test.each([
    [{ type: "retryIncident", incidentId: "i" }, true],
    [{ type: "retryIncident" }, false],
    [{ type: "retryIncident", incidentId: 7 }, false],
    [{ type: "setVariable", name: "amount", valueJson: "1" }, true],
    [{ type: "setVariable", name: "", valueJson: "1" }, false],
    [{ type: "setVariable", name: "n".repeat(256), valueJson: "1" }, false],
    [{ type: "setVariable", name: "amount", valueJson: "x".repeat(64 * 1024 + 1) }, false],
    [{ type: "setVariable", name: "amount", valueJson: '"€"'.repeat(10_000) }, true],
    [{ type: "setVariable", name: "amount", valueJson: '"€"'.repeat(22_000) }, false],
    [{ type: "setVariable", name: "amount" }, false],
  ])("%o is %s", (intent, valid) => {
    expect(MessageGuards.isWebviewIntent(intent)).toBe(valid)
  })
})
