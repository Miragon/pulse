import {
  type CamundaFailure,
  type CamundaTokenProblem,
  type CamundaTokenTrouble,
  type CamundaTransportReason,
  UnexpectedAnswerError,
} from "@miragon/pulse-c8-core"
import type { FailureReason } from "@miragon/pulse-http"
import type { AnswerProblem, TokenFailureKind } from "@miragon/pulse-http/oauth"
import type { EngineCredentials } from "@miragon/pulse-runtime-view/ports"
import { describe, expect, expectTypeOf, test } from "vitest"
import { CamundaHttp } from "../../src/rest/camunda-http.js"
import { CamundaRequestError } from "../../src/rest/camunda-request-error.js"
import { CamundaWire } from "../../src/wire/camunda-wire.js"
import { ClientCredentialsSources } from "../../src/wire/client-credentials-sources.js"
import type { WirePlatform } from "../../src/wire/wire-platform.js"
import {
  clientWith,
  jsonAnswer,
  NONE,
  problem,
  REST_URL,
  TOPOLOGY,
} from "../support/fake-camunda-rest.js"
import { CREDENTIALS, TOKEN_URL } from "../support/token-endpoint.js"

const XML = '<?xml version="1.0"?><bpmn:definitions id="d"/>'

const ABOVE_THE_CAP = String(64 * 1024 * 1024 + 1)

const NOTHING: typeof fetch = () => Promise.reject(new Error("the wire sent a request"))

const REFUSED = Object.assign(new TypeError("fetch failed"), {
  cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
})

interface Wiring {
  readonly send: typeof fetch
  readonly credentials?: EngineCredentials
  readonly endpoint?: string
}

function httpOf({ send, credentials = NONE, endpoint = REST_URL }: Wiring): CamundaHttp {
  const platform: WirePlatform = { send, now: () => 1_000_000 }
  const sources = new ClientCredentialsSources(platform)
  return new CamundaHttp(CamundaWire.of({ endpoint, credentials }, sources, platform))
}

async function failureOf(http: CamundaHttp, path = "/topology"): Promise<CamundaFailure> {
  const error = await http.get(path).then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  expect(error).toBeInstanceOf(CamundaRequestError)
  const failure = http.failure(error)
  if (failure === undefined) {
    throw new Error("the wire copied no fields")
  }
  return failure
}

function answering(answer: Response): typeof fetch {
  return () => Promise.resolve(answer.clone())
}

function refusingTheClient(input: string | URL | Request): Promise<Response> {
  const url = input instanceof Request ? input.url : String(input)
  return Promise.resolve(
    url.startsWith(TOKEN_URL)
      ? jsonAnswer({ error: "invalid_client" }, 401)
      : jsonAnswer({ gatewayVersion: "8.10.8" }),
  )
}

describe("the wire as the transport of the REST client", () => {
  test("reads JSON without a login and never follows a redirect", async () => {
    const { camunda, client } = clientWith([TOPOLOGY])

    expect(await client.topology()).toEqual({ gatewayVersion: "8.10.8" })
    expect(camunda.requests).toEqual([
      expect.objectContaining({
        route: "GET /topology",
        accept: "application/json",
        authorization: null,
        redirect: "manual",
      }),
    ])
  })

  test("asks for a diagram as XML, or the JSON of a problem", async () => {
    const { camunda, client } = clientWith([
      {
        route: "GET /process-definitions/1/xml",
        answer: new Response(XML, { headers: { "Content-Type": "text/xml" } }),
      },
    ])

    expect(await client.diagramXml("1")).toBe(XML)
    expect(camunda.requests[0]?.accept).toBe("text/xml, application/json")
  })

  test("fails a 404 that names no missing resource with its status and title", async () => {
    const { client } = clientWith([])

    const read = client.definition("1")

    await expect(read).rejects.toBeInstanceOf(CamundaRequestError)
    await expect(read).rejects.toMatchObject({
      fields: { kind: "answered", status: 404, title: "Not Found" },
    })
  })

  test("reads an answer that is no JSON as unexpected", async () => {
    const { client } = clientWith([
      {
        route: "POST /process-definitions/search",
        answer: new Response("<html>gateway</html>", { headers: { "Content-Type": "text/html" } }),
      },
    ])

    await expect(client.latestDefinitions()).rejects.toMatchObject({
      name: "UnexpectedAnswerError",
      message: expect.stringContaining("the cluster answered no JSON") as unknown,
    })
  })

  test("reads a key it refuses as a path value as none, sending nothing", async () => {
    const { camunda, client } = clientWith([])

    expect(await client.instance(".")).toBeUndefined()
    expect(await client.instance("..")).toBeUndefined()
    expect(camunda.requests).toEqual([])
  })
})

describe("the fields the wire copies for the REST client", () => {
  test.each<[string, Wiring, string, CamundaFailure]>([
    [
      "an error answer, with its title and what it states",
      { send: answering(problem(403, "Forbidden", "No secondary storage")) },
      "/topology",
      {
        kind: "answered",
        status: 403,
        title: "Forbidden",
        detail: "No secondary storage",
        redirect: false,
      },
    ],
    [
      "an error answer that states nothing",
      {
        send: answering(
          new Response("<html />", { status: 502, headers: { "Content-Type": "text/html" } }),
        ),
      },
      "/topology",
      { kind: "answered", status: 502, title: undefined, detail: undefined, redirect: false },
    ],
    [
      "an error answer whose JSON is no object",
      {
        send: answering(
          new Response("[1]", { status: 500, headers: { "Content-Type": "application/json" } }),
        ),
      },
      "/topology",
      { kind: "answered", status: 500, title: undefined, detail: undefined, redirect: false },
    ],
    [
      "a redirect",
      { send: answering(new Response("", { status: 302, headers: { Location: "/login" } })) },
      "/topology",
      { kind: "answered", status: 302, title: undefined, detail: undefined, redirect: true },
    ],
    [
      "an answer above its cap",
      { send: answering(new Response("{}", { headers: { "Content-Length": ABOVE_THE_CAP } })) },
      "/topology",
      { kind: "transport", reason: "too-large", code: undefined },
    ],
    [
      "a path value it refuses",
      { send: NOTHING },
      "/process-instances/.",
      { kind: "transport", reason: "invalid-request", code: "dot-segment" },
    ],
    [
      "a cluster it cannot reach",
      { send: () => Promise.reject(REFUSED) },
      "/topology",
      { kind: "transport", reason: "unreachable", code: "ECONNREFUSED" },
    ],
    [
      "a login it cannot send",
      { send: NOTHING, credentials: { kind: "basic", username: "de:mo", password: "s3cret" } },
      "/topology",
      { kind: "transport", reason: "credential", code: "user-colon" },
    ],
    [
      "a cluster URL it cannot use",
      { send: NOTHING, endpoint: "camunda.test" },
      "/topology",
      { kind: "transport", reason: "invalid-request", code: undefined },
    ],
    [
      "a token it gets none for",
      { send: refusingTheClient, credentials: CREDENTIALS },
      "/topology",
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
  ])("as the port carries them: %s", async (_name, wiring, path, fields) => {
    expect(await failureOf(httpOf(wiring), path)).toEqual(fields)
  })

  test("copy nothing from an answer it could not read or from any other error", async () => {
    const http = httpOf({ send: answering(new Response("<html />")) })

    const error = await http.get("/topology").then(
      () => undefined,
      (thrown: unknown) => thrown,
    )

    expect(error).toBeInstanceOf(UnexpectedAnswerError)
    expect(http.failure(error)).toBeUndefined()
    expect(http.failure(new Error("broken"))).toBeUndefined()
  })

  test("hold the reasons and troubles of the port equal to the transport's", () => {
    expectTypeOf<CamundaTransportReason>().toEqualTypeOf<FailureReason>()
    expectTypeOf<CamundaTokenTrouble>().toEqualTypeOf<TokenFailureKind>()
    expectTypeOf<CamundaTokenProblem>().toEqualTypeOf<AnswerProblem>()
  })
})
