/**
 * The edges of each rule, one by one: what the mutation run showed no other test pinned.
 */
import { STATUS_CODES } from "node:http"
import { getEventListeners } from "node:events"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  bearerCredential,
  bearerToken,
  type Connection,
  createHttp,
  CredentialError,
  decodeText,
  FAILURE_REASONS,
  HttpFailure,
  type HttpRequest,
  INTEGER_MODES,
  maskJsonText,
  mediaTypeOf,
  noCredential,
  rootOf,
  secretForms,
  STATUS_TEXT,
  type TokenSource,
} from "../src/index.js"
import { readBody } from "../src/body.js"
import { reasonOfCode } from "../src/thrown.js"
import { jsonAnswer, platformOf, type Step, textAnswer } from "./fake-fetch.js"

const ROOT = "http://engine.test/engine-rest"
const GET: HttpRequest = { method: "GET", url: `${ROOT}/x`, intent: "read" }

function httpOf(steps: readonly Step[], connection: Partial<Connection> = {}) {
  const fake = platformOf(steps)
  const http = createHttp(
    { url: ROOT, credential: noCredential, timeoutMs: 1_000, ...connection },
    fake.platform,
  )
  return { http, ...fake }
}

const failureOf = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (thrown: unknown) => thrown as HttpFailure,
  )

afterEach(() => {
  vi.useRealTimers()
})

describe("the tables", () => {
  it("phrase every status as Node does", () => {
    for (const [status, phrase] of Object.entries(STATUS_TEXT)) {
      expect(phrase, status).toBe(STATUS_CODES[status])
    }
    expect(Object.keys(STATUS_TEXT)).toHaveLength(29)
  })

  it.each([
    [
      "tls",
      [
        "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
        "UNABLE_TO_GET_ISSUER_CERT",
        "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
        "UNABLE_TO_DECRYPT_CERT_SIGNATURE",
        "UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY",
        "SELF_SIGNED_CERT_IN_CHAIN",
        "DEPTH_ZERO_SELF_SIGNED_CERT",
        "CERT_HAS_EXPIRED",
        "CERT_NOT_YET_VALID",
        "CERT_REVOKED",
        "CERT_UNTRUSTED",
        "CERT_REJECTED",
        "CERT_SIGNATURE_FAILURE",
        "CERT_CHAIN_TOO_LONG",
        "INVALID_CA",
        "INVALID_PURPOSE",
        "PATH_LENGTH_EXCEEDED",
        "HOSTNAME_MISMATCH",
        "ERR_TLS_CERT_ALTNAME_INVALID",
        "ERR_TLS_HANDSHAKE_TIMEOUT",
        "ERR_SSL_WRONG_VERSION_NUMBER",
        "ERR_SSL_UNSUPPORTED_PROTOCOL",
        "ERR_SSL_NO_PROTOCOLS_AVAILABLE",
        "ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION",
        "ERR_SSL_TLSV1_ALERT_UNKNOWN_CA",
        "ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE",
        "ERR_SSL_SSLV3_ALERT_BAD_CERTIFICATE",
        "ERR_SSL_TLSV13_ALERT_CERTIFICATE_REQUIRED",
      ],
    ],
    ["dns", ["ENOTFOUND", "EAI_AGAIN", "EAI_FAIL", "EAI_NONAME", "EAI_NODATA"]],
    [
      "unreachable",
      [
        "ECONNREFUSED",
        "EHOSTUNREACH",
        "ENETUNREACH",
        "EHOSTDOWN",
        "ENETDOWN",
        "EADDRNOTAVAIL",
        "UND_ERR_CONNECT_TIMEOUT",
      ],
    ],
    [
      "invalid-request",
      [
        "UND_ERR_INVALID_ARG",
        "UND_ERR_NOT_SUPPORTED",
        "ERR_INVALID_URL",
        "ERR_INVALID_ARG_TYPE",
        "ERR_INVALID_ARG_VALUE",
        "ERR_INVALID_HTTP_TOKEN",
        "ERR_INVALID_CHAR",
      ],
    ],
    // A TLS error after the handshake may come once the request left: a write keeps its caveat.
    [
      "connection",
      [
        "ECONNRESET",
        "EPIPE",
        "UND_ERR_SOCKET",
        "ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC",
        "ERR_SSL_SSLV3_ALERT_BAD_RECORD_MAC",
        "ERR_TLS_RENEGOTIATION_DISABLED",
      ],
    ],
  ])("read each code of %s as it", (reason, codes) => {
    for (const code of codes) expect(reasonOfCode(code), code).toBe(reason)
  })

  it("name every reason and every integer mode", () => {
    expect(FAILURE_REASONS).toHaveLength(14)
    expect(new Set(FAILURE_REASONS).size).toBe(14)
    expect(INTEGER_MODES).toEqual(["number", "string", "bigint", "raw"])
  })
})

describe("the failure's message", () => {
  const base = { method: "GET", target: "http://h/x", mayHaveApplied: false }

  it.each([
    ["unauthorized", {}, "GET http://h/x: 401 Unauthorized"],
    ["cancelled", {}, "GET http://h/x: cancelled by the caller"],
    [
      "credential",
      { code: "token-syntax" },
      "GET http://h/x: the credential is refused (token-syntax)",
    ],
    ["status", { status: 418 }, "GET http://h/x: 418"],
    [
      "redirect",
      { status: 302, location: "http://sso/login" },
      "GET http://h/x: 302 redirect to http://sso/login: redirects are never followed: point the URL at the API root itself (https:// when the server redirects from http://); a redirect to a login page means the credentials are missing or expired",
    ],
  ] as const)("of %s, built from its details alone", (reason, details, message) => {
    const failure = new HttpFailure(reason, { ...base, ...details })
    expect(failure.message).toBe(message)
    expect(failure.name).toBe("HttpFailure")
    expect("cause" in failure).toBe(false)
  })

  it("names no target it has not", () => {
    const failure = new HttpFailure("refused-write", {
      method: "PUT",
      target: "",
      mayHaveApplied: false,
    })
    expect(failure.message).toBe("PUT: refused: the connection only reads")
  })

  it("keeps the cause it was given", () => {
    const cause = new Error("x")
    expect(new HttpFailure("connection", base, cause).cause).toBe(cause)
  })
})

describe("the edges of a request", () => {
  it("takes the longest timer and a method that only ends like GET", async () => {
    const { http, calls } = httpOf([jsonAnswer({})], { timeoutMs: 2_147_483_647 })
    await http.send({ ...GET, method: "TARGET", body: "{}" })
    await http.send({ ...GET, method: "GETX", body: "{}" })
    expect(calls.map((call) => call.method)).toEqual(["TARGET", "GETX"])
  })

  it("masks a secret a request's own header names in a refusal before sending", async () => {
    const { http } = httpOf([jsonAnswer({})], { readOnly: true, secretHeaders: ["x-api-key"] })
    const request = { method: "PUT", url: `${ROOT}/keys/key-4711`, intent: "write" } as const
    const failure = await failureOf(http.send({ ...request, headers: { "X-Api-Key": "key-4711" } }))
    expect(failure?.target).toBe(`${ROOT}/keys/***`)
  })

  it("refuses a credential before sending, applying nothing", async () => {
    const source: TokenSource = {
      renewable: false,
      token: () => Promise.resolve("a b"),
      rejected: () => Promise.resolve(false),
    }
    const { http } = httpOf([jsonAnswer({})], { credential: bearerCredential(source) })
    expect(await failureOf(http.send(GET))).toMatchObject({
      reason: "credential",
      mayHaveApplied: false,
    })
  })

  it("asks a renewable credential that sent no token nothing after a 401", async () => {
    let asked = 0
    const source: TokenSource = {
      renewable: true,
      token: () => Promise.resolve(undefined),
      rejected: () => Promise.resolve(++asked > 0),
    }
    const { http, calls } = httpOf([new Response(null, { status: 401 })], {
      credential: bearerCredential(source),
    })
    expect((await http.send(GET)).status).toBe(401)
    expect([calls.length, asked]).toEqual([1, 0])
  })

  it("leaves no timer behind once the answer is read", async () => {
    vi.useFakeTimers()
    const { http } = httpOf([jsonAnswer({})])
    await http.send(GET)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("is a redirect from 300 on, and measures each answer by the platform's clock", async () => {
    // The redirect reads the clock once (it ends before an answer), the answer twice.
    const clock = [0, 1_000, 1_250]
    const fake = platformOf([new Response(null, { status: 300 }), jsonAnswer({})])
    const http = createHttp(
      { url: ROOT, credential: noCredential, timeoutMs: 1_000 },
      { ...fake.platform, now: () => clock.shift() ?? 0 },
    )
    expect(await failureOf(http.send(GET))).toMatchObject({ reason: "redirect", status: 300 })
    await http.send({ ...GET, headers: { "X-Plain": "1", "Proxy-Authorization": "Basic x" } })
    expect(fake.events.at(-2)).toMatchObject({
      headers: { "proxy-authorization": "***", "x-plain": "1" },
      secretHeaders: ["proxy-authorization"],
    })
    expect(fake.events.at(-1)).toMatchObject({ durationMs: 250 })
  })
})

describe("the edges of an answer", () => {
  it("keeps an error answer as it came when its secrets are not in it", async () => {
    const { http } = httpOf([textAnswer("all fine here", 500)], {
      credential: bearerCredential({
        renewable: false,
        token: () => Promise.resolve("tok-1234"),
        rejected: () => Promise.resolve(false),
      }),
    })
    expect((await http.send(GET)).contentType).toBe("text/plain")
  })

  it("rewrites no body without an integer beyond 2^53, nor a 400's", async () => {
    const spaced = '{ "value": 12, "list": [ 1, 2 ] }'
    const big = '{"v":12345678901234567890}'
    const { http } = httpOf([
      textAnswer(spaced, 200, "application/json"),
      textAnswer(big, 400, "application/json"),
    ])
    const fetch = http.asFetch({ intentOf: () => "read", integers: "string" })
    expect(await (await fetch(`${ROOT}/x`)).text()).toBe(spaced)
    expect(await (await fetch(`${ROOT}/x`)).text()).toBe(big)
  })

  it("answers an announced length of exactly the cap, and fails one above it without a body", async () => {
    const at = new Response("x".repeat(10), { headers: { "Content-Length": "10" } })
    expect((await readBody(at, 10, new AbortController().signal))?.byteLength).toBe(10)
    const empty = new Response(null, { headers: { "Content-Length": "11" } })
    expect(await readBody(empty, 10, new AbortController().signal)).toBeUndefined()
  })

  it("stops listening to the deadline once the body is read", async () => {
    const deadline = new AbortController()
    await readBody(new Response("{}"), 10, deadline.signal)
    expect(getEventListeners(deadline.signal, "abort")).toHaveLength(0)
  })

  it("cancels a body the deadline cut", async () => {
    let cancelled = false
    const body = new ReadableStream({
      pull: () => new Promise<void>(() => undefined),
      cancel: () => {
        cancelled = true
      },
    })
    const deadline = new AbortController()
    const reading = readBody(new Response(body), 10, deadline.signal)
    deadline.abort()
    await expect(reading).rejects.toThrow("aborted")
    expect(cancelled).toBe(true)
  })

  it("decodes the charset however the Content-Type spaces and quotes it", () => {
    const latin1 = Uint8Array.from([0x68, 0xe9])
    for (const contentType of [
      "text/plain;charset=ISO-8859-1",
      "text/plain; charset = ISO-8859-1",
      'text/plain;charset="ISO-8859-1"',
    ]) {
      expect(decodeText({ body: latin1, contentType }), contentType).toBe("hé")
    }
    expect(mediaTypeOf("Text/XML ; charset=UTF-8")).toBe("text/xml")
  })
})

describe("the edges of the rules", () => {
  it("refuses a root with a password alone or a user alone", () => {
    expect(() => rootOf("http://:secret@h/x")).toThrow("credentials")
    expect(() => rootOf("http://user@h/x")).toThrow("credentials")
  })

  it("strips a pasted Bearer prefix only at the start and with all its spaces", () => {
    expect(bearerToken("  Bearer   tok-demo-123 ")).toBe("tok-demo-123")
    expect(() => bearerToken("tokBearer x")).toThrow(CredentialError)
    expect(new CredentialError("token-syntax").name).toBe("CredentialError")
  })

  it("masks a whole JSON text when any secret is left outside its literals", () => {
    const forms = secretForms(["12345678", "other-secret"])
    expect(maskJsonText('{"code":12345678}', forms)).toBe('{"code":***}')
  })
})
