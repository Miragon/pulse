import { describe, expect, test } from "vitest"
import { CamundaWire, type WireRequest } from "../../src/wire/camunda-wire.js"
import { ClientCredentialsSources } from "../../src/wire/client-credentials-sources.js"
import type { WirePlatform } from "../../src/wire/wire-platform.js"
import type { EngineCredentials } from "@miragon/pulse-runtime-view/ports"
import { fakeCamundaRest, NONE, problem, REST_URL, TOPOLOGY } from "../support/fake-camunda-rest.js"

const CANCELLATION = "/process-instances/1/cancellation"

const BASIC: EngineCredentials = { kind: "basic", username: "demo", password: "demo-secret" }

function wireOver(send: typeof fetch, credentials = NONE): CamundaWire {
  const platform: WirePlatform = { send, now: () => 0 }
  const sources = new ClientCredentialsSources(platform)
  return CamundaWire.of({ endpoint: REST_URL, credentials }, sources, platform)
}

function askingForALogin(): Promise<Response> {
  return Promise.resolve(
    problem(401, "Unauthorized", "An Authentication object was not found in the SecurityContext"),
  )
}

function request(overrides: Partial<WireRequest>): WireRequest {
  return {
    method: "GET",
    path: "/topology",
    accept: "application/json",
    intent: "read",
    ...overrides,
  }
}

describe("the wire of a cluster", () => {
  test("sends a read", async () => {
    const camunda = fakeCamundaRest([TOPOLOGY])

    expect(await wireOver(camunda.send).exchange(request({}))).toEqual({
      text: '{"gatewayVersion":"8.10.8"}',
    })
    expect(camunda.requests).toHaveLength(1)
  })

  test("says to add a login when the cluster asks for one and Pulse sent none", async () => {
    expect(await wireOver(askingForALogin).exchange(request({}))).toMatchObject({
      reason: {
        kind: "answered",
        status: 401,
        message: "HTTP 401 Unauthorized",
        hint: "The cluster asks for a login, and Pulse sent none. Add one with Set credentials.",
      },
    })
  })

  test("keeps the cluster's words for a login it refuses", async () => {
    expect(await wireOver(askingForALogin, BASIC).exchange(request({}))).toMatchObject({
      reason: {
        kind: "answered",
        status: 401,
        message:
          "HTTP 401 Unauthorized: An Authentication object was not found in the SecurityContext",
        hint: undefined,
      },
    })
  })

  test("refuses a write before sending it, since its connection only reads", async () => {
    const camunda = fakeCamundaRest([])

    const outcome = await wireOver(camunda.send).exchange(
      request({ method: "POST", path: CANCELLATION, intent: "write", body: "{}" }),
    )

    expect(outcome).toMatchObject({
      reason: {
        kind: "unusable",
        message: `Read-only. This connection only reads, so Pulse did not send POST ${REST_URL}${CANCELLATION}.`,
      },
    })
    expect(camunda.requests).toEqual([])
  })
})
