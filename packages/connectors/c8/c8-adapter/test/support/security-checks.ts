import { RuntimeError } from "@miragon/pulse-engine-core"
import type { EngineCredentials } from "@miragon/pulse-runtime-view/ports"
import { expect, test } from "vitest"
import { C8Adapter } from "../../src/index.js"
import { SECURITY, credentialsWith, type RunningCluster } from "./engine-container.js"

const WRONG_SECRET = "this-is-not-the-secret"
const TOKEN_PATH = "/protocol/openid-connect/token"
const SHORT_TOKEN_RENEWED_AFTER_MS = 6_000

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
      if (new Request(input, init).url.includes(TOKEN_PATH)) {
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

function registerUnprotectedChecks(clusterOf: ClusterOf): void {
  test("reads without credentials while the API is unprotected", async () => {
    const definitions = await runtimeOf(clusterOf(), { kind: "none" }).listDefinitions()
    expect(definitions.length).toBeGreaterThan(0)
  })
}

function registerLoginChecks(clusterOf: ClusterOf): void {
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
}

function registerTokenChecks(clusterOf: ClusterOf): void {
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

    const failures: string[] = []
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const runtime = adapter.runtime({ endpoint: cluster.url, credentials })
      failures.push(await failureOf(runtime.listDefinitions()))
    }

    expect(failures).toEqual(["unauthorized", "unauthorized", "unauthorized"])
    expect(counting.tokenRequests()).toBe(1)
  })

  test("renews a short-lived token without a failure", async () => {
    const cluster = clusterOf()
    const counting = countingSend()
    const adapter = new C8Adapter(counting.send)
    const credentials = cluster.shortLived ?? expect.fail("no short-lived client")
    const runtime = adapter.runtime({ endpoint: cluster.url, credentials })

    const before = await runtime.listDefinitions()
    await new Promise((resolve) => setTimeout(resolve, SHORT_TOKEN_RENEWED_AFTER_MS))
    const after = await runtime.listDefinitions()

    expect(after.length).toBe(before.length)
    expect(counting.tokenRequests()).toBe(2)
  })
}

export function registerSecurityChecks(clusterOf: ClusterOf): void {
  if (SECURITY === "none") {
    registerUnprotectedChecks(clusterOf)
    return
  }
  registerLoginChecks(clusterOf)
  if (SECURITY === "oidc") {
    registerTokenChecks(clusterOf)
  }
}
