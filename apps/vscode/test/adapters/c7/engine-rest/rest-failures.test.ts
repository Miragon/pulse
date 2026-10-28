import { InstanceId, RuntimeError } from "../../../../src/contract/index.js"
import { describe, expect, test } from "vitest"
import { C7Adapter } from "../../../../src/adapters/c7/index.js"
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
})
