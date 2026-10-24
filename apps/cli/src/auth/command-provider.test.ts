import { describe, expect, it } from "vitest"
import { jwtWith, NOW_S, VALID_CLAIMS } from "../../test/support/bearer.js"
import { fakeRuntime, type FakeRuntime } from "../../test/support/fake-runtime.js"
import { authDeps } from "../../test/support/oauth.js"
import type { CommandBearerConfig } from "../config/types.js"
import type { TraceEvent } from "../http/types.js"
import { commandCachePath } from "./command-cache.js"
import { commandBearerAuth, commandToken } from "./command-provider.js"
import { createAuthProvider } from "./index.js"

const NOW = NOW_S * 1000

function config(): CommandBearerConfig {
  return { type: "bearer", source: "env", origin: "OPERATE_TOKEN_COMMAND", command: "print-token" }
}

/** A shell whose command prints the next of `tokens` (the last one again when they run out). */
function printing(...tokens: string[]): FakeRuntime {
  let index = 0
  return fakeRuntime({
    commands: () => {
      const token = tokens[Math.min(index, tokens.length - 1)] ?? ""
      index += 1
      return { stdout: `${token}\n` }
    },
  })
}

function provider(runtime: FakeRuntime, events?: TraceEvent[], scope?: string) {
  const deps = authDeps(runtime, {
    ...(events === undefined ? {} : { events }),
    ...(scope === undefined ? {} : { scope }),
  })
  return commandBearerAuth(config(), deps)
}

const JWT = jwtWith(VALID_CLAIMS)
const OTHER = jwtWith({ ...VALID_CLAIMS, sub: "other" })

describe("commandBearerAuth", () => {
  it("runs the command for the first request and reuses a fresh JWT", async () => {
    const runtime = printing(JWT, OTHER)
    const auth = provider(runtime)
    expect(auth.type).toBe("bearer")
    expect(auth.principal).toBeUndefined()
    await expect(auth.headers()).resolves.toEqual({ Authorization: `Bearer ${JWT}` })
    await expect(auth.headers()).resolves.toEqual({ Authorization: `Bearer ${JWT}` })
    expect(runtime.commandRuns).toHaveLength(1)
    expect(auth.principal).toEqual({ user: "alice", source: "OPERATE_TOKEN_COMMAND" })
  })

  it("shares the JWT with later commands through the cache until shortly before exp", async () => {
    const runtime = printing(JWT, OTHER)
    const events: TraceEvent[] = []
    await provider(runtime).headers()
    const later = provider(runtime, events)
    await expect(later.headers()).resolves.toEqual({ Authorization: `Bearer ${JWT}` })
    expect(runtime.commandRuns).toHaveLength(1)
    expect(events).toEqual([
      {
        type: "note",
        message:
          "Using the token of the bearer token command of OPERATE_TOKEN_COMMAND, cached until it expires at 2023-11-14T23:13:20.000Z.",
      },
    ])
    // within the refresh margin the command runs again, also for a running provider
    await runtime.sleep(3_540_000)
    await expect(later.headers()).resolves.toEqual({ Authorization: `Bearer ${OTHER}` })
    expect(runtime.commandRuns).toHaveLength(2)
    await expect(provider(runtime).headers()).resolves.toEqual({
      Authorization: `Bearer ${OTHER}`,
    })
    expect(runtime.commandRuns).toHaveLength(2)
  })

  it("traces caching with --verbose", async () => {
    const runtime = printing(JWT)
    const events: TraceEvent[] = []
    await provider(runtime, events).headers()
    expect(events.map((event) => (event.type === "note" ? event.message : ""))).toEqual([
      "Running the bearer token command of OPERATE_TOKEN_COMMAND.",
      "Cached the token until shortly before it expires at 2023-11-14T23:13:20.000Z.",
    ])
  })

  it("keeps one cached token per scope", async () => {
    const runtime = printing(JWT, OTHER)
    await provider(runtime, undefined, "/repo-a").headers()
    const other = provider(runtime, undefined, "/repo-b")
    await expect(other.headers()).resolves.toEqual({ Authorization: `Bearer ${OTHER}` })
    await expect(provider(runtime, undefined, "/repo-a").headers()).resolves.toEqual({
      Authorization: `Bearer ${JWT}`,
    })
    expect(runtime.commandRuns).toHaveLength(2)
  })

  it("fetches an opaque token once per call and never caches it", async () => {
    const runtime = printing("opaque-1", "opaque-2")
    const auth = provider(runtime)
    await auth.headers()
    await runtime.sleep(10 * 3_600_000)
    await expect(auth.headers()).resolves.toEqual({ Authorization: "Bearer opaque-1" })
    expect([...runtime.files.keys()]).toEqual([])
    await expect(provider(runtime).headers()).resolves.toEqual({
      Authorization: "Bearer opaque-2",
    })
  })

  it("runs the command again after every 401; true only for another token", async () => {
    const runtime = printing(JWT, OTHER, OTHER, JWT)
    const auth = provider(runtime)
    await auth.headers()
    await expect(auth.refresh?.()).resolves.toBe(true)
    await expect(auth.headers()).resolves.toEqual({ Authorization: `Bearer ${OTHER}` })
    await expect(auth.refresh?.()).resolves.toBe(false)
    // a later 401 in a long wait (the token was rotated again) runs it again
    await expect(auth.refresh?.()).resolves.toBe(true)
    await expect(auth.headers()).resolves.toEqual({ Authorization: `Bearer ${JWT}` })
    expect(runtime.commandRuns).toHaveLength(4)
    // a 401 before any token (another provider sent the request) runs the command, too
    const fresh = provider(printing(JWT))
    await expect(fresh.refresh?.()).resolves.toBe(true)
    const same = printing(JWT)
    const again = provider(same)
    await again.headers()
    await expect(again.refresh?.()).resolves.toBe(false)
    expect(same.commandRuns).toHaveLength(2)
  })

  it("sends an expired token the command printed and runs it again for the next request", async () => {
    const expired = jwtWith({ ...VALID_CLAIMS, exp: NOW_S - 600 })
    const runtime = printing(expired, JWT)
    const auth = provider(runtime)
    await expect(auth.headers()).resolves.toEqual({ Authorization: `Bearer ${expired}` })
    await expect(auth.headers()).resolves.toEqual({ Authorization: `Bearer ${JWT}` })
    expect(runtime.commandRuns).toHaveLength(2)
  })

  it("previews a fresh token of the call or the cache, never running the command", async () => {
    const runtime = printing(JWT)
    const note = {
      headers: {},
      note: "operate runs the bearer token command of OPERATE_TOKEN_COMMAND for the token when it sends the request; --dry-run does not run it.",
    }
    await expect(provider(runtime).preview?.()).resolves.toEqual(note)
    expect(runtime.commandRuns).toHaveLength(0)
    const auth = provider(runtime)
    await auth.headers()
    const header = { headers: { Authorization: `Bearer ${JWT}` } }
    await expect(auth.preview?.()).resolves.toEqual(header)
    await expect(provider(runtime).preview?.()).resolves.toEqual(header)
    await runtime.sleep(3_540_000)
    await expect(provider(runtime).preview?.()).resolves.toEqual(note)
    await expect(auth.preview?.()).resolves.toEqual(note)
    expect(runtime.commandRuns).toHaveLength(1)
    const opaque = provider(printing("opaque"))
    await opaque.headers()
    await expect(opaque.preview?.()).resolves.toEqual({
      headers: { Authorization: "Bearer opaque" },
    })
  })

  it("explains a 401 and a 403 with the claims of the token it sent", async () => {
    const auth = provider(printing(JWT, OTHER))
    expect(auth.rejectedHint?.(401)).toBe(
      "Bearer auth failed: the engine rejected the bearer token from the command of OPERATE_TOKEN_COMMAND. Check that the token is still valid and was issued for this engine (or the gateway in front of it); operate ran the command for this request. Check what the command prints and for which audience (`operate auth status` shows the claims of its token).",
    )
    await auth.headers()
    expect(auth.rejectedHint?.(401)).toContain(
      "the bearer token from the command of OPERATE_TOKEN_COMMAND (a JWT: subject 27c6dbd7-a170-4b19-8686-f7299949346a, issuer https://login.example.com/realms/camunda, audience engine-rest account, expires at 2023-11-14T23:13:20.000Z)",
    )
    await auth.refresh?.()
    expect(auth.rejectedHint?.(401)).toContain(
      "operate ran the command again after the 401, and the engine rejected that token too (or the command printed the same one).",
    )
    expect(auth.rejectedHint?.(403)).toContain("lacks the roles or scopes")
    expect(auth.rejectedHint?.(500)).toBeUndefined()
  })

  it("is what createAuthProvider makes of a token command", async () => {
    const runtime = printing("abc")
    const auth = createAuthProvider(config(), authDeps(runtime))
    await expect(auth.headers()).resolves.toEqual({ Authorization: "Bearer abc" })
  })
})

describe("commandToken", () => {
  it("says whether the token came from the cache", async () => {
    const runtime = printing(JWT)
    const deps = authDeps(runtime)
    expect(await commandToken(config(), deps)).toMatchObject({ cached: false })
    expect(await commandToken(config(), deps)).toMatchObject({
      cached: true,
      entry: { token: JWT, expiresAt: (NOW_S + 3600) * 1000, fetchedAt: NOW },
    })
    expect(runtime.files.has(await commandCachePath(config().command, deps))).toBe(true)
  })
})
