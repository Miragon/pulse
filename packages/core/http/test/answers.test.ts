import { describe, expect, it } from "vitest"
import {
  basicCredential,
  bearerCredential,
  type Connection,
  createHttp,
  decodeText,
  HttpFailure,
  type HttpRequest,
  noCredential,
  staticToken,
  type TokenSource,
} from "../src/index.js"
import { jsonAnswer, platformOf, type Step, textAnswer } from "./fake-fetch.js"

const ROOT = "http://engine.test/engine-rest"
const GET: HttpRequest = { method: "GET", url: `${ROOT}/process-instance/pi-1`, intent: "read" }
const POST: HttpRequest = { method: "POST", url: `${ROOT}/message`, intent: "write", body: "{}" }

function httpOf(steps: readonly Step[], connection: Partial<Connection> = {}) {
  const fake = platformOf(steps)
  const http = createHttp(
    { url: ROOT, credential: noCredential, timeoutMs: 1_000, ...connection },
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

/** A token source that renews as often as asked, counting each 401. */
function renewing(tokens: string[]) {
  const rejected: string[] = []
  const source: TokenSource = {
    renewable: true,
    token: () => Promise.resolve(tokens[0]),
    rejected: (sent) => {
      rejected.push(sent)
      tokens.shift()
      return Promise.resolve(tokens.length > 0)
    },
  }
  return { credential: bearerCredential(source), rejected }
}

describe("call and json", () => {
  it("fail a status from 400 on with the problem the body states", async () => {
    const body = {
      type: "InvalidRequestException",
      message: "Process instance pi-1 does not exist",
    }
    const { http } = httpOf([jsonAnswer(body, 404)])
    const failure = await failureOf(http.call(GET))
    expect(failure).toMatchObject({
      reason: "status",
      status: 404,
      mayHaveApplied: false,
      problem: { type: "InvalidRequestException", message: "Process instance pi-1 does not exist" },
    })
    expect(failure.answer?.status).toBe(404)
    expect(failure.message).toBe(
      `GET ${ROOT}/process-instance/pi-1: 404 Not Found: InvalidRequestException: Process instance pi-1 does not exist`,
    )
    expect((await failureOf(http.json(GET))).reason).toBe("status")
  })

  it("fail a 401 as unauthorized", async () => {
    const { http } = httpOf([new Response(null, { status: 401 })])
    const failure = await failureOf(http.call(GET))
    expect(failure).toMatchObject({ reason: "unauthorized", status: 401, problem: {} })
    expect(failure.message).toBe(`GET ${ROOT}/process-instance/pi-1: 401 Unauthorized`)
  })

  it("cut the server's text in a message after 500 characters", async () => {
    const { http } = httpOf([textAnswer(`a\n${"x".repeat(600)}`, 500)])
    const failure = await failureOf(http.call(GET))
    expect(failure.message).toBe(
      `GET ${ROOT}/process-instance/pi-1: 500 Internal Server Error: a ${"x".repeat(498)}…`,
    )
    expect(failure.problem?.message).toHaveLength(602)
  })

  it("answer an answer below 400 as it came", async () => {
    const { http } = httpOf([textAnswer("<xml/>", 200, "text/xml")])
    expect(decodeText(await http.call(GET))).toBe("<xml/>")
  })

  it("read JSON with the integers the caller chooses, nothing for an empty body", async () => {
    const big = '{"value":9223372036854775807}'
    const { http } = httpOf([textAnswer(big, 200, "application/json")])
    expect(await http.json(GET, "string")).toEqual({ value: "9223372036854775807" })
    expect(await http.json(GET)).toEqual({ value: Number("9223372036854775807") })
    const empty = httpOf([new Response(null, { status: 204 })])
    expect(await empty.http.json(POST)).toBeUndefined()
  })

  it("fail a body that is no JSON as an invalid answer; a write's may have applied", async () => {
    const { http } = httpOf([textAnswer("<html>login</html>", 200, "text/html")])
    const read = await failureOf(http.json(GET))
    expect(read).toMatchObject({ reason: "invalid-answer", status: 200, mayHaveApplied: false })
    expect(read.message).toBe(`GET ${ROOT}/process-instance/pi-1: the answer is no valid JSON`)
    expect(await failureOf(http.json(POST))).toMatchObject({ mayHaveApplied: true })
  })
})

describe("after a 401", () => {
  it("sends once more with the renewed token, the same body, and answers the second", async () => {
    const { credential, rejected } = renewing(["tok-old-1", "tok-new-2"])
    const { http, calls } = httpOf(
      [new Response(null, { status: 401 }), jsonAnswer({ ok: true })],
      {
        credential,
      },
    )
    expect((await http.call(POST)).status).toBe(200)
    expect(calls.map((call) => [call.headers.authorization, call.body])).toEqual([
      ["Bearer tok-old-1", "{}"],
      ["Bearer tok-new-2", "{}"],
    ])
    expect(rejected).toEqual(["tok-old-1"])
  })

  it("sends exactly once more, however often the credential could renew", async () => {
    const { credential, rejected } = renewing(["t-111", "t-222", "t-333", "t-444"])
    const { http, calls } = httpOf([new Response(null, { status: 401 })], { credential })
    expect((await failureOf(http.call(GET))).reason).toBe("unauthorized")
    expect(calls).toHaveLength(2)
    expect(rejected).toEqual(["t-111"])
  })

  it("sends no second time when the credential did not renew", async () => {
    const { credential } = renewing(["only-one"])
    const { http, calls } = httpOf([new Response(null, { status: 401 })], { credential })
    expect((await http.send(GET)).status).toBe(401)
    expect(calls).toHaveLength(1)
  })

  it("never asks a credential that cannot renew, nor one that sent nothing", async () => {
    for (const credential of [basicCredential("demo", "demo"), noCredential]) {
      const { http, calls } = httpOf([new Response(null, { status: 401 })], { credential })
      expect((await http.send(GET)).status).toBe(401)
      expect(calls).toHaveLength(1)
    }
  })

  it("renews only after a 401, never after a 403", async () => {
    const { credential, rejected } = renewing(["a-111", "b-222"])
    const { http, calls } = httpOf([new Response(null, { status: 403 })], { credential })
    expect((await http.send(GET)).status).toBe(403)
    expect(calls).toHaveLength(1)
    expect(rejected).toEqual([])
  })
})

describe("an answer from 400 on shows no secret of its request", () => {
  const echo = (secret: string) => [
    new Response(JSON.stringify({ type: "X", message: `sent ${secret}`, n: 7 }), {
      status: 500,
      statusText: `bad ${secret}`,
      headers: { "Content-Type": "application/json", "X-Echo": secret },
    }),
  ]

  it("masks the body, the reason phrase and the headers, and keeps JSON JSON", async () => {
    const { http } = httpOf(echo("demo-secret"), {
      credential: basicCredential("demo", "demo-secret"),
    })
    const answer = await http.send(GET)
    expect(JSON.parse(decodeText(answer))).toEqual({ type: "X", message: "sent ***", n: 7 })
    expect(answer.statusText).toBe("bad ***")
    expect(answer.headers["x-echo"]).toBe("***")
    expect(answer.contentType).toBe("application/json; charset=utf-8")
  })

  it("masks a secret header's value the connection names", async () => {
    const { http } = httpOf(echo("key-4711"), {
      headers: { "X-Api-Key": "key-4711" },
      secretHeaders: ["X-API-KEY"],
    })
    expect(decodeText(await http.send(GET))).not.toContain("key-4711")
  })

  it("leaves an answer below 400 and a binary body alone", async () => {
    const ok = httpOf([jsonAnswer({ token: "tok-demo-123" })], {
      credential: bearerCredential(staticToken("tok-demo-123")),
    })
    expect(decodeText(await ok.http.send(GET))).toContain("tok-demo-123")
    const binary = new Response("tok-demo-123", {
      status: 500,
      headers: { "Content-Type": "application/octet-stream" },
    })
    const raw = httpOf([binary], { credential: bearerCredential(staticToken("tok-demo-123")) })
    expect(decodeText(await raw.http.send(GET))).toBe("tok-demo-123")
  })

  it("masks a body without a content type as text", async () => {
    const bytes = new TextEncoder().encode("pw demo-secret")
    const { http } = httpOf([new Response(bytes, { status: 400 })], {
      credential: basicCredential("demo", "demo-secret"),
    })
    const answer = await http.send(GET)
    expect(decodeText(answer)).toBe("pw ***")
    expect(answer.contentType).toBe("text/plain; charset=utf-8")
  })

  it("keeps an error answer without secrets as it came", async () => {
    const { http } = httpOf([textAnswer("pw demo-secret", 400)])
    expect(decodeText(await http.send(GET))).toBe("pw demo-secret")
  })
})

describe("a status without a reason phrase anywhere", () => {
  it("names the status alone", async () => {
    const { http } = httpOf([new Response(null, { status: 599 })])
    const failure = await failureOf(http.call(GET))
    expect(failure.message).toBe(`GET ${ROOT}/process-instance/pi-1: 599`)
  })
})

describe("a credential the connection's headers carry", () => {
  it("is masked whole and without its scheme word", async () => {
    const echo = new Response("sent tok-in-header-9 back", { status: 500 })
    const { http } = httpOf([echo], { headers: { Authorization: "Bearer tok-in-header-9" } })
    expect(decodeText(await http.send(GET))).toBe("sent *** back")
  })

  it("keeps an Authorization's scheme word, which is no secret, and masks a key whole", async () => {
    const echo = (text: string) => new Response(text, { status: 500 })
    const basic = httpOf([echo("sent Authorization: Basic ZGVtbzpkZW1vLXNlY3JldA== back")], {
      credential: basicCredential("demo", "demo-secret"),
    })
    expect(decodeText(await basic.http.send(GET))).toBe("sent Authorization: Basic *** back")
    const proxied = httpOf([echo("sent Proxy-Authorization: Basic cHJveHk6cHctNDcxMQ== back")], {
      headers: { "Proxy-Authorization": "Basic cHJveHk6cHctNDcxMQ==" },
    })
    expect(decodeText(await proxied.http.send(GET))).toBe(
      "sent Proxy-Authorization: Basic *** back",
    )
    const keyed = httpOf([echo("sent two words-4711 back")], {
      headers: { "X-Api-Key": "two words-4711" },
      secretHeaders: ["x-api-key"],
    })
    expect(decodeText(await keyed.http.send(GET))).toBe("sent *** back")
  })

  it("is refused before sending when its value cannot be a header", async () => {
    const { http } = httpOf([jsonAnswer({})], { headers: { Authorization: "Bearer a\nb-secret" } })
    const failure = await failureOf(http.send({ ...GET, method: "get" }))
    expect(failure).toMatchObject({ reason: "invalid-request", code: "header" })
    expect(failure.message).not.toContain("b-secret")
  })
})
