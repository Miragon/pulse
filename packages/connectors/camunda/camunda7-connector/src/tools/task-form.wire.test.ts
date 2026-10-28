import { afterEach, describe, expect, it } from "vitest"
import { registerIncidentIssueTools } from "./incident-issue.js"
import { registerTaskFormTools } from "./task-form.js"
import {
  callTool,
  captureTools,
  registryFor,
  startFakeEngine,
  type FakeEngine,
  type FakeRoutes,
} from "./test-support/fake-engine.js"

/**
 * #328: an unknown task used to read as "no form", a failed stacktrace read (406, the endpoint
 * is text/plain-only) as "no stacktrace available".
 */

const tools = captureTools(registerTaskFormTools, (register) =>
  registerIncidentIssueTools(register, {}),
)

const engines: FakeEngine[] = []
afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

async function engineWith(routes: FakeRoutes) {
  const engine = await startFakeEngine(routes)
  engines.push(engine)
  return engine
}

function call(engine: FakeEngine, name: string, args: Record<string, unknown>) {
  return callTool(tools.get(name)!, registryFor(engine), args)
}

const FORM_BPMN = `<definitions xmlns:camunda="http://camunda.org/schema/1.0/bpmn"><process id="p">
  <userTask id="review"><extensionElements><camunda:formData>
    <camunda:formField id="amount" type="long">
      <camunda:validation><camunda:constraint name="required" /></camunda:validation>
    </camunda:formField>
    <camunda:formField id="due" type="date" />
  </camunda:formData></extensionElements></userTask>
</process></definitions>`

const TASK = { id: "t-1", taskDefinitionKey: "review", processDefinitionId: "def-1", formKey: null }
const NOT_FOUND = {
  status: 404,
  body: { type: "InvalidRequestException", message: "No matching task with id t-1" },
}

describe("camunda7_get_task_form", () => {
  it("returns the typed fields with their constraints and the current values", async () => {
    const engine = await engineWith({
      "GET /task/t-1": { body: TASK },
      "GET /process-definition/def-1/xml": { body: { id: "def-1", bpmn20Xml: FORM_BPMN } },
      "GET /task/t-1/variables": {
        body: { due: { type: "Date", value: "2026-09-30T22:00:00.000+0000", valueInfo: {} } },
      },
    })
    expect(await call(engine, "camunda7_get_task_form", { taskId: "t-1" })).toEqual({
      taskId: "t-1",
      fields: [
        { name: "amount", type: "Long", required: true, source: "form-data" },
        {
          name: "due",
          type: "Date",
          defaultValue: "2026-09-30T22:00:00.000+0000",
          source: "form-data",
        },
      ],
    })
    expect(engine.requests.at(-1)?.query).toEqual({ deserializeValues: "false" })
  })

  it("fails for an unknown task instead of reporting 'no form'", async () => {
    const engine = await engineWith({ "GET /task/t-1": NOT_FOUND })
    await expect(call(engine, "camunda7_get_task_form", { taskId: "t-1" })).rejects.toThrow(
      "[404 InvalidRequestException] No matching task with id t-1",
    )
  })

  it("fails when the task's BPMN cannot be read — a form could be hiding there", async () => {
    const engine = await engineWith({
      "GET /task/t-1": { body: TASK },
      "GET /process-definition/def-1/xml": { status: 403, body: { message: "not authorized" } },
    })
    await expect(call(engine, "camunda7_get_task_form", { taskId: "t-1" })).rejects.toThrow(
      /^\[403\] not authorized/,
    )
  })

  it("degrades only the optional value prefill", async () => {
    const engine = await engineWith({
      "GET /task/t-1": { body: TASK },
      "GET /process-definition/def-1/xml": { body: { bpmn20Xml: FORM_BPMN } },
      "GET /task/t-1/variables": { status: 500, body: { message: "Cannot deserialize object" } },
    })
    const form = (await call(engine, "camunda7_get_task_form", { taskId: "t-1" })) as {
      fields: Array<{ name: string; defaultValue?: unknown }>
    }
    expect(form.fields.map((f) => [f.name, f.defaultValue])).toEqual([
      ["amount", undefined],
      ["due", undefined],
    ])
  })

  it("names the task's own form when it has no form fields", async () => {
    const engine = await engineWith({
      "GET /task/t-1": { body: { ...TASK, formKey: "embedded:app:forms/review.html" } },
      "GET /process-definition/def-1/xml": { body: { bpmn20Xml: "<definitions/>" } },
    })
    expect(await call(engine, "camunda7_get_task_form", { taskId: "t-1" })).toEqual({
      taskId: "t-1",
      fields: [],
      formKey: "embedded:app:forms/review.html",
    })
  })

  it("names a linked Camunda Form (camunda:formRef) — the task has no formKey then", async () => {
    const engine = await engineWith({
      "GET /task/t-1": {
        body: { ...TASK, camundaFormRef: { key: "invoiceForm", binding: "latest", version: null } },
      },
      "GET /process-definition/def-1/xml": { body: { bpmn20Xml: "<definitions/>" } },
    })
    expect(await call(engine, "camunda7_get_task_form", { taskId: "t-1" })).toEqual({
      taskId: "t-1",
      fields: [],
      formRef: "invoiceForm",
    })
  })
})

const STACK = "java.lang.IllegalStateException: boom\n\tat com.acme.Billing.charge(Billing.java:42)"
const incidentRoute = (incident: Record<string, unknown>): FakeRoutes => ({
  "GET /incident/inc-1": { body: { id: "inc-1", ...incident } },
})

describe("camunda7_format_incident_issue reads the failure text through the contract", () => {
  it("fetches a failed job's stacktrace as text/plain (the default Accept is a 406)", async () => {
    const engine = await engineWith({
      ...incidentRoute({ incidentType: "failedJob", configuration: "job-1" }),
      "GET /job/job-1/stacktrace": { contentType: "text/plain", body: STACK },
    })
    const draft = (await call(engine, "camunda7_format_incident_issue", {
      incidentId: "inc-1",
    })) as {
      body: string
    }
    expect(engine.requests.find((r) => r.path === "/job/job-1/stacktrace")?.headers.accept).toBe(
      "text/plain",
    )
    expect(draft.body).toContain("IllegalStateException: boom")
    expect(draft.body).toContain("Billing.charge")
  })

  it("fetches a failed external task's error details", async () => {
    const engine = await engineWith({
      ...incidentRoute({ incidentType: "failedExternalTask", configuration: "ext-1" }),
      "GET /external-task/ext-1/errorDetails": {
        contentType: "text/plain",
        body: "SMTP 550\nmailbox full",
      },
    })
    const draft = (await call(engine, "camunda7_format_incident_issue", {
      incidentId: "inc-1",
    })) as {
      body: string
    }
    expect(engine.requests.find((r) => r.path.endsWith("/errorDetails"))?.headers.accept).toBe(
      "text/plain",
    )
    // Free text has no frames to condense — kept whole.
    expect(draft.body).toContain("SMTP 550\nmailbox full")
  })

  it("says why the stacktrace is missing instead of claiming there is none", async () => {
    const engine = await engineWith({
      ...incidentRoute({ incidentType: "failedJob", configuration: "job-1" }),
      "GET /job/job-1/stacktrace": { status: 403, body: { message: "not authorized" } },
    })
    const draft = (await call(engine, "camunda7_format_incident_issue", {
      incidentId: "inc-1",
    })) as {
      body: string
    }
    // The reason is engine/network text — in a span it cannot close (#338).
    expect(draft.body).toContain("_Stacktrace could not be loaded:_ `[403] not authorized")
    expect(draft.body).not.toContain("_No stacktrace available._")
  })

  it("asks for nothing on a custom incident", async () => {
    const engine = await engineWith(
      incidentRoute({ incidentType: "invoiceMismatch", configuration: "x" }),
    )
    const draft = (await call(engine, "camunda7_format_incident_issue", {
      incidentId: "inc-1",
    })) as {
      body: string
    }
    expect(engine.requests.map((r) => r.path)).toEqual(["/incident/inc-1"])
    expect(draft.body).toContain("_No stacktrace available._")
  })
})
