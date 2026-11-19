import { RuntimeError } from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { ErrorTranslation } from "../../src/errors/error-translation.js"
import { page, problem, runtimeOn, runtimeWith, TOPOLOGY } from "../support/fake-camunda-rest.js"

const ROOT_HINT = "The profile's url must be the REST root of the cluster and end in /v2."

function searched(answer: unknown) {
  const { runtime } = runtimeWith([TOPOLOGY, { route: "POST /process-instances/search", answer }])
  return runtime.searchInstances({}, { limit: 1 })
}

describe("the words of a cluster's failures", () => {
  test.each([
    [401, "unauthorized", "HTTP 401 Unauthorized"],
    [403, "forbidden", "HTTP 403 Forbidden"],
    [400, "engineFailure", "HTTP 400 Bad Request"],
    [503, "engineFailure", "HTTP 503 Service Unavailable"],
  ])("say HTTP %i as %s", async (status, failure, message) => {
    await expect(searched(new Response("", { status }))).rejects.toMatchObject({
      failure,
      message,
    })
  })

  test("name the detail of a problem the cluster states, cut to one line", async () => {
    const detail = `The filter\n is ${"x".repeat(600)}`

    await expect(searched(problem(400, "INVALID_ARGUMENT", detail))).rejects.toMatchObject({
      failure: "engineFailure",
      message: `HTTP 400 Bad Request: The filter is ${"x".repeat(486)}…`,
    })
  })

  test("name the REST root for a path the cluster does not know", async () => {
    await expect(runtimeWith([]).runtime.describeEngine()).rejects.toMatchObject({
      failure: "misconfigured",
      message: "HTTP 404 Not Found: No endpoint GET /topology.",
      hint: ROOT_HINT,
    })
  })

  test("name the REST root for a 404 whose JSON does not parse", async () => {
    const broken = new Response("{not json", {
      status: 404,
      headers: { "Content-Type": "application/json" },
    })

    await expect(searched(broken)).rejects.toMatchObject({
      failure: "misconfigured",
      hint: ROOT_HINT,
    })
  })

  test("give no root hint to a missing resource the cluster names", async () => {
    const error = await searched(problem(404, "NOT_FOUND", "Process instance not found")).then(
      () => undefined,
      (failure: unknown) => failure,
    )

    expect(error).toMatchObject({ failure: "misconfigured" })
    expect((error as RuntimeError).hint).toBeUndefined()
  })

  test("name a cluster without secondary storage instead of calling it forbidden", async () => {
    const answer = problem(
      403,
      "Forbidden",
      "This endpoint requires secondary storage, but none is set.",
    )

    await expect(searched(answer)).rejects.toMatchObject({
      failure: "misconfigured",
      message: "This cluster runs without secondary storage, so Pulse has nothing to read.",
      hint: expect.stringContaining("secondary storage such as Elasticsearch") as unknown,
    })
  })

  test("read an answer of another shape as unexpected", async () => {
    await expect(searched({ items: "many", page: {} })).rejects.toMatchObject({
      failure: "unexpectedResponse",
      message: "/process-instances/search holds no list of items",
    })
  })

  test("read a redirect as a wrong URL, never following it", async () => {
    const redirect = new Response("", { status: 302, headers: { Location: "/login?next=x" } })

    await expect(runtimeOn(() => Promise.resolve(redirect)).describeEngine()).rejects.toMatchObject(
      {
        failure: "misconfigured",
        message: "HTTP 302 Found: redirects to http://camunda.test/login",
        hint: expect.stringContaining("Pulse never follows a redirect") as unknown,
      },
    )
  })

  test("read a cluster that does not answer as unreachable", async () => {
    const refused = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    })

    await expect(runtimeOn(() => Promise.reject(refused)).describeEngine()).rejects.toMatchObject({
      failure: "unreachable",
      message: "Cannot reach http://camunda.test/v2/topology (ECONNREFUSED)",
    })
  })

  test.each([
    [
      "a URL with credentials",
      "http://demo:s3cret@camunda.test/v2",
      "The cluster URL cannot be used",
    ],
    ["a URL that is none", "camunda.test", "The cluster URL cannot be used"],
  ])("refuse every call on %s, sending nothing", async (_name, endpoint, message) => {
    const sent: unknown[] = []
    const runtime = runtimeOn((input) => {
      sent.push(input)
      return Promise.resolve(Response.json(page([])))
    }, endpoint)

    await expect(runtime.describeEngine()).rejects.toMatchObject({
      failure: "misconfigured",
      message: expect.stringContaining(message) as unknown,
    })
    expect(sent).toEqual([])
  })

  test("are the message of any other error, without a hint", () => {
    expect(ErrorTranslation.wordsOf(new RuntimeError("misconfigured", "refused"))).toEqual({
      message: "refused",
    })
    expect(ErrorTranslation.wordsOf("broken")).toEqual({ message: "broken" })
  })
})
