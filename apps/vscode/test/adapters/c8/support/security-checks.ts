import { expect, test } from "vitest"
import { C8Adapter } from "../../../../src/adapters/c8/index.js"
import { RuntimeError, type EngineCredentials } from "../../../../src/contract/index.js"
import { SECURITY, credentialsWith, type RunningCluster } from "./engine-container.js"

const WRONG_SECRET = "this-is-not-the-secret"

type ClusterOf = () => RunningCluster

async function failureOf(attempt: Promise<unknown>): Promise<string> {
  return attempt.then(
    () => "answered",
    (error: unknown) => (RuntimeError.is(error) ? error.failure : String(error)),
  )
}

function countingSend(): { readonly send: typeof fetch; tokenRequests(): number } {
  let tokens = 0
  return {
    send: (input, init) => {
      if (new Request(input, init).url.includes("/protocol/openid-connect/token")) {
        tokens += 1
      }
      return fetch(input, init)
    },
    tokenRequests: () => tokens,
  }
}

function runtimeOf(cluster: RunningCluster, credentials: EngineCredentials) {
  return new C8Adapter().runtime({ endpoint: cluster.url, credentials })
}

export function registerSecurityChecks(clusterOf: ClusterOf): void {
  if (SECURITY === "none") {
    test("reads without credentials while the API is unprotected", async () => {
      const definitions = await runtimeOf(clusterOf(), { kind: "none" }).listDefinitions()
      expect(definitions.length).toBeGreaterThan(0)
    })
    return
  }

  test("reads as unauthorized without credentials", async () => {
    const runtime = runtimeOf(clusterOf(), { kind: "none" })
    expect(await failureOf(runtime.listDefinitions())).toBe("unauthorized")
    expect(await failureOf(runtime.describeEngine())).toBe("unauthorized")
  })

  test("reads as unauthorized with a wrong secret", async () => {
    const cluster = clusterOf()
    const runtime = runtimeOf(cluster, credentialsWith(cluster.reader, WRONG_SECRET))
    expect(await failureOf(runtime.listDefinitions())).toBe("unauthorized")
  })

  test("shows a login without permissions nothing rather than failing", async () => {
    const cluster = clusterOf()
    const runtime = runtimeOf(cluster, cluster.nobody)
    expect(await runtime.listDefinitions()).toEqual([])
    expect(await runtime.searchIncidents({}, { limit: 10 })).toEqual({ items: [] })
  })

  if (SECURITY === "oidc") {
    test("asks for one token across connection rebuilds and parallel reads", async () => {
      const cluster = clusterOf()
      const counting = countingSend()
      const adapter = new C8Adapter(counting.send)
      const connection = { endpoint: cluster.url, credentials: cluster.reader }

      await Promise.all([
        adapter.runtime(connection).listDefinitions(),
        adapter.runtime(connection).searchIncidents({}, { limit: 1 }),
      ])
      await adapter.runtime(connection).listDefinitions()

      expect(counting.tokenRequests()).toBe(1)
    })

    test("does not ask again after the token endpoint refused the secret", async () => {
      const cluster = clusterOf()
      const counting = countingSend()
      const adapter = new C8Adapter(counting.send)
      const credentials = credentialsWith(cluster.reader, WRONG_SECRET)

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const runtime = adapter.runtime({ endpoint: cluster.url, credentials })
        expect(await failureOf(runtime.listDefinitions())).toBe("unauthorized")
      }

      expect(counting.tokenRequests()).toBe(1)
    })

    test("refreshes a short-lived token without a failure", async () => {
      const cluster = clusterOf()
      const counting = countingSend()
      const adapter = new C8Adapter(counting.send)
      const credentials = cluster.shortLived ?? expect.fail("no short-lived client")
      const runtime = adapter.runtime({ endpoint: cluster.url, credentials })

      const before = await runtime.listDefinitions()
      await new Promise((resolve) => setTimeout(resolve, 6_000))
      const after = await runtime.listDefinitions()

      expect(after.length).toBe(before.length)
      expect(counting.tokenRequests()).toBe(2)
    })
  }
}
