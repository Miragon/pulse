import { describe, expect, it } from "vitest"
import { C8Runtime } from "@miragon/pulse-c8-core"
import { InstanceId, type RuntimeError } from "@miragon/pulse-engine-core"
import { FAILURE_REASONS, HttpFailure } from "@miragon/pulse-http"
import { createC8Connection } from "./c8-connection.js"
import { c8WordsOf } from "./c8-errors.js"
import { failureError } from "./engine-error.js"
import {
  type Answer,
  c8Platform,
  CLUSTER,
  hang,
  json,
  problem,
  refused,
  token,
} from "./test-support/c8-platform.js"
import { CLIENT, describeEngine, ROOT_HINT, runtimeOver, said } from "./test-support/c8-words.js"

/**
 * What the model reads when a read of a Camunda 8 cluster fails: c8-core's `C8Runtime` over the
 * server's Camunda 8 wire with its words (c8-errors.ts), each the exact message, hint and failure
 * kind. No text carries a hint of the Camunda 7 REST API, and none names the token endpoint's URL
 * or the cluster's url (`NEVER`); the token endpoint's failures are c8-errors.token.test.ts's.
 */

describe("a cluster's error answer, as the model reads it", () => {
  it("names the status, the problem's title and what it states, and the engine", async () => {
    expect(
      await describeEngine({ "GET /v2/topology": () => problem(500, "INTERNAL", "boom") }),
    ).toEqual({ failure: "engineFailure", message: "[500 INTERNAL] boom (engine c8)" })
    expect(
      await describeEngine({ "GET /v2/topology": () => new Response("", { status: 503 }) }),
    ).toEqual({ failure: "engineFailure", message: "[503] empty response body (engine c8)" })
  })

  it("adds the REST root that ends in /v2 to a 404 that names no missing resource", async () => {
    const springNotFound = () =>
      json({ status: 404, error: "Not Found", message: "No message available" }, 404)
    expect(await describeEngine({ "GET /v2/topology": springNotFound })).toEqual({
      failure: "misconfigured",
      message: "[404] No message available (engine c8)",
      hint: ROOT_HINT,
    })
    const { runtime, platform } = runtimeOver({
      "GET /v2/topology": () => json({ gatewayVersion: "8.10.9" }),
    })
    expect(await runtime.getInstanceDetail(InstanceId("2251799813685249"))).toBeUndefined()
    expect(platform.sent.map(({ path }) => path)).toContain(
      "/v2/process-instances/2251799813685249",
    )
  })

  it("says what a 401 needs, by how the server signs in, never naming Camunda 7's variables", async () => {
    const unauthorized = { "GET /v2/topology": () => new Response("", { status: 401 }) }
    expect(await describeEngine(unauthorized)).toEqual({
      failure: "unauthorized",
      message: "[401] empty response body (engine c8)",
      hint:
        "The cluster requires authentication, but none is configured: set auth in the " +
        "engine's profile, its secret in an ENGINE_SECRET_* variable.",
    })
    expect(
      await describeEngine(unauthorized, { type: "basic", username: "demo", password: "demo-1" }),
    ).toMatchObject({ hint: "The cluster rejected the configured credentials." })
    expect(
      await describeEngine(
        { ...unauthorized, "POST /realms/pulse/token": () => token("tok-1") },
        CLIENT,
      ),
    ).toMatchObject({
      failure: "unauthorized",
      hint:
        "The cluster refused the client's token. Check that the client may read the cluster " +
        "and that auth.audience in the engine's profile names the audience the cluster " +
        "expects. A changed client ID or secret goes into auth.clientId or the ENGINE_SECRET_* " +
        "variable auth.clientSecretEnv names; the server reads both at its start.",
    })
  })

  it("names a redirect's target without its query, and the REST root that ends in /v2", async () => {
    const redirect = () =>
      new Response("", {
        status: 302,
        headers: { Location: "https://sso.example.com/realms/ops/auth?client_id=x&state=4711" },
      })
    expect(await describeEngine({ "GET /v2/topology": redirect })).toEqual({
      failure: "misconfigured",
      message: "[302] redirect to https://sso.example.com/realms/ops/auth (engine c8)",
      hint:
        "Redirects are never followed: the profile's url must be the REST root of the cluster " +
        "itself, which ends in /v2 (https:// when the cluster redirects from http://). A " +
        "redirect to a login page means the credentials are missing or expired.",
    })
  })

  it("names a redirect to the cluster's or the token endpoint's host by whose it is, never by its URL", async () => {
    const to = (location: string) => () =>
      new Response("", { status: 301, headers: { Location: location } })
    const REDIRECT_HINT =
      "Redirects are never followed: the profile's url must be the REST root of the cluster " +
      "itself, which ends in /v2 (https:// when the cluster redirects from http://). A " +
      "redirect to a login page means the credentials are missing or expired."
    expect(
      await describeEngine(
        { "GET /v2/topology": to("https://cluster.c8.test/v2/topology?token=4711") },
        { type: "none" },
        "http://cluster.c8.test/v2",
      ),
    ).toEqual({
      failure: "misconfigured",
      message: "[301] redirect to the cluster's host over https (engine c8)",
      hint: REDIRECT_HINT,
    })
    expect(await describeEngine({ "GET /v2/topology": to("/v2/") })).toMatchObject({
      message: "[301] redirect to the cluster's own host (engine c8)",
    })
    const login = to("https://login.c8.test/realms/pulse/protocol/openid-connect/auth?client_id=x")
    expect(
      await describeEngine(
        { "POST /realms/pulse/token": () => token("tok-1"), "GET /v2/topology": login },
        CLIENT,
      ),
    ).toMatchObject({ message: "[301] redirect to the token endpoint's host (engine c8)" })
  })

  it("masks the profile's URLs a cluster's text quotes", async () => {
    const quoting = () =>
      problem(
        500,
        "Failed at https://cluster.c8.test",
        "upstream http://cluster.c8.test/v2 issuer https://login.c8.test/realms/pulse",
      )
    expect(
      await describeEngine(
        { "POST /realms/pulse/token": () => token("tok-1"), "GET /v2/topology": quoting },
        CLIENT,
      ),
    ).toEqual({
      failure: "engineFailure",
      message: "[500 Failed at ***] upstream *** issuer *** (engine c8)",
    })
  })

  it("says that a cluster without secondary storage has nothing to read, naming the engine", async () => {
    const forbidden = () => problem(403, "FORBIDDEN", "This endpoint needs secondary storage")
    expect(await describeEngine({ "GET /v2/topology": forbidden })).toMatchObject({
      failure: "misconfigured",
      message:
        "This cluster runs without secondary storage, so Pulse has nothing to read. (engine c8)",
    })
  })

  it("names the engine of a cluster below the version Pulse reads, like every other failure", async () => {
    const below = () => json({ gatewayVersion: "8.8.12" })
    expect(await describeEngine({ "GET /v2/topology": below })).toEqual({
      failure: "misconfigured",
      message: "Pulse reads Camunda 8.9 or newer. This cluster runs 8.8.12. (engine c8)",
    })
  })

  it("says what of an answer the server cannot read", async () => {
    expect(await describeEngine({ "GET /v2/topology": () => json([]) })).toEqual({
      failure: "unexpectedResponse",
      message: "the answer is not what the server reads: topology is not an object (engine c8)",
    })
  })
})

describe("a read that got no answer, as on Camunda 7", () => {
  const C7 = { engineId: "c8", unauthorizedHint: () => "" }

  it.each<[string, Answer, string]>([
    ["unreachable", refused, "engine c8 unreachable (ECONNREFUSED)"],
    ["deadline", hang, "engine c8 did not respond within 40 ms (timeout)"],
    ["invalid-answer", () => new Response("<html />"), "the answer of engine c8 is no valid JSON"],
  ])("words %s in the sentence engine-error.ts gives it", async (reason, answer, message) => {
    const { runtime } = runtimeOver({ "GET /v2/topology": answer })
    let error: RuntimeError | undefined
    try {
      await runtime.describeEngine()
    } catch (thrown) {
      error = thrown as RuntimeError
    }
    expect(error?.message).toBe(message)
    const cause = error?.cause as HttpFailure
    expect(cause.reason).toBe(reason)
    expect(failureError(cause, C7).message).toBe(message)
  })

  it("words the caller's cancellation", async () => {
    const platform = c8Platform({ "GET /v2/topology": hang })
    const connection = createC8Connection(
      { id: "c8", baseUrl: CLUSTER },
      { type: "none" },
      {},
      platform,
    )
    const leaving = new AbortController()
    const runtime = C8Runtime.over(connection.transport(leaving.signal), {
      wordsOf: c8WordsOf(connection),
    })
    const read = said(runtime.describeEngine())
    await new Promise((resolve) => setTimeout(resolve, 10))
    leaving.abort()
    expect(await read).toEqual({
      failure: "unreachable",
      message: "request to engine c8 was cancelled by the caller",
    })
  })

  it("words every reason of the transport, and a credential it cannot send without a value", () => {
    const { connection } = runtimeOver({})
    const wordsOf = c8WordsOf(connection)
    for (const reason of FAILURE_REASONS) {
      const failure = new HttpFailure(reason, {
        method: "GET",
        target: `${CLUSTER}/topology`,
        mayHaveApplied: false,
        status: reason === "redirect" ? 302 : reason === "unauthorized" ? 401 : 500,
        code: "E_CODE",
        limit: 40,
      })
      const { message } = wordsOf(failure, "unreachable")
      expect(message, reason).toMatch(/engine c8/)
      expect(message, reason).not.toMatch(/cluster\.c8\.test/)
    }
    const credential = new HttpFailure("credential", {
      method: "GET",
      target: `${CLUSTER}/topology`,
      mayHaveApplied: false,
      code: "token-syntax",
    })
    expect(wordsOf(credential, "misconfigured")).toEqual({
      message: "the credentials cannot be sent (token-syntax); nothing was sent (engine c8)",
    })
  })

  it("passes any other error on with the engine named", () => {
    const { connection } = runtimeOver({})
    expect(c8WordsOf(connection)(new Error("boom"), "unexpectedResponse")).toEqual({
      message: "boom (engine c8)",
    })
    expect(c8WordsOf(connection)("boom", "unexpectedResponse")).toEqual({
      message: "boom (engine c8)",
    })
  })
})
