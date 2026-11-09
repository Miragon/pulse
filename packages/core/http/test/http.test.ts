import { describe, expect, it } from "vitest"
import {
  basicCredential,
  bearerCredential,
  callerToken,
  type Connection,
  createHttp,
  HttpFailure,
  type HttpRequest,
  noCredential,
  staticToken,
} from "../src/index.js"
import {
  failWith,
  jsonAnswer,
  networkError,
  platformOf,
  type Step,
  textAnswer,
} from "./fake-fetch.js"

const ROOT = "http://engine.test/engine-rest"
const GET: HttpRequest = { method: "GET", url: `${ROOT}/process-instance/pi-1`, intent: "read" }
const PUT: HttpRequest = {
  method: "PUT",
  url: `${ROOT}/process-instance/pi-1/variables/a`,
  intent: "write",
  body: '{"value":1}',
}

function httpOf(steps: readonly Step[], connection: Partial<Connection> = {}) {
  const fake = platformOf(steps)
  const http = createHttp(
    { url: `${ROOT}/`, credential: noCredential, timeoutMs: 1_000, ...connection },
    fake.platform,
  )
  return { http, ...fake }
}

async function failureOf(promise: Promise<unknown>): Promise<HttpFailure> {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  expect(error).toBeInstanceOf(HttpFailure)
  return error as HttpFailure
}

describe("createHttp", () => {
  it("normalizes the root", () => {
    expect(httpOf([]).http.root).toBe(ROOT)
  })

  it.each([
    [{ timeoutMs: 0 }, "timeoutMs"],
    [{ timeoutMs: 1.5 }, "timeoutMs"],
    [{ timeoutMs: 2_147_483_648 }, "timeoutMs"],
    [{ maxAnswerBytes: 0 }, "maxAnswerBytes"],
    [{ maxAnswerBytes: 1.5 }, "maxAnswerBytes"],
    [{ maxAnswerBytes: Number.NaN }, "maxAnswerBytes"],
    [{ url: "http://u:secret@h/x" }, "credentials"],
  ])("refuses %j", (connection, why) => {
    expect(() => httpOf([], connection)).toThrow(RangeError)
    expect(() => httpOf([], connection)).toThrow(why)
  })

  it("takes an unlimited cap", async () => {
    const { http } = httpOf([textAnswer("x".repeat(100))], { maxAnswerBytes: Infinity })
    expect((await http.send(GET)).body.byteLength).toBe(100)
  })
})

describe("send", () => {
  it("never follows a redirect and fills the reason phrase Tomcat leaves out", async () => {
    const { http, calls } = httpOf([new Response("{}", { status: 404, statusText: "" })])
    const answer = await http.send(GET)
    expect(calls[0]?.redirect).toBe("manual")
    expect(answer).toMatchObject({ status: 404, statusText: "Not Found" })
  })

  it("merges the headers: the connection's, the request's, the credential's, the user agent", async () => {
    const { http, calls } = httpOf([jsonAnswer({})], {
      headers: { "X-Team": "ops", "X-Mode": "default" },
      credential: basicCredential("demo", "demo"),
      userAgent: "pulse-test/1",
    })
    await http.send({ ...GET, headers: { "x-mode": "mine", Authorization: "Bearer mine" } })
    expect(calls[0]?.headers).toEqual({
      authorization: "Basic ZGVtbzpkZW1v",
      "user-agent": "pulse-test/1",
      "x-mode": "mine",
      "x-team": "ops",
    })
  })

  it("keeps a user agent the request names itself", async () => {
    const { http, calls } = httpOf([jsonAnswer({})], { userAgent: "pulse-test/1" })
    await http.send({ ...GET, headers: { "User-Agent": "own/2" } })
    expect(calls[0]?.headers["user-agent"]).toBe("own/2")
  })

  it("sends a body as given", async () => {
    const { http, calls } = httpOf([new Response(null, { status: 204 })])
    expect((await http.send(PUT)).status).toBe(204)
    expect(calls[0]).toMatchObject({ method: "PUT", body: '{"value":1}' })
  })

  it.each([
    [{ ...GET, method: "G E T" }, "method"],
    [{ ...GET, url: "http://other.test/engine-rest/x" }, "outside-root"],
    [{ ...GET, url: `${ROOT}/process-instance/.` }, "dot-segment"],
    [{ ...GET, url: `${ROOT}/process-instance//variables` }, "empty-segment"],
    [{ ...GET, url: "no url" }, "not-a-url"],
    [{ ...GET, body: "{}" }, "body"],
    [{ ...GET, method: "HEAD", body: "{}" }, "body"],
    [{ ...GET, headers: { "X-Bad": "a\nb" } }, "header"],
  ])("refuses %j before sending (%s)", async (request, code) => {
    const { http, calls } = httpOf([jsonAnswer({})])
    const failure = await failureOf(http.send(request))
    expect(failure).toMatchObject({ reason: "invalid-request", code, mayHaveApplied: false })
    expect(calls).toHaveLength(0)
  })

  it("refuses a write on a read-only connection, and sends a read and a reading POST", async () => {
    const { http, calls } = httpOf([jsonAnswer([])], { readOnly: true })
    const failure = await failureOf(http.send(PUT))
    expect(failure).toMatchObject({ reason: "refused-write", mayHaveApplied: false })
    expect(failure.message).toBe(
      `PUT ${ROOT}/process-instance/pi-1/variables/a: refused: the connection only reads`,
    )
    await http.send(GET)
    await http.send({ method: "POST", url: `${ROOT}/process-instance`, intent: "read", body: "{}" })
    expect(calls.map((call) => call.method)).toEqual(["GET", "POST"])
  })

  it("refuses a token with a line break inside without sending or echoing it", async () => {
    const { http, calls } = httpOf([jsonAnswer({})], {
      credential: bearerCredential(callerToken(() => "tok-demo\n123")),
    })
    const failure = await failureOf(http.send(GET))
    expect(failure).toMatchObject({ reason: "credential", code: "token-syntax" })
    expect(failure.message).not.toContain("tok-demo")
    expect(calls).toHaveLength(0)
  })

  it("lets another error of the credential through", async () => {
    const broken = {
      ...noCredential,
      authorization: () => Promise.reject(new Error("store locked")),
    }
    const { http } = httpOf([jsonAnswer({})], { credential: broken })
    await expect(http.send(GET)).rejects.toThrow("store locked")
  })
})

describe("a redirect", () => {
  it("fails, names where it pointed without the query, and applied nothing", async () => {
    const location = "https://sso.test/realms/ops/auth?client_id=engine&state=4711"
    const { http } = httpOf([new Response(null, { status: 302, headers: { Location: location } })])
    const failure = await failureOf(http.send(PUT))
    expect(failure).toMatchObject({
      reason: "redirect",
      status: 302,
      location: "https://sso.test/realms/ops/auth",
      mayHaveApplied: false,
    })
    expect(failure.message).toContain("redirects are never followed: point the URL at the API root")
    expect(failure.message).not.toContain("state=4711")
  })

  it("resolves a relative Location, masks it and cuts it after 200 characters", async () => {
    const long = `/${"a".repeat(300)}/tok-demo-123`
    const { http } = httpOf([new Response(null, { status: 307, headers: { Location: long } })], {
      credential: bearerCredential(staticToken("tok-demo-123")),
    })
    const failure = await failureOf(http.send(GET))
    const origin = "http://engine.test/"
    expect(failure.location).toBe(`${origin}${"a".repeat(200 - origin.length)}…`)
    const short = httpOf(
      [new Response(null, { status: 301, headers: { Location: "/x/tok-demo-123" } })],
      {
        credential: bearerCredential(staticToken("tok-demo-123")),
      },
    )
    expect((await failureOf(short.http.send(GET))).location).toBe("http://engine.test/x/***")
  })

  it("is a redirect without a target when the Location is missing or does not parse", async () => {
    const credential = basicCredential("demo", "demo-secret")
    for (const headers of [{}, { Location: "http://[" }]) {
      for (const connection of [{}, { credential }]) {
        const { http } = httpOf([new Response(null, { status: 302, headers })], connection)
        const failure = await failureOf(http.send(GET))
        expect(failure).toMatchObject({ reason: "redirect", location: undefined })
        expect(failure.message).toContain(": 302 redirect: redirects are never followed")
      }
    }
  })

  it("is a redirect when a browser's fetch hides it (opaqueredirect)", async () => {
    const opaque = Object.defineProperty(new Response(null), "type", { value: "opaqueredirect" })
    const { http } = httpOf([() => opaque])
    expect((await failureOf(http.send(GET))).reason).toBe("redirect")
  })
})

describe("a failed connection", () => {
  it.each([
    ["ECONNREFUSED", "unreachable", false],
    ["ENOTFOUND", "dns", false],
    ["DEPTH_ZERO_SELF_SIGNED_CERT", "tls", false],
    ["UND_ERR_INVALID_ARG", "invalid-request", false],
    ["ECONNRESET", "connection", true],
  ])("%s is %s; a write may have applied: %s", async (code, reason, applied) => {
    const { http } = httpOf([failWith(networkError(code))])
    const write = await failureOf(http.send(PUT))
    expect(write).toMatchObject({ reason, code, mayHaveApplied: applied })
    expect(write.message).toContain(`(${code})`)
    expect(write.cause).toBeInstanceOf(TypeError)
    const read = await failureOf(http.send(GET))
    expect(read).toMatchObject({ reason, mayHaveApplied: false })
  })

  it("is a broken connection when fetch throws something without a code", async () => {
    const { http } = httpOf([failWith(new Error("other"))])
    const failure = await failureOf(http.send(PUT))
    expect(failure).toMatchObject({ reason: "connection", code: undefined, mayHaveApplied: true })
    expect(failure.message).toBe(
      `PUT ${ROOT}/process-instance/pi-1/variables/a: the connection failed; the write may have been applied, check the state before retrying`,
    )
  })

  it("passes a failure a nested transport threw through", async () => {
    const inner = new HttpFailure("dns", { method: "GET", target: "x", mayHaveApplied: false })
    const { http } = httpOf([failWith(inner)])
    expect(await failureOf(http.send(GET))).toBe(inner)
  })
})
