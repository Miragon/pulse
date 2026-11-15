import { RuntimeError } from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { CamundaClients } from "../../src/camunda-clients.js"
import { ErrorTranslation } from "../../src/errors/error-translation.js"
import type { CamundaClient } from "../../src/rest/index.js"
import { clientWith, page, problem, REST_URL } from "../support/fake-camunda-rest.js"

const ROOT_HINT = "The profile's url must be the REST root of the cluster and end in /v2."

function translated(read: (client: CamundaClient) => Promise<unknown>, answer: unknown) {
  const { client } = clientWith([{ route: "POST /process-instances/search", answer }])
  return ErrorTranslation.translated(() => read(client))
}

function clientOn(send: typeof fetch, endpoint = REST_URL): CamundaClient {
  return new CamundaClients(send, () => Date.now()).of({ endpoint, credentials: { kind: "none" } })
}

describe("the translation of a cluster's failures", () => {
  test.each([
    [401, "unauthorized", "HTTP 401 Unauthorized"],
    [403, "forbidden", "HTTP 403 Forbidden"],
    [400, "engineFailure", "HTTP 400 Bad Request"],
    [503, "engineFailure", "HTTP 503 Service Unavailable"],
  ])("reads HTTP %i as %s", async (status, failure, message) => {
    await expect(
      translated((client) => client.instances({}, { limit: 1 }), new Response("", { status })),
    ).rejects.toMatchObject({ failure, message })
  })

  test("names the detail of a problem the cluster states, cut to one line", async () => {
    const detail = `The filter\n is ${"x".repeat(600)}`
    const read = translated(
      (client) => client.instances({}, { limit: 1 }),
      problem(400, "INVALID_ARGUMENT", detail),
    )

    await expect(read).rejects.toMatchObject({
      failure: "engineFailure",
      message: `HTTP 400 Bad Request: The filter is ${"x".repeat(486)}…`,
    })
  })

  test("names the REST root for a path the cluster does not know", async () => {
    const { client } = clientWith([])

    await expect(ErrorTranslation.translated(() => client.topology())).rejects.toMatchObject({
      failure: "misconfigured",
      message: "HTTP 404 Not Found: No endpoint GET /topology.",
      hint: ROOT_HINT,
    })
  })

  test("names the REST root for a 404 whose JSON does not parse", async () => {
    const broken = new Response("{not json", {
      status: 404,
      headers: { "Content-Type": "application/json" },
    })

    await expect(
      translated((client) => client.instances({}, { limit: 1 }), broken),
    ).rejects.toMatchObject({ failure: "misconfigured", hint: ROOT_HINT })
  })

  test("gives no root hint to a missing resource the cluster names", async () => {
    const read = translated(
      (client) => client.instances({}, { limit: 1 }),
      problem(404, "NOT_FOUND", "Process instance not found"),
    )

    const error = await read.then(
      () => undefined,
      (failure: unknown) => failure,
    )
    expect(error).toMatchObject({ failure: "misconfigured" })
    expect((error as RuntimeError).hint).toBeUndefined()
  })

  test("names a cluster without secondary storage instead of calling it forbidden", async () => {
    const read = translated(
      (client) => client.instances({}, { limit: 1 }),
      problem(403, "Forbidden", "This endpoint requires secondary storage, but none is set."),
    )

    await expect(read).rejects.toMatchObject({
      failure: "misconfigured",
      message: "This cluster runs without secondary storage, so Pulse has nothing to read.",
      hint: expect.stringContaining("secondary storage such as Elasticsearch") as unknown,
    })
  })

  test("reads an answer of another shape as unexpected", async () => {
    await expect(
      translated((client) => client.instances({}, { limit: 1 }), { items: "many", page: {} }),
    ).rejects.toMatchObject({
      failure: "unexpectedResponse",
      message: "/process-instances/search holds no list of items",
    })
  })

  test("reads a redirect as a wrong URL, never following it", async () => {
    const redirect = new Response("", { status: 302, headers: { Location: "/login?next=x" } })

    await expect(
      ErrorTranslation.translated(() => clientOn(() => Promise.resolve(redirect)).topology()),
    ).rejects.toMatchObject({
      failure: "misconfigured",
      message: "HTTP 302 Found: redirects to http://camunda.test/login",
      hint: expect.stringContaining("Pulse never follows a redirect") as unknown,
    })
  })

  test("reads a cluster that does not answer as unreachable", async () => {
    const refused = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    })

    await expect(
      ErrorTranslation.translated(() => clientOn(() => Promise.reject(refused)).topology()),
    ).rejects.toMatchObject({
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
  ])("refuses every call on %s, sending nothing", async (_name, endpoint, message) => {
    const sent: unknown[] = []
    const client = clientOn((input) => {
      sent.push(input)
      return Promise.resolve(Response.json(page([])))
    }, endpoint)

    await expect(ErrorTranslation.translated(() => client.topology())).rejects.toMatchObject({
      failure: "misconfigured",
      message: expect.stringContaining(message) as unknown,
    })
    expect(sent).toEqual([])
  })

  test("passes a runtime error on, and words anything else as unexpected", async () => {
    const refused = new RuntimeError("misconfigured", "refused")

    await expect(ErrorTranslation.translated(() => Promise.reject(refused))).rejects.toBe(refused)
    await expect(
      ErrorTranslation.translated(() => Promise.reject(new Error("broken"))),
    ).rejects.toMatchObject({ failure: "unexpectedResponse", message: "broken" })
  })
})
