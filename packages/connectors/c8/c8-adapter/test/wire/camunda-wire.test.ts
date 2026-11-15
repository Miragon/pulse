import { describe, expect, test } from "vitest"
import { CamundaWire, type WireRequest } from "../../src/wire/camunda-wire.js"
import { ClientCredentialsSources } from "../../src/wire/client-credentials-sources.js"
import type { WirePlatform } from "../../src/wire/wire-platform.js"
import { fakeCamundaRest, NONE, REST_URL, TOPOLOGY } from "../support/fake-camunda-rest.js"

const CANCELLATION = "/process-instances/1/cancellation"

function wireOver(send: typeof fetch): CamundaWire {
  const platform: WirePlatform = { send, now: () => 0 }
  const sources = new ClientCredentialsSources(platform)
  return CamundaWire.of({ endpoint: REST_URL, credentials: NONE }, sources, platform)
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
