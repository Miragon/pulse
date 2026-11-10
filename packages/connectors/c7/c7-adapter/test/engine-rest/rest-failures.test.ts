import { InstanceId, RuntimeError } from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { C7Adapter } from "../../src/index.js"
import { engineFailure, fakeEngineRest, jsonAnswer, REST_URL } from "../support/fake-engine-rest.js"

const CONNECTION = { endpoint: REST_URL, credentials: { kind: "none" } } as const

function runtimeAnswering(answer: Response | (() => Promise<Response>)) {
  const send: typeof fetch = () =>
    typeof answer === "function" ? answer() : Promise.resolve(answer.clone())
  return new C7Adapter(send).runtime(CONNECTION)
}

async function failureOf(attempt: Promise<unknown>): Promise<string> {
  return attempt.then(
    () => "succeeded",
    (error: unknown) => (error instanceof RuntimeError ? error.failure : String(error)),
  )
}

describe("REST failures as runtime errors", () => {
  test.each([
    [
      "an engine that answers 401",
      engineFailure(401, "AuthenticationException", "no"),
      "unauthorized",
    ],
    ["an engine that answers 403", engineFailure(403, "AuthorizationException", "no"), "forbidden"],
    [
      "a redirect to a login page",
      new Response("", { status: 302, headers: { Location: "/login" } }),
      "misconfigured",
    ],
    [
      "a REST root without the engine",
      engineFailure(404, "NotFoundException", "no route"),
      "misconfigured",
    ],
    ["an engine exception", engineFailure(500, "ProcessEngineException", "boom"), "engineFailure"],
    [
      "a request the engine refuses",
      engineFailure(400, "InvalidRequestException", "no"),
      "engineFailure",
    ],
    ["an answer that is no JSON", jsonAnswer("not an object"), "unexpectedResponse"],
  ])("reads %s as %s", async (_name, answer, failure) => {
    expect(await failureOf(runtimeAnswering(answer).describeEngine())).toBe(failure)
  })

  test("reads an engine nobody answers for as unreachable", async () => {
    const refused = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    })
    const runtime = runtimeAnswering(() => Promise.reject(refused))
    expect(await failureOf(runtime.describeEngine())).toBe("unreachable")
  })

  test.each([
    ["a host name that does not resolve", "ENOTFOUND", "Check the host name in the engine URL."],
    [
      "a certificate the engine is not trusted with",
      "SELF_SIGNED_CERT_IN_CHAIN",
      "Check that this computer trusts the engine's certificate and that the engine serves https at this URL.",
    ],
  ])("reads %s as unreachable, with what to check", async (_name, code, hint) => {
    const failed = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error(code), { code }),
    })
    const outcome = await runtimeAnswering(() => Promise.reject(failed))
      .describeEngine()
      .catch((error: unknown) => error)
    expect(outcome).toMatchObject({ failure: "unreachable", hint })
    expect(outcome).toHaveProperty("message", expect.stringContaining(`(${code})`))
  })

  test("reads a REST root without the engine as misconfigured, naming the root", async () => {
    const outcome = await runtimeAnswering(engineFailure(404, "NotFoundException", "no route"))
      .describeEngine()
      .catch((error: unknown) => error)
    expect(outcome).toMatchObject({
      failure: "misconfigured",
      message: "HTTP 404 Not Found: no route",
      hint: "Check that the engine URL points at the REST API root itself, such as http://localhost:8080/engine-rest.",
    })
  })

  test("reads a connection whose credentials cannot be sent as misconfigured, sending nothing", async () => {
    const engine = fakeEngineRest([])
    const runtime = new C7Adapter(engine.send).runtime({
      endpoint: REST_URL,
      credentials: { kind: "basic", username: "de:mo", password: "s3cret" },
    })
    expect(await failureOf(runtime.describeEngine())).toBe("misconfigured")
    expect(engine.requests).toEqual([])
  })

  test("cuts a long engine text after 500 characters, on one line", async () => {
    const text = `boom\n${"\tat com.example.Worker.run(Worker.java:1)\n".repeat(40)}`
    const outcome = await runtimeAnswering(engineFailure(500, "ProcessEngineException", text))
      .describeEngine()
      .then(
        () => undefined,
        (error: unknown) => error as Error,
      )
    expect(outcome).toMatchObject({ failure: "engineFailure" })
    expect(outcome?.message).toMatch(/^HTTP 500 Internal Server Error: boom at com\.example/)
    expect(outcome?.message).not.toContain("\n")
    expect(outcome?.message.length).toBe(501)
  })

  test("reads an answer past the size cap as unexpected", async () => {
    const huge = new Response("x", { headers: { "Content-Length": String(65 * 1024 * 1024) } })
    expect(await failureOf(runtimeAnswering(huge).describeEngine())).toBe("unexpectedResponse")
  })

  test("reads an id that could smuggle more ids as misconfigured, before sending", async () => {
    const engine = fakeEngineRest([])
    const runtime = new C7Adapter(engine.send).runtime(CONNECTION)
    expect(
      await failureOf(runtime.searchIncidents({ instanceId: InstanceId("a,b") }, { limit: 5 })),
    ).toBe("misconfigured")
    expect(engine.requests.map((request) => request.route)).not.toContain("GET /incident")
  })

  test("reads a missing instance as no detail", async () => {
    const missing = engineFailure(404, "InvalidRequestException", "missing")
    const engine = fakeEngineRest([
      { route: "GET /process-instance/gone", answer: missing },
      { route: "GET /history/process-instance/gone", answer: missing },
      { route: "GET /variable-instance", answer: [] },
    ])
    const runtime = new C7Adapter(engine.send).runtime(CONNECTION)
    expect(await runtime.getInstanceDetail(InstanceId("gone"))).toBeUndefined()
  })

  test("reads a request the platform cannot build as misconfigured, never as no detail", async () => {
    const invalid = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("invalid argument"), { code: "UND_ERR_INVALID_ARG" }),
    })
    const runtime = runtimeAnswering(() => Promise.reject(invalid))
    expect(await failureOf(runtime.getInstanceDetail(InstanceId("x")))).toBe("misconfigured")
  })

  test.each([
    ["a wrong REST root", engineFailure(404, "NotFoundException", "no route")],
    ["a query value the engine cannot read", engineFailure(404, "QueryParamException", "bad")],
  ])("reads %s as misconfigured, never as no detail", async (_name, failure) => {
    const engine = fakeEngineRest([
      { route: "GET /process-instance/x", answer: failure },
      { route: "GET /history/process-instance/x", answer: failure },
      { route: "GET /variable-instance", answer: [] },
    ])
    const runtime = new C7Adapter(engine.send).runtime(CONNECTION)
    expect(await failureOf(runtime.getInstanceDetail(InstanceId("x")))).toBe("misconfigured")
  })
})
