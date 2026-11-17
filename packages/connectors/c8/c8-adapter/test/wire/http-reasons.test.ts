import { type FailureDetails, type FailureReason, HttpFailure } from "@miragon/pulse-http"
import { describe, expect, test } from "vitest"
import { CamundaClients } from "../../src/camunda-clients.js"
import { ErrorTranslation } from "../../src/errors/error-translation.js"
import { HttpReasons } from "../../src/wire/http-reasons.js"
import { REST_URL } from "../support/fake-camunda-rest.js"

const TARGET = "http://camunda.test/v2/topology"

function failure(reason: FailureReason, details: Partial<FailureDetails> = {}): HttpFailure {
  return new HttpFailure(reason, {
    method: "GET",
    target: TARGET,
    mayHaveApplied: false,
    ...details,
  })
}

describe("the reasons of a failed request", () => {
  test.each<[FailureReason, Partial<FailureDetails>, object]>([
    [
      "unreachable",
      { code: "ECONNREFUSED" },
      { kind: "unanswered", message: `Cannot reach ${TARGET} (ECONNREFUSED)` },
    ],
    [
      "dns",
      { code: "ENOTFOUND" },
      {
        kind: "unanswered",
        message: `Cannot reach ${TARGET}: the host name does not resolve (ENOTFOUND)`,
        hint: "Check the host name in the cluster URL.",
      },
    ],
    [
      "tls",
      {},
      {
        kind: "unanswered",
        message: `Cannot reach ${TARGET}: the TLS handshake failed`,
        hint: expect.stringContaining("trusts the cluster's certificate") as unknown,
      },
    ],
    [
      "deadline",
      { limit: 60_000 },
      { kind: "unanswered", message: `${TARGET} did not answer within 60000 ms` },
    ],
    ["cancelled", {}, { kind: "unanswered", message: `The call to ${TARGET} was cancelled` }],
    [
      "connection",
      { code: "ECONNRESET" },
      {
        kind: "unanswered",
        message: `The connection to ${TARGET} failed (ECONNRESET)`,
        hint: expect.stringContaining("proxy, a VPN or a firewall") as unknown,
      },
    ],
    [
      "too-large",
      { limit: 67_108_864 },
      { kind: "unexpected", message: "the cluster answered with more than 67108864 bytes" },
    ],
    ["invalid-answer", {}, { kind: "unexpected", message: "the cluster answered no JSON" }],
    [
      "invalid-request",
      { code: "dot-segment" },
      { kind: "refused", message: `GET ${TARGET} cannot be sent (dot-segment)` },
    ],
    ["invalid-request", {}, { kind: "unusable", message: `GET ${TARGET} cannot be sent` }],
    [
      "refused-write",
      {},
      {
        kind: "unusable",
        message: `Read-only. This connection only reads, so Pulse did not send GET ${TARGET}.`,
      },
    ],
    [
      "credential",
      {},
      { kind: "unusable", message: `The credentials for ${TARGET} cannot be sent` },
    ],
    [
      "unauthorized",
      { status: 401 },
      { kind: "answered", status: 401, message: "HTTP 401 Unauthorized" },
    ],
    ["status", {}, { kind: "answered", status: 0, message: "HTTP 0" }],
    [
      "status",
      {
        status: 503,
        answer: {
          status: 503,
          statusText: "Service Unavailable",
          contentType: "application/problem+json",
          headers: {},
          body: new TextEncoder().encode(
            JSON.stringify({ title: "Service Unavailable", detail: "The broker is down" }),
          ),
        },
      },
      {
        kind: "answered",
        status: 503,
        message: "HTTP 503 Service Unavailable: The broker is down",
        title: "Service Unavailable",
        detail: "The broker is down",
        redirect: false,
      },
    ],
    ["redirect", {}, { kind: "answered", status: 0, message: "HTTP 0", redirect: true }],
    [
      "redirect",
      { status: 307 },
      {
        kind: "answered",
        status: 307,
        message: "HTTP 307 Temporary Redirect",
        hint: expect.stringContaining("which ends in /v2") as unknown,
      },
    ],
  ])("words %s %j", (reason, details, expected) => {
    expect(HttpReasons.of(failure(reason, details))).toMatchObject(expected)
  })

  test.each([
    [
      "a user name with a colon",
      { kind: "basic", username: "de:mo", password: "s3cret" },
      "The user name holds a colon, which basic authentication cannot send",
    ],
    [
      "a password with a line break",
      { kind: "basic", username: "demo", password: "s3\ncret" },
      "The user name or password holds a control character",
    ],
  ] as const)("refuse every call with %s, sending nothing", async (_name, credentials, message) => {
    const sent: unknown[] = []
    const client = new CamundaClients(
      (input) => {
        sent.push(input)
        return Promise.resolve(Response.json({ gatewayVersion: "8.10.8" }))
      },
      () => Date.now(),
    ).of({ endpoint: REST_URL, credentials })

    await expect(ErrorTranslation.translated(() => client.topology())).rejects.toMatchObject({
      failure: "misconfigured",
      message,
    })
    expect(sent).toEqual([])
  })
})
