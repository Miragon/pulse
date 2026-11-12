import { describe, expect, it } from "vitest"
import { headersOf, renewalOf } from "../../test/support/credential.js"
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
  return {
    type: "bearer",
    source: "env",
    origin: "PULSE_CLI_TOKEN_COMMAND",
    command: "print-token",
  }
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
    await expect(headersOf(auth)).resolves.toEqual({ Authorization: `Bearer ${JWT}` })
    await expect(headersOf(auth)).resolves.toEqual({ Authorization: `Bearer ${JWT}` })
    expect(runtime.commandRuns).toHaveLength(1)
    expect(auth.principal).toEqual({ user: "alice", source: "PULSE_CLI_TOKEN_COMMAND" })
  })

  it("shares the JWT with later commands through the cache until shortly before exp", async () => {
    const runtime = printing(JWT, OTHER)
    const events: TraceEvent[] = []
    await headersOf(provider(runtime))
    const later = provider(runtime, events)
    await expect(headersOf(later)).resolves.toEqual({ Authorization: `Bearer ${JWT}` })
    expect(runtime.commandRuns).toHaveLength(1)
    expect(events).toEqual([
      {
        type: "note",
        message:
          "Using the token of the bearer token command of PULSE_CLI_TOKEN_COMMAND, cached until it expires at 2023-11-14T23:13:20.000Z.",
      },
    ])
    // within the refresh margin the command runs again, also for a running provider
    await runtime.sleep(3_540_000)
    await expect(headersOf(later)).resolves.toEqual({ Authorization: `Bearer ${OTHER}` })
    expect(runtime.commandRuns).toHaveLength(2)
    await expect(headersOf(provider(runtime))).resolves.toEqual({
      Authorization: `Bearer ${OTHER}`,
    })
    expect(runtime.commandRuns).toHaveLength(2)
  })

  it("traces caching with --verbose", async () => {
    const runtime = printing(JWT)
    const events: TraceEvent[] = []
    await headersOf(provider(runtime, events))
    expect(events.map((event) => (event.type === "note" ? event.message : ""))).toEqual([
      "Running the bearer token command of PULSE_CLI_TOKEN_COMMAND.",
      "Cached the token until shortly before it expires at 2023-11-14T23:13:20.000Z.",
    ])
  })

  it("keeps one cached token per scope", async () => {
    const runtime = printing(JWT, OTHER)
    await headersOf(provider(runtime, undefined, "/repo-a"))
    const other = provider(runtime, undefined, "/repo-b")
    await expect(headersOf(other)).resolves.toEqual({ Authorization: `Bearer ${OTHER}` })
    await expect(headersOf(provider(runtime, undefined, "/repo-a"))).resolves.toEqual({
      Authorization: `Bearer ${JWT}`,
    })
    expect(runtime.commandRuns).toHaveLength(2)
  })

  it("reuses an opaque token within its call until a 401 and never caches it", async () => {
    const runtime = printing("opaque-1", "opaque-2", "opaque-3")
    const auth = provider(runtime)
    await headersOf(auth)
    // a token younger than 30 s was refused for another reason than its age
    await runtime.sleep(29_999)
    await expect(renewalOf(auth)).resolves.toBe(false)
    expect(runtime.commandRuns).toHaveLength(1)
    await runtime.sleep(10 * 3_600_000)
    await expect(headersOf(auth)).resolves.toEqual({ Authorization: "Bearer opaque-1" })
    expect(runtime.commandRuns).toHaveLength(1)
    await expect(renewalOf(auth)).resolves.toBe(true)
    await expect(headersOf(auth)).resolves.toEqual({ Authorization: "Bearer opaque-2" })
    expect([...runtime.files.keys()]).toEqual([])
    await expect(headersOf(provider(runtime))).resolves.toEqual({
      Authorization: "Bearer opaque-3",
    })
  })

  it("runs the command again after a 401 of a token 30 s old or older; true only for another token", async () => {
    const runtime = printing(JWT, OTHER, OTHER, JWT)
    const auth = provider(runtime)
    await headersOf(auth)
    // a token the command just printed was refused for another reason than its age
    await expect(renewalOf(auth)).resolves.toBe(false)
    expect(runtime.commandRuns).toHaveLength(1)
    await runtime.sleep(30_000)
    await expect(renewalOf(auth)).resolves.toBe(true)
    await expect(headersOf(auth)).resolves.toEqual({ Authorization: `Bearer ${OTHER}` })
    await runtime.sleep(30_000)
    await expect(renewalOf(auth)).resolves.toBe(false)
    // a later 401 in a long wait (the token was rotated again) runs it again
    await runtime.sleep(30_000)
    await expect(renewalOf(auth)).resolves.toBe(true)
    await expect(headersOf(auth)).resolves.toEqual({ Authorization: `Bearer ${JWT}` })
    expect(runtime.commandRuns).toHaveLength(4)
    // a 401 to another token (another request renewed it meanwhile) retries with this one
    const fresh = provider(printing(JWT))
    await expect(renewalOf(fresh, "Bearer another")).resolves.toBe(true)
  })

  it("says it uses a cached token only when it takes one over, also after a 401", async () => {
    const runtime = printing(JWT, OTHER)
    await headersOf(provider(runtime))
    const events: TraceEvent[] = []
    const auth = provider(runtime, events)
    await headersOf(auth)
    await runtime.sleep(30_000)
    // the cached token was refused: the command runs, and nothing says the cache was used
    await expect(renewalOf(auth)).resolves.toBe(true)
    await expect(headersOf(auth)).resolves.toEqual({ Authorization: `Bearer ${OTHER}` })
    const notes = events.map((event) => (event.type === "note" ? event.message : ""))
    expect(notes.filter((note) => note.startsWith("Using the token"))).toHaveLength(1)
    expect(notes.at(-2)).toBe("Running the bearer token command of PULSE_CLI_TOKEN_COMMAND.")
  })

  it("sends an expired token the command printed and runs it again for the next request", async () => {
    const expired = jwtWith({ ...VALID_CLAIMS, exp: NOW_S - 600 })
    const runtime = printing(expired, JWT)
    const auth = provider(runtime)
    await expect(headersOf(auth)).resolves.toEqual({ Authorization: `Bearer ${expired}` })
    await expect(headersOf(auth)).resolves.toEqual({ Authorization: `Bearer ${JWT}` })
    expect(runtime.commandRuns).toHaveLength(2)
  })

  it("previews a fresh token of the call or the cache, never running the command", async () => {
    const runtime = printing(JWT)
    const note = {
      headers: {},
      note: "pulse runs the bearer token command of PULSE_CLI_TOKEN_COMMAND for the token when it sends the request; --dry-run does not run it.",
    }
    await expect(provider(runtime).preview?.()).resolves.toEqual(note)
    expect(runtime.commandRuns).toHaveLength(0)
    const auth = provider(runtime)
    await headersOf(auth)
    const header = { headers: { Authorization: `Bearer ${JWT}` } }
    await expect(auth.preview?.()).resolves.toEqual(header)
    await expect(provider(runtime).preview?.()).resolves.toEqual(header)
    await runtime.sleep(3_540_000)
    await expect(provider(runtime).preview?.()).resolves.toEqual(note)
    await expect(auth.preview?.()).resolves.toEqual(note)
    expect(runtime.commandRuns).toHaveLength(1)
    const opaque = provider(printing("opaque"))
    await headersOf(opaque)
    await expect(opaque.preview?.()).resolves.toEqual({
      headers: { Authorization: "Bearer opaque" },
    })
  })

  it("explains a 401 and a 403 with the claims of the token it sent", async () => {
    const runtime = printing(JWT, OTHER)
    const auth = provider(runtime)
    expect(auth.rejectedHint?.(401)).toBe(
      "Bearer auth failed: the engine rejected the bearer token from the command of PULSE_CLI_TOKEN_COMMAND. Check that the token is still valid and was issued for this engine (or the gateway in front of it); pulse ran the command for this request. Check what the command prints and for which audience (`pulse auth status` shows the claims of its token).",
    )
    await headersOf(auth)
    expect(auth.rejectedHint?.(401)).toContain(
      "the bearer token from the command of PULSE_CLI_TOKEN_COMMAND (a JWT: subject 27c6dbd7-a170-4b19-8686-f7299949346a, issuer https://login.example.com/realms/camunda, audience engine-rest account, expires at 2023-11-14T23:13:20.000Z)",
    )
    await renewalOf(auth)
    expect(auth.rejectedHint?.(401)).toContain("pulse ran the command for this request.")
    await runtime.sleep(30_000)
    await renewalOf(auth)
    expect(auth.rejectedHint?.(401)).toContain(
      "pulse ran the command again after the 401, and the engine rejected that token too (or the command printed the same one).",
    )
    expect(auth.rejectedHint?.(403)).toContain("lacks the roles or scopes")
    expect(auth.rejectedHint?.(500)).toBeUndefined()
  })

  it("is what createAuthProvider makes of a token command", async () => {
    const runtime = printing("abc")
    const auth = createAuthProvider(config(), authDeps(runtime))
    await expect(headersOf(auth)).resolves.toEqual({ Authorization: "Bearer abc" })
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
