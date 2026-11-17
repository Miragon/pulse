import { describe, expect, test } from "vitest"
import { SecretMask } from "../../src/wire/secret-mask.js"
import type { WireReason } from "../../src/wire/wire-reason.js"

const CLIENT = SecretMask.of({
  kind: "clientCredentials",
  tokenEndpoint: "https://login.example.com/token",
  clientId: "pulse-reader",
  clientSecret: "reader secret",
})

const TOKEN: WireReason = {
  kind: "token",
  trouble: "client",
  endpoint: "https://login.example.com/token",
  status: 401,
  code: "invalid_client:reader+secret",
  problem: undefined,
  holdMs: 0,
  capBytes: undefined,
  cause: undefined,
}

describe("the mask of a client secret", () => {
  test("covers the cluster's message, title and detail in every form of the secret", () => {
    expect(
      CLIENT.reason({
        kind: "answered",
        status: 500,
        message: "client_secret=reader%20secret and reader  secret",
        title: "reader secret",
        detail: "reader secret quoted",
        redirect: false,
        hint: undefined,
        cause: undefined,
      }),
    ).toMatchObject({
      message: "client_secret=*** and ***",
      title: "***",
      detail: "*** quoted",
    })
  })

  test("covers the code a token endpoint answers with, and every other message", () => {
    expect(CLIENT.reason(TOKEN)).toMatchObject({ code: "invalid_client:***" })
    expect(CLIENT.reason({ ...TOKEN, code: undefined })).toMatchObject({ code: undefined })
    expect(
      CLIENT.reason({ kind: "unanswered", message: "reader secret", hint: undefined, cause: 1 }),
    ).toEqual({ kind: "unanswered", message: "***", hint: undefined, cause: 1 })
  })

  test("leaves every text of a connection without client credentials as it is", () => {
    const basic = SecretMask.of({ kind: "basic", username: "demo", password: "reader secret" })

    expect(basic.reason(TOKEN)).toEqual(TOKEN)
    expect(basic.text("reader secret")).toBe("reader secret")
  })
})
