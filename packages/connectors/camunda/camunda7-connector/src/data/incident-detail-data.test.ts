import { afterEach, describe, expect, it } from "vitest"
import { resolveEngine } from "../lib/resolve-engine.js"
import { cibsevenProvider } from "../providers/index.js"
import {
  registryFor,
  startFakeEngine,
  type FakeEngine,
  type FakeRoutes,
} from "../tools/test-support/fake-engine.js"
import { buildIncidentDetailData } from "./incident-detail-data.js"

// A real loopback engine sees the requests as sent (#328): text/plain
// stacktrace, serialized variables, retry vs. resolve per incident type.

const engines: FakeEngine[] = []
afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

const STACK = "java.lang.IllegalStateException: boom\n\tat com.acme.Billing.charge(Billing.java:42)"

const incident = (over: Record<string, unknown>) => ({
  id: "inc-1",
  processDefinitionId: "def-1",
  processInstanceId: "pi-1",
  activityId: "charge",
  incidentType: "failedJob",
  incidentMessage: "boom",
  incidentTimestamp: "2026-10-09T09:30:00.000+0000",
  configuration: "job-1",
  ...over,
})

/** The incident's instance — primary: the tabs present its state as fact. */
const INSTANCE: FakeRoutes = {
  "GET /process-instance/pi-1": { body: { id: "pi-1", definitionId: "def-1", suspended: false } },
  "GET /process-instance/pi-1/activity-instances": {
    body: { id: "pi-1", activityId: "def", childActivityInstances: [] },
  },
  "GET /process-instance/pi-1/variables": { body: {} },
}

async function build(routes: FakeRoutes) {
  // Enrichment lookups the routes leave out (diagram, definition name,
  // history total, stacktrace) answer 404 and degrade.
  const engine = await startFakeEngine(
    { ...INSTANCE, ...routes },
    { status: 404, body: { message: "not here" } },
  )
  engines.push(engine)
  const { client } = await resolveEngine(undefined, registryFor(engine))
  const data = await buildIncidentDetailData(client, {
    baseUrl: engine.baseUrl,
    provider: cibsevenProvider,
    incidentId: "inc-1",
  })
  return { data, engine }
}

describe("buildIncidentDetailData through the engine contract", () => {
  it("offers a job retry for a failedJob and reads its stacktrace as text/plain", async () => {
    const { data, engine } = await build({
      "GET /incident/inc-1": { body: incident({}) },
      "GET /job": { body: [{ id: "job-1", retries: 0, exceptionMessage: "boom" }] },
      "GET /job/job-1/stacktrace": { contentType: "text/plain", body: STACK },
      "GET /process-instance/pi-1/variables": {
        body: { payload: { type: "Json", value: '{"a":1}', valueInfo: {} } },
      },
    })
    expect(data.recovery).toEqual({ action: "retry-job", jobId: "job-1" })
    expect(data.job).toMatchObject({ id: "job-1", retries: 0, stacktrace: STACK })
    expect(data.variables).toEqual({ payload: { type: "Json", value: '{"a":1}', valueInfo: {} } })
    const byPath = new Map(engine.requests.map((r) => [r.path, r]))
    expect(byPath.get("/job/job-1/stacktrace")?.headers.accept).toBe("text/plain")
    expect(byPath.get("/process-instance/pi-1/variables")?.query).toEqual({
      deserializeValues: "false",
    })
  })

  it("keeps the failure tab without a stacktrace when the engine has none", async () => {
    const { data } = await build({
      "GET /incident/inc-1": { body: incident({}) },
      "GET /job": { body: [{ id: "job-1", retries: 0 }] },
    })
    expect(data.job).toMatchObject({ id: "job-1", stacktrace: null })
  })

  it("offers an external-task retry for a failedExternalTask (no job)", async () => {
    const { data } = await build({
      "GET /incident/inc-1": {
        body: incident({ incidentType: "failedExternalTask", configuration: "ext-1" }),
      },
    })
    expect(data.recovery).toEqual({ action: "retry-external-task", externalTaskId: "ext-1" })
    expect(data.job).toBeNull()
  })

  it("takes a delegated incident's failure target from its root cause", async () => {
    const { data } = await build({
      "GET /incident/inc-1": {
        body: incident({ configuration: null, incidentMessage: null, rootCauseIncidentId: "root" }),
      },
      "GET /incident/root": {
        body: incident({ id: "root", configuration: "job-9", incidentMessage: "deep boom" }),
      },
      "GET /job": { body: [{ id: "job-9", retries: 0 }] },
    })
    expect(data.recovery).toEqual({ action: "retry-job", jobId: "job-9" })
    expect(data.incidentMessage).toBe("deep boom")
    expect(data.job?.id).toBe("job-9")
  })

  it("resolves only a custom incident", async () => {
    const { data } = await build({
      "GET /incident/inc-1": { body: incident({ incidentType: "invoiceMismatch" }) },
    })
    expect(data.recovery).toEqual({ action: "resolve" })
    expect(data.job).toBeNull()
  })
})

describe("buildIncidentDetailData — the definition's real key", () => {
  // A key over ~25 characters with UUID ids: the engine stores a bare id, and
  // a key parsed from it is that UUID — no key filter matches it.
  const LONG_KEY = "customerOnboardingApprovalProcess"
  const UUID = "6f1c2a9e-0b7d-4c33-9a51-3d2e8f40b7aa"

  it("takes the key from the fetched definition, not from its bare UUID id", async () => {
    const { data } = await build({
      "GET /incident/inc-1": { body: incident({ processDefinitionId: UUID }) },
      "GET /job": { body: [] },
      [`GET /process-definition/${UUID}`]: {
        body: { id: UUID, key: LONG_KEY, name: "Onboarding", version: 4 },
      },
    })

    // The header and the hand-offs' scopingDefinitionKey read this key.
    expect(data).toMatchObject({
      processDefinitionKey: LONG_KEY,
      processDefinitionId: UUID,
      processDefinitionName: "Onboarding",
      processDefinitionVersion: 4,
    })
    // So does the CIB Seven cockpit link, which addresses the key.
    expect(data.cockpitInstanceUrl).toContain(`/process/${LONG_KEY}/4/pi-1?tab=variables`)
  })

  it("falls back to the parsed key when the definition lookup fails", async () => {
    const { data } = await build({
      "GET /incident/inc-1": { body: incident({ processDefinitionId: "order:2:d2" }) },
      "GET /job": { body: [] },
    })

    expect(data.processDefinitionKey).toBe("order")
    expect(data.processDefinitionName).toBeNull()
    expect(data.cockpitInstanceUrl).toContain("/process/order/pi-1?tab=variables")
  })

  it("builds no cockpit link from a bare id whose lookup failed — never the UUID as a key", async () => {
    const { data } = await build({
      "GET /incident/inc-1": { body: incident({ processDefinitionId: UUID }) },
      "GET /job": { body: [] },
    })

    // The header shows the id it has (the hand-offs scope by it exactly) …
    expect(data.processDefinitionKey).toBe(UUID)
    // … but a link that addresses a key is unbuildable: null, not a guess.
    expect(data.cockpitInstanceUrl).toBeNull()
  })

  it("names no key for an incident without a definition — and looks none up", async () => {
    const { data, engine } = await build({
      "GET /incident/inc-1": { body: incident({ processDefinitionId: null }) },
      "GET /job": { body: [] },
    })

    expect(data.processDefinitionKey).toBe("")
    expect(engine.requests.some((r) => r.path.startsWith("/process-definition"))).toBe(false)
  })
})

// One rule with analytics (`readBpmnNames`): the head showed "Rechnung&#10;prüfen".
describe("buildIncidentDetailData — names from a Modeler diagram", () => {
  it("names the activity with its references decoded and the process by its pool", async () => {
    const xml = `<definitions>
  <collaboration id="C"><participant id="Pool" name="Miravelo - Bike Leasing" processRef="order"/></collaboration>
  <process id="order"><serviceTask id="charge" name="Rechnung&#10;prüfen &#38; buchen"/></process>
</definitions>`
    const { data } = await build({
      "GET /incident/inc-1": { body: incident({ processDefinitionId: "order:2:d2" }) },
      "GET /job": { body: [] },
      "GET /process-definition/order:2:d2": {
        body: { id: "order:2:d2", key: "order", name: null, version: 2 },
      },
      "GET /process-definition/order:2:d2/xml": { body: { bpmn20Xml: xml } },
    })

    expect(data).toMatchObject({
      activityName: "Rechnung prüfen & buchen",
      processDefinitionName: "Miravelo - Bike Leasing",
    })
  })
})
