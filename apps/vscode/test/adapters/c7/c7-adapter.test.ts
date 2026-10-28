import { IncidentId, type EngineConnection } from "../../../src/contract/index.js"
import { describe, expect, test } from "vitest"
import { C7Adapter } from "../../../src/adapters/c7/index.js"
import { fakeEngineRest, REST_URL } from "./support/fake-engine-rest.js"

const TELEMETRY = {
  route: "GET /telemetry/data",
  answer: { product: { name: "Operaton", version: "2.1.5" } },
}
const BASIC: EngineConnection = {
  endpoint: REST_URL,
  credentials: { kind: "basic", username: "demo", password: "s3cret" },
}
const BASIC_HEADER = `Basic ${btoa("demo:s3cret")}`

describe("the C7 adapter", () => {
  test("reads from the endpoint of the connection with its credentials, never following a redirect", async () => {
    const engine = fakeEngineRest([TELEMETRY])
    const runtime = new C7Adapter(engine.send).runtime(BASIC)

    expect(await runtime.describeEngine()).toEqual({ product: "Operaton", version: "2.1.5" })

    expect(engine.requests).toEqual([
      expect.objectContaining({
        route: "GET /telemetry/data",
        authorization: BASIC_HEADER,
        redirect: "manual",
      }),
    ])
  })

  test("writes to the same endpoint with the same credentials", async () => {
    const engine = fakeEngineRest([
      {
        route: "GET /incident/i1",
        answer: {
          id: "i1",
          rootCauseIncidentId: "i1",
          incidentType: "failedJob",
          configuration: "j1",
        },
      },
      { route: "PUT /job/j1/retries", answer: new Response(null, { status: 204 }) },
    ])
    const commands = new C7Adapter(engine.send).commands(BASIC)

    await commands.retryIncident(IncidentId("i1"))

    expect(engine.requests.map((request) => [request.route, request.authorization])).toEqual([
      ["GET /incident/i1", BASIC_HEADER],
      ["PUT /job/j1/retries", BASIC_HEADER],
    ])
  })

  test("connects without credentials when the connection has none", async () => {
    const engine = fakeEngineRest([TELEMETRY])
    const runtime = new C7Adapter(engine.send).runtime({
      endpoint: REST_URL,
      credentials: { kind: "none" },
    })

    await runtime.describeEngine()

    expect(engine.requests[0]?.authorization).toBeNull()
  })
})
