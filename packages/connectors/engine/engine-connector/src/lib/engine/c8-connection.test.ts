import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import type { CamundaFailure } from "@miragon/pulse-c8-core"
import { HttpFailure } from "@miragon/pulse-http"
import { TokenFailure } from "@miragon/pulse-http/oauth"
import { type C8Auth, createC8Connection, UnusableTokenEndpointError } from "./c8-connection.js"
import { USER_AGENT } from "./user-agent.js"
import {
  type Answer,
  type C8Platform,
  c8Platform,
  CLUSTER,
  hang,
  json,
  problem,
  refused,
  token,
  TOKEN_ENDPOINT,
} from "./test-support/c8-platform.js"

/** The engine module's own manifest: the User-Agent names it. */
const { name, version } = JSON.parse(
  readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
) as { name: string; version: string }

/**
 * The server's wire to a Camunda 8 cluster (c8-connection.ts) over a `fetch` of its own: what
 * each request sends, every request a read with lossless JSON and the caller's signal, the fields
 * it copies of a failure for c8-core (an answer always as answered, never as a transport reason)
 * and the secrets it masks in them. The words the model reads are c8-errors.test.ts's, the
 * outcomes on real sockets transport-cases.c8.test.ts's.
 */

const CLIENT: C8Auth = {
  type: "clientCredentials",
  tokenEndpoint: TOKEN_ENDPOINT,
  clientId: "pulse-reader",
  clientSecret: "reader-secret-42",
  audience: "camunda",
  scopes: ["read", "audit"],
}

const TOPOLOGY = { gatewayVersion: "8.10.9", brokers: [] }

function connect(answers: Readonly<Record<string, Answer>>, auth: C8Auth = { type: "none" }) {
  const platform = c8Platform(answers)
  const connection = createC8Connection({ id: "c8", baseUrl: CLUSTER }, auth, {}, platform)
  return { platform, connection }
}

/** What the transport rejected `read` with. */
async function rejection(read: Promise<unknown>): Promise<unknown> {
  try {
    await read
  } catch (error) {
    return error
  }
  throw new Error("the read did not fail")
}

const sent = (platform: C8Platform) =>
  platform.sent.map(({ method, path, body }) => `${method} ${path}${body ? ` ${body}` : ""}`)

describe("the requests of the server's Camunda 8 wire", () => {
  it("reads below the REST root: a GET, a search as a POST that reads, a diagram as text", async () => {
    const { platform, connection } = connect({
      "GET /v2/topology": () => json(TOPOLOGY),
      "POST /v2/process-instances/search": () => json({ items: [], page: { totalItems: 0 } }),
      "GET /v2/process-definitions/2251799813685249/xml": () =>
        new Response("<definitions/>", { headers: { "Content-Type": "text/xml" } }),
    })
    const transport = connection.transport()
    expect(await transport.get("/topology")).toEqual(TOPOLOGY)
    expect(await transport.post("/process-instances/search", { filter: {} })).toEqual({
      items: [],
      page: { totalItems: 0 },
    })
    expect(await transport.text("/process-definitions/2251799813685249/xml")).toBe("<definitions/>")
    expect(sent(platform)).toEqual([
      "GET /v2/topology",
      'POST /v2/process-instances/search {"filter":{}}',
      "GET /v2/process-definitions/2251799813685249/xml",
    ])
    // The engine module's own name and version, which release-please keeps in lockstep: a
    // cluster never reads the name of the Camunda 7 SDK's client.
    expect(USER_AGENT).toBe(`${name}/${version}`)
    const headers = platform.sent.map((request) => [
      request.headers.get("accept"),
      request.headers.get("content-type"),
      request.headers.get("user-agent"),
    ])
    expect(headers).toEqual([
      ["application/json", null, USER_AGENT],
      ["application/json", "application/json", USER_AGENT],
      ["text/xml, application/json", null, USER_AGENT],
    ])
  })

  it("keeps the digits of a key beyond 2^53", async () => {
    const { connection } = connect({
      "GET /v2/process-instances/9007199254740993": () =>
        new Response('{"processInstanceKey":9007199254740993}', {
          headers: { "Content-Type": "application/json" },
        }),
    })
    expect(await connection.transport().get("/process-instances/9007199254740993")).toEqual({
      processInstanceKey: "9007199254740993",
    })
  })

  it("signs in with Basic, or with one token of the client credentials grant for every read", async () => {
    const basic = connect(
      { "GET /v2/topology": () => json(TOPOLOGY) },
      {
        type: "basic",
        username: "demo",
        password: "demo-secret",
      },
    )
    await basic.connection.transport().get("/topology")
    expect(basic.platform.sent[0]?.headers.get("authorization")).toBe(
      `Basic ${Buffer.from("demo:demo-secret").toString("base64")}`,
    )

    const client = connect(
      {
        "POST /realms/pulse/token": () => token("tok-cluster-1"),
        "GET /v2/topology": () => json(TOPOLOGY),
      },
      CLIENT,
    )
    await client.connection.transport().get("/topology")
    await client.connection.transport().get("/topology")
    expect(sent(client.platform)).toEqual([
      "POST /realms/pulse/token grant_type=client_credentials&audience=camunda&scope=read+audit&client_id=pulse-reader&client_secret=reader-secret-42",
      "GET /v2/topology",
      "GET /v2/topology",
    ])
    expect(client.platform.sent.slice(1).map((r) => r.headers.get("authorization"))).toEqual([
      "Bearer tok-cluster-1",
      "Bearer tok-cluster-1",
    ])
  })

  it("asks again for a token on the platform's clock once the hold of a refusal ends", async () => {
    let answer = () => json({ error: "invalid_client" }, 401)
    const { platform, connection } = connect(
      {
        "POST /realms/pulse/token": () => answer(),
        "GET /v2/topology": () => json(TOPOLOGY),
      },
      CLIENT,
    )
    const transport = connection.transport()
    expect(await rejection(transport.get("/topology"))).toBeInstanceOf(TokenFailure)
    answer = () => token("tok-after-the-hold")
    platform.ms += 59_000
    expect(await rejection(transport.get("/topology"))).toBeInstanceOf(TokenFailure)
    platform.ms += 2_000
    expect(await transport.get("/topology")).toEqual(TOPOLOGY)
    expect(sent(platform).filter((line) => line.startsWith("POST"))).toHaveLength(2)
  })

  it("aborts each read of a call with the caller's signal, and only that call's", async () => {
    const { platform, connection } = connect({
      "GET /v2/topology": hang,
      "GET /v2/incidents/1": () => json({ incidentKey: "1" }),
    })
    const leaving = new AbortController()
    const read = rejection(connection.transport(leaving.signal).get("/topology"))
    await new Promise((resolve) => setTimeout(resolve, 10))
    leaving.abort()
    const error = await read
    expect(error).toBeInstanceOf(HttpFailure)
    expect((error as HttpFailure).reason).toBe("cancelled")
    expect(await connection.transport().get("/incidents/1")).toEqual({ incidentKey: "1" })
    expect(platform.sent.map((request) => request.signal?.aborted)).toEqual([true, false])
  })

  it("ends a read at the profile's deadline", async () => {
    const platform = c8Platform({ "GET /v2/topology": hang })
    const connection = createC8Connection(
      { id: "c8", baseUrl: CLUSTER },
      { type: "none" },
      { timeoutMs: 30 },
      platform,
    )
    const error = await rejection(connection.transport().get("/topology"))
    expect(error).toMatchObject({ reason: "deadline", limit: 30 })
  })

  it("rejects with the transport's failure and the token source's as they are", async () => {
    const { connection } = connect({ "GET /v2/topology": () => problem(500, "INTERNAL", "boom") })
    expect(await rejection(connection.transport().get("/topology"))).toBeInstanceOf(HttpFailure)
    const client = connect({ "POST /realms/pulse/token": refused }, CLIENT)
    expect(await rejection(client.connection.transport().get("/topology"))).toBeInstanceOf(
      TokenFailure,
    )
  })

  it("fails the boot on a login it cannot send, naming the engine, never the value", () => {
    expect(() =>
      createC8Connection(
        { id: "c8", baseUrl: CLUSTER },
        { type: "basic", username: "de:mo", password: "demo-secret" },
      ),
    ).toThrow(/^Engine "c8" cannot send its credentials: its user name holds a colon/)
  })
})

describe("the fields the server's Camunda 8 wire copies for c8-core", () => {
  const ABOVE_THE_CAP = String(64 * 1024 * 1024 + 1)

  it.each<[string, Readonly<Record<string, Answer>>, string, C8Auth, CamundaFailure]>([
    [
      "an error answer, with its problem's title and what it states",
      { "GET /v2/topology": () => problem(403, "FORBIDDEN", "No secondary storage") },
      "/topology",
      { type: "none" },
      {
        kind: "answered",
        status: 403,
        title: "FORBIDDEN",
        detail: "No secondary storage",
        redirect: false,
      },
    ],
    [
      "a missing resource",
      {},
      "/process-instances/1",
      { type: "none" },
      {
        kind: "answered",
        status: 404,
        title: "NOT_FOUND",
        detail: "No route GET /v2/process-instances/1",
        redirect: false,
      },
    ],
    [
      "an error answer that states nothing",
      {
        "GET /v2/topology": () =>
          new Response("<html />", { status: 502, headers: { "Content-Type": "text/html" } }),
      },
      "/topology",
      { type: "none" },
      { kind: "answered", status: 502, title: undefined, detail: undefined, redirect: false },
    ],
    [
      "an error answer whose JSON is no object",
      {
        "GET /v2/topology": () =>
          new Response("[1]", { status: 500, headers: { "Content-Type": "application/json" } }),
      },
      "/topology",
      { type: "none" },
      { kind: "answered", status: 500, title: undefined, detail: undefined, redirect: false },
    ],
    [
      "a 401, as an answer",
      { "GET /v2/topology": () => new Response("", { status: 401 }) },
      "/topology",
      { type: "none" },
      { kind: "answered", status: 401, title: undefined, detail: undefined, redirect: false },
    ],
    [
      "a redirect, as an answer",
      {
        "GET /v2/topology": () =>
          new Response("", { status: 302, headers: { Location: "https://sso.c8.test/login" } }),
      },
      "/topology",
      { type: "none" },
      { kind: "answered", status: 302, title: undefined, detail: undefined, redirect: true },
    ],
    [
      "an answer above its cap",
      {
        "GET /v2/topology": () =>
          new Response("{}", { headers: { "Content-Length": ABOVE_THE_CAP } }),
      },
      "/topology",
      { type: "none" },
      { kind: "transport", reason: "too-large", code: undefined },
    ],
    [
      "an answer that is no JSON",
      { "GET /v2/topology": () => new Response("<html />") },
      "/topology",
      { type: "none" },
      { kind: "transport", reason: "invalid-answer", code: undefined },
    ],
    [
      "a path value it refuses",
      {},
      "/process-instances/.",
      { type: "none" },
      { kind: "transport", reason: "invalid-request", code: "dot-segment" },
    ],
    [
      "a cluster it cannot reach",
      { "GET /v2/topology": refused },
      "/topology",
      { type: "none" },
      { kind: "transport", reason: "unreachable", code: "ECONNREFUSED" },
    ],
    [
      "a token it gets none for",
      { "POST /realms/pulse/token": () => json({ error: "invalid_client" }, 401) },
      "/topology",
      CLIENT,
      {
        kind: "token",
        trouble: "client",
        status: 401,
        code: "invalid_client",
        problem: undefined,
        holdMs: 60_000,
        capBytes: undefined,
      },
    ],
    [
      "a token endpoint whose answer is above its cap",
      {
        "POST /realms/pulse/token": () =>
          new Response("{}", { headers: { "Content-Length": ABOVE_THE_CAP } }),
      },
      "/topology",
      CLIENT,
      {
        kind: "token",
        trouble: "too-large",
        status: 200,
        code: undefined,
        problem: undefined,
        holdMs: 60_000,
        capBytes: 1024 * 1024,
      },
    ],
    [
      "a token endpoint URL it cannot use",
      {},
      "/topology",
      { ...CLIENT, tokenEndpoint: "login.c8.test/token" },
      { kind: "transport", reason: "invalid-request", code: undefined },
    ],
  ])("%s", async (_name, answers, path, auth, fields) => {
    const { connection } = connect(answers, auth)
    const error = await rejection(connection.transport().get(path))
    expect(connection.failure(error)).toEqual(fields)
  })

  it("names an unusable token endpoint URL by its problem alone", async () => {
    const { connection } = connect({}, { ...CLIENT, tokenEndpoint: "login.c8.test/token" })
    const error = await rejection(connection.transport().text("/topology"))
    expect(error).toBeInstanceOf(UnusableTokenEndpointError)
    expect((error as Error).message).toBe("the authorization server URL is no absolute URL")
  })

  it("copies nothing of an error of another kind", () => {
    const { connection } = connect({})
    expect(connection.failure(new Error("a programming error"))).toBeUndefined()
    expect(connection.failure(new RangeError("Invalid time value"))).toBeUndefined()
  })
})

describe("the secrets the server's Camunda 8 wire masks", () => {
  it("masks the issued token and the client secret a cluster's answer echoes", async () => {
    const echo = "sent Bearer tok-cluster-1 for client_secret=reader-secret-42"
    const { connection } = connect(
      {
        "POST /realms/pulse/token": () => token("tok-cluster-1"),
        "GET /v2/topology": () => problem(500, `INTERNAL reader-secret-42`, echo),
      },
      CLIENT,
    )
    const error = await rejection(connection.transport().get("/topology"))
    const fields = connection.failure(error)
    expect(fields).toMatchObject({
      kind: "answered",
      title: "INTERNAL ***",
      detail: "sent Bearer *** for client_secret=***",
    })
    expect(JSON.stringify(fields)).not.toMatch(/tok-cluster-1|reader-secret-42/)
  })

  it("passes on a token endpoint's code as the token source masked the client secret", async () => {
    const { connection } = connect(
      { "POST /realms/pulse/token": () => json({ error: "bad_reader-secret-42" }, 400) },
      CLIENT,
    )
    const error = await rejection(connection.transport().get("/topology"))
    expect(connection.failure(error)).toMatchObject({ kind: "token", code: "bad_" })
  })
})
