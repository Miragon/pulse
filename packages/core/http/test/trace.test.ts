/**
 * The trace: one event per attempt and answer, the headers as their callers wrote them, and no
 * secret in it unless the platform reveals the secrets (owner decision 2026-11-10: only the CLI's
 * `--show-secrets` asks for that).
 */
import fc from "fast-check"
import { describe, expect, it, vi } from "vitest"
import {
  basicCredential,
  bearerCredential,
  type Connection,
  createHttp,
  HttpFailure,
  type HttpRequest,
  noCredential,
  type Platform,
  staticToken,
  type TraceEvent,
} from "../src/index.js"
import { jsonAnswer, networkError, platformOf, type Step } from "./fake-fetch.js"

const ROOT = "http://engine.test/engine-rest"
const GET: HttpRequest = { method: "GET", url: `${ROOT}/process-instance/pi-1`, intent: "read" }

/** The request events of one GET over `connection`, the platform revealing secrets or not. */
async function eventsOf(
  connection: Partial<Connection>,
  request: Partial<HttpRequest> = {},
  platform: Partial<Platform> = {},
): Promise<TraceEvent[]> {
  const fake = platformOf([jsonAnswer({}, 200)])
  const http = createHttp(
    { url: ROOT, credential: noCredential, timeoutMs: 1_000, ...connection },
    { ...fake.platform, ...platform },
  )
  await http.send({ ...GET, ...request })
  return fake.events
}

const KEYED: Partial<Connection> = {
  credential: basicCredential("demo", "demo-secret"),
  headers: { "X-Api-Key": "key-4711", Cookie: "s=1" },
  secretHeaders: ["x-api-key"],
}

describe("a trace by default", () => {
  it("names each request and answer, the secret headers without their values", async () => {
    const events = await eventsOf(KEYED, { url: `${GET.url}?token=key-4711` })
    expect(events).toEqual([
      {
        type: "request",
        method: "GET",
        url: `${GET.url}?token=***`,
        headers: { "X-Api-Key": "***", Cookie: "***", Authorization: "Basic ***" },
        secretHeaders: ["x-api-key", "cookie", "authorization"],
      },
      {
        type: "response",
        status: 200,
        statusText: "OK",
        durationMs: expect.any(Number) as number,
        bytes: 2,
      },
    ])
  })

  it("keeps the scheme word of an Authorization and a Proxy-Authorization only", async () => {
    const [event] = await eventsOf(
      { credential: bearerCredential(staticToken("tok-demo-123")) },
      { headers: { "Proxy-Authorization": "Basic cHJveHk6cHc=", Cookie: "Bearer s=1" } },
    )
    expect(event).toMatchObject({
      headers: {
        "Proxy-Authorization": "Basic ***",
        Cookie: "***",
        Authorization: "Bearer ***",
      },
    })
    const [bare] = await eventsOf({ headers: { Authorization: "tok-without-scheme" } })
    expect(bare).toMatchObject({ headers: { Authorization: "***" } })
    const [spaced] = await eventsOf({
      headers: { Authorization: "Basic  ZGVtbw==", "Proxy-Authorization": " Basic cHc=" },
    })
    expect(spaced).toMatchObject({
      headers: { Authorization: "Basic  ***", "Proxy-Authorization": "***" },
    })
  })

  it("masks a secret another header carries", async () => {
    const [event] = await eventsOf(
      { credential: basicCredential("demo", "demo-secret") },
      { headers: { "X-Note": "pw demo-secret" } },
    )
    expect(event).toMatchObject({ headers: { "X-Note": "pw ***" } })
  })

  it("shows no secret of a request, whatever it is", async () => {
    const secret = fc.stringMatching(/^[A-Za-z0-9\-._~+/]{4,24}$/).map((s) => `Qz${s}`)
    await fc.assert(
      fc.asyncProperty(secret, async (value) => {
        const events = await eventsOf(
          {
            credential: bearerCredential(staticToken(value)),
            headers: { "X-Key": value },
            secretHeaders: ["x-key"],
          },
          { url: `${GET.url}?key=${value}`, headers: { "X-Note": `sent ${value}` } },
          { revealSecrets: false },
        )
        expect(JSON.stringify(events)).not.toContain(value)
      }),
      { numRuns: 30 },
    )
  })
})

describe("a trace that reveals the secrets", () => {
  it("shows the request as sent: every header's value and the URL", async () => {
    const [event] = await eventsOf(
      KEYED,
      { url: `${GET.url}?token=key-4711`, headers: { "X-Note": "pw demo-secret" } },
      { revealSecrets: true },
    )
    expect(event).toEqual({
      type: "request",
      method: "GET",
      url: `${GET.url}?token=key-4711`,
      headers: {
        "X-Api-Key": "key-4711",
        Cookie: "s=1",
        "X-Note": "pw demo-secret",
        Authorization: "Basic ZGVtbzpkZW1vLXNlY3JldA==",
      },
      secretHeaders: ["x-api-key", "cookie", "authorization"],
    })
  })

  it("leaves the error answers masked", async () => {
    const fake = platformOf([new Response("pw demo-secret", { status: 500 })])
    const http = createHttp(
      { url: ROOT, credential: basicCredential("demo", "demo-secret"), timeoutMs: 1_000 },
      { ...fake.platform, revealSecrets: true },
    )
    const answer = await http.send(GET)
    expect(new TextDecoder().decode(answer.body)).toBe("pw ***")
  })
})

describe("the headers of a trace", () => {
  it("keep their callers' spelling and order: connection, request, credential, User-Agent", async () => {
    const [event] = await eventsOf(
      {
        credential: basicCredential("demo", "demo-secret"),
        headers: { "X-Tenant": "acme", accept: "*/*" },
        userAgent: "pulse-test/1",
      },
      { headers: { Accept: "application/json", "content-type": "application/json" } },
    )
    expect(Object.entries(event?.type === "request" ? event.headers : {})).toEqual([
      ["X-Tenant", "acme"],
      ["Accept", "application/json"],
      ["content-type", "application/json"],
      ["Authorization", "Basic ***"],
      ["User-Agent", "pulse-test/1"],
    ])
  })

  it("let a later header replace an earlier one of any case, at the end", async () => {
    const [event] = await eventsOf(
      { credential: basicCredential("demo", "demo-secret") },
      { headers: { authorization: "Bearer from-the-caller", Accept: "application/json" } },
      { revealSecrets: true },
    )
    expect(Object.entries(event?.type === "request" ? event.headers : {})).toEqual([
      ["Accept", "application/json"],
      ["Authorization", "Basic ZGVtbzpkZW1vLXNlY3JldA=="],
    ])
  })

  it("keep a User-Agent of the request over the connection's", async () => {
    const [event] = await eventsOf(
      { userAgent: "pulse-test/1" },
      { headers: { "user-agent": "caller/2" } },
    )
    expect(event).toMatchObject({ headers: { "user-agent": "caller/2" } })
    expect(JSON.stringify(event)).not.toContain("pulse-test/1")
  })
})

describe("the answers of a trace", () => {
  const BASIC = basicCredential("demo", "demo-secret")

  /** The events of one GET whose answer is `step`, the platform revealing the secrets. */
  async function answeredBy(step: Step): Promise<TraceEvent[]> {
    const fake = platformOf([step])
    const http = createHttp(
      { url: ROOT, credential: BASIC, timeoutMs: 1_000 },
      { ...fake.platform, revealSecrets: true },
    )
    await http.send(GET).catch((error: unknown) => {
      expect(error).toBeInstanceOf(HttpFailure)
    })
    return fake.events
  }

  it("name a redirect: its reason phrase masked, as a failure's text, and no size", async () => {
    const moved = await answeredBy(
      new Response(null, { status: 302, statusText: "Moved for demo-secret" }),
    )
    expect(moved[1]).toEqual({
      type: "response",
      status: 302,
      statusText: "Moved for ***",
      durationMs: expect.any(Number) as number,
    })
    const [, bare] = await answeredBy(new Response(null, { status: 307 }))
    expect(bare).toMatchObject({ status: 307, statusText: "Temporary Redirect" })
    expect(bare).not.toHaveProperty("bytes")
  })

  it("count the bytes the server sent, before the mask", async () => {
    const [, echoed] = await answeredBy(new Response("pw demo-secret", { status: 500 }))
    expect(echoed).toMatchObject({ status: 500, bytes: 14 })
  })

  it("read the clock only for a trace: once per attempt without one", async () => {
    const fake = platformOf([jsonAnswer({}), new Response(null, { status: 302 })])
    const now = vi.fn(() => 0)
    const http = createHttp(
      { url: ROOT, credential: BASIC, timeoutMs: 1_000 },
      { fetch: fake.platform.fetch, now },
    )
    await http.send(GET)
    await expect(http.send(GET)).rejects.toBeInstanceOf(HttpFailure)
    expect(now).toHaveBeenCalledTimes(2)
  })

  it("change nothing when the trace throws: the answer or the failure stands", async () => {
    const steps = [jsonAnswer({ id: 1 }), new Response(null, { status: 302 })]
    const fake = platformOf([...steps, () => Promise.reject(networkError("ECONNREFUSED"))])
    const watched = vi.fn(() => {
      throw new Error("trace broke")
    })
    const http = createHttp(
      { url: ROOT, credential: BASIC, timeoutMs: 1_000 },
      { ...fake.platform, trace: watched },
    )
    const POST: HttpRequest = { method: "POST", url: `${ROOT}/message`, intent: "write" }
    expect((await http.send(POST)).status).toBe(200)
    await expect(http.send(POST)).rejects.toMatchObject({ reason: "redirect" })
    await expect(http.send(POST)).rejects.toMatchObject({ reason: "unreachable" })
    expect(watched).toHaveBeenCalledTimes(5)
  })
})
