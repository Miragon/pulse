import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { clusterWorld, INSTANCE_KEY, problemOf, topologyOf } from "./c8-cluster-world.js"
import { type FakeC8Cluster, ISSUED_TOKEN, startC8Cluster } from "./fake-c8-cluster.js"

/**
 * The loopback Camunda 8 cluster the server's Camunda 8 tests read, over its copy of the C8
 * adapter's goldens world: it answers what the adapter's world answers (scripts/error-path-goldens
 * holds the copy equal), its token endpoint issues a token, and both record what they took.
 */
describe("the fake Camunda 8 cluster over the copied world", () => {
  let c8: FakeC8Cluster

  beforeAll(async () => {
    c8 = await startC8Cluster(clusterWorld)
  })

  afterAll(async () => {
    await c8?.close()
  })

  /** A search's page as the world answers it. */
  interface Page {
    items: unknown[]
    page: { endCursor: string | null }
  }

  const json = async (path: string, body?: unknown) => {
    const response = await fetch(`${c8.cluster.origin}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${ISSUED_TOKEN}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return {
      status: response.status,
      type: response.headers.get("content-type"),
      body: (await response.json()) as unknown,
    }
  }

  it("answers the topology, the instance and the searches as the C8 adapter's world does", async () => {
    expect(await json("/v2/topology")).toEqual({
      status: 200,
      type: "application/json",
      body: topologyOf("8.9.28").body,
    })
    const instance = await json(`/v2/process-instances/${INSTANCE_KEY}`)
    expect(instance.body).toMatchObject({ processInstanceKey: INSTANCE_KEY, state: "ACTIVE" })
    const page = async (search: unknown) =>
      (await json("/v2/element-instances/search", search)).body as Page
    const [active, all] = [await page({ filter: { state: "ACTIVE" } }), await page({})]
    expect([active.items.length, all.items.length]).toEqual([1, 2])
    expect(all.page.endCursor).not.toBeNull()
    const none = await json("/v2/process-instances/search", {})
    expect(none.body).toEqual({
      items: [],
      page: { totalItems: 0, hasMoreTotalItems: false, startCursor: null, endCursor: null },
    })
  })

  it("answers any other path with the cluster's problem", async () => {
    const path = "/v2/process-definitions/1/xml"
    const { status, type, body } = await json(path)
    const problem = problemOf(404, "Not Found", `No endpoint GET ${path}.`, path)
    expect({ status, type, body }).toEqual({
      status: problem.status,
      type: problem.contentType,
      body: problem.body,
    })
  })

  it("issues a token to the grant and records every request either took", async () => {
    const endpoint = `${c8.tokenEndpoint.origin}/realms/pulse/protocol/openid-connect/token`
    const tokens = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    })
    expect((await tokens.json()) as unknown).toEqual({
      access_token: ISSUED_TOKEN,
      token_type: "Bearer",
      expires_in: 300,
    })
    expect(c8.sent().at(0)).toEqual({
      method: "POST",
      target: "/realms/pulse/protocol/openid-connect/token",
      contentType: "application/x-www-form-urlencoded",
      body: "grant_type=client_credentials",
    })
    expect(c8.cluster.requests.at(0)).toEqual({
      method: "GET",
      target: "/v2/topology",
      authorization: `Bearer ${ISSUED_TOKEN}`,
      contentType: "application/json",
    })
  })
})
