/**
 * The bearer token command of OPERATE_TOKEN_COMMAND end to end through `run()`: the
 * header on the wire, the run again after a 401, the cache per project, failures, masking in
 * --verbose and --dry-run, `ping`, `auth status|login|logout` and `config show`.
 */

import { describe, expect, it } from "vitest"
import { jwtWith, VALID_CLAIMS } from "../../test/support/bearer.js"
import { fakeServer, json, type RecordedRequest } from "../../test/support/fake-fetch.js"
import {
  CONFIG_PATH,
  execute,
  fakeRuntime,
  type FakeRuntimeOptions,
} from "../../test/support/fake-runtime.js"
import { TOKEN_DIR } from "../../test/support/oauth.js"
import { run } from "./run.js"

const JWT = jwtWith(VALID_CLAIMS)
const OTHER = jwtWith({ ...VALID_CLAIMS, preferred_username: "bob" })

/** An engine that accepts only `accepted` (any token when undefined). */
function server(accepted?: string) {
  const guarded = (body: unknown) => (request: RecordedRequest) =>
    accepted === undefined || request.headers.authorization === `Bearer ${accepted}`
      ? json(body)
      : new Response("Jwt is expired", { status: 401, headers: { "content-type": "text/plain" } })
  return fakeServer()
    .on("GET", "/task", guarded([]))
    .on("GET", "/version", guarded({ version: "7.24.0" }))
    .on("GET", "/engine", guarded([{ name: "default" }]))
}

/** A shell whose command prints the next of `tokens` (the last one again when they run out). */
function printing(...tokens: string[]): NonNullable<FakeRuntimeOptions["commands"]> {
  let index = 0
  return () => {
    const token = tokens[Math.min(index, tokens.length - 1)] ?? ""
    index += 1
    return { stdout: `${token}\n` }
  }
}

async function cli(args: readonly string[], options: FakeRuntimeOptions = {}, accepted?: string) {
  const fake = server(accepted)
  const runtime = fakeRuntime({ fetch: fake.fetch, ...options })
  const outcome = await execute(run, args, runtime)
  return { ...outcome, requests: fake.requests }
}

function errorOf(stderr: string): Record<string, unknown> {
  return (JSON.parse(stderr) as { error: Record<string, unknown> }).error
}

function profiles(auth: Record<string, unknown>): string {
  return JSON.stringify({ defaultProfile: "dev", profiles: { dev: { auth } } })
}

const ENV = { OPERATE_TOKEN_COMMAND: "print-token" }

describe("token command sources", () => {
  it("runs OPERATE_TOKEN_COMMAND and sends its token, without an auth type", async () => {
    const result = await cli(["task", "list"], { env: ENV, commands: printing(JWT) })
    expect(result).toMatchObject({ code: 0, stdout: "[]\n", stderr: "" })
    expect(result.requests[0]?.headers.authorization).toBe(`Bearer ${JWT}`)
    expect(result.runtime.commandRuns.map((run) => run.command)).toEqual(["print-token"])
  })

  it("runs it for a bearer profile without a token, bounded by the request timeout", async () => {
    const files = { [CONFIG_PATH]: profiles({ type: "bearer" }) }
    const stored = await cli(["task", "list", "--timeout", "5000"], {
      files,
      env: ENV,
      commands: printing("abc"),
    })
    expect(stored.code).toBe(0)
    expect(stored.runtime.commandRuns).toEqual([
      { command: "print-token", options: { timeoutMs: 5_000 } },
    ])
  })

  it("is no option: neither a flag nor a profile key gives a command", async () => {
    const flag = await cli(["task", "list", "--auth-token-command", "c"])
    expect(flag.code).toBe(2)
    const files = { [CONFIG_PATH]: profiles({ type: "bearer", tokenCommand: "c" }) }
    const stored = await cli(["task", "list"], { files })
    expect(stored.code).toBe(3)
    expect(errorOf(stored.stderr).message).toContain(
      "sets auth.tokenCommand, which operate no longer reads",
    )
    expect(stored.runtime.commandRuns).toEqual([])
  })

  it("notes an unused OPERATE_TOKEN_COMMAND in the hint of a 401", async () => {
    const files = {
      [CONFIG_PATH]: profiles({ type: "basic", username: "u", passwordEnv: "PW" }),
    }
    const result = await cli(["task", "list"], { files, env: { ...ENV, PW: "p" } }, "never")
    expect(result.code).toBe(4)
    expect(errorOf(result.stderr).hint).toContain(
      'A bearer token command is set (from OPERATE_TOKEN_COMMAND) but not used: Basic auth is selected by the auth.type of profile "dev"; send it with --auth bearer or OPERATE_AUTH=bearer.',
    )
    expect(result.runtime.commandRuns).toEqual([])
  })
})

describe("a token command and the engine", () => {
  it("runs the command again after a 401 and retries with the new token", async () => {
    const result = await cli(["task", "list"], { env: ENV, commands: printing(JWT, OTHER) }, OTHER)
    expect(result.code).toBe(0)
    expect(result.requests.map((request) => request.headers.authorization)).toEqual([
      `Bearer ${JWT}`,
      `Bearer ${OTHER}`,
    ])
  })

  it("reports a 401 after the second run, naming the command", async () => {
    const result = await cli(["task", "list"], { env: ENV, commands: printing(JWT, OTHER) }, "x")
    expect(result.code).toBe(4)
    expect(result.requests).toHaveLength(2)
    const hint = String(errorOf(result.stderr).hint)
    expect(hint).toContain("the bearer token from the command of OPERATE_TOKEN_COMMAND")
    expect(hint).toContain("operate ran the command again after the 401")
    expect(result.stderr).not.toContain(OTHER)
  })

  it("reuses a cached JWT in the next call and an opaque token only within one call", async () => {
    const runtime = fakeRuntime({ fetch: server().fetch, env: ENV, commands: printing(JWT) })
    await execute(run, ["task", "list"], runtime)
    await execute(run, ["ping"], runtime)
    expect(runtime.commandRuns).toHaveLength(1)
    const opaque = fakeRuntime({ fetch: server().fetch, env: ENV, commands: printing("abc") })
    await execute(run, ["ping"], opaque)
    expect(opaque.commandRuns).toHaveLength(1)
    await execute(run, ["ping"], opaque)
    expect(opaque.commandRuns).toHaveLength(2)
  })

  it("caches the JWT of a command per working directory", async () => {
    const fake = server()
    const env = { OPERATE_TOKEN_COMMAND: "./token.sh" }
    const commands = printing(JWT, OTHER)
    const inA = fakeRuntime({ fetch: fake.fetch, env, commands, cwd: "/work/a" })
    await execute(run, ["task", "list"], inA)
    // the same relative command line in another directory is another command
    await execute(run, ["task", "list"], { ...inA, cwd: "/work/b" })
    await execute(run, ["task", "list"], inA)
    expect(inA.commandRuns).toHaveLength(2)
    expect(fake.requests.map((request) => request.headers.authorization)).toEqual([
      `Bearer ${JWT}`,
      `Bearer ${OTHER}`,
      `Bearer ${JWT}`,
    ])
  })

  it("fails with LOGIN_FAILED (exit 4) and the end of stderr when the command fails", async () => {
    const result = await cli(["task", "list"], {
      env: ENV,
      commands: { exitCode: 7, stderr: "curl: (7) Failed to connect\n" },
    })
    expect(result.code).toBe(4)
    expect(errorOf(result.stderr)).toMatchObject({
      code: "LOGIN_FAILED",
      message:
        "The bearer token command (OPERATE_TOKEN_COMMAND) failed with exit code 7: curl: (7) Failed to connect",
    })
    expect(result.requests).toEqual([])
  })

  it("traces the run with --verbose and masks the token unless --show-secrets", async () => {
    const result = await cli(["task", "list", "--verbose"], { env: ENV, commands: printing(JWT) })
    expect(result.stderr).toContain(
      "* Running the bearer token command of OPERATE_TOKEN_COMMAND.\n",
    )
    expect(result.stderr).toContain("> Authorization: Bearer ***\n")
    expect(result.stderr).not.toContain(JWT)
  })

  it("never runs the command for --dry-run: a cached token, else a note", async () => {
    const runtime = fakeRuntime({ fetch: server().fetch, env: ENV, commands: printing(JWT) })
    const note = await execute(run, ["task", "list", "--dry-run"], runtime)
    expect(note.code).toBe(0)
    expect(JSON.parse(note.stdout)).toMatchObject({ headers: { Accept: "application/json" } })
    expect(note.stderr).toBe(
      "Note: operate runs the bearer token command of OPERATE_TOKEN_COMMAND for the token when it sends the request; --dry-run does not run it.\n",
    )
    expect(runtime.commandRuns).toEqual([])
    await execute(run, ["task", "list"], runtime)
    runtime.stdout.chunks.length = 0
    runtime.stderr.chunks.length = 0
    const cached = await execute(run, ["task", "list", "--dry-run"], runtime)
    expect(JSON.parse(cached.stdout)).toMatchObject({ headers: { Authorization: "Bearer ***" } })
    expect(cached.stderr).toBe("")
    expect(runtime.commandRuns).toHaveLength(1)
  })

  it("pings with the user of the token", async () => {
    const result = await cli(["ping", "-o", "json"], { env: ENV, commands: printing(JWT) })
    expect(JSON.parse(result.stdout)).toMatchObject({ auth: "bearer", user: "alice" })
    const opaque = await cli(["ping", "-o", "json"], { env: ENV, commands: printing("abc") })
    expect(JSON.parse(opaque.stdout)).toMatchObject({ auth: "bearer", user: null })
  })
})

describe("operate auth with a token command", () => {
  it("status runs the command (or uses its cache) and shows the claims, never the token", async () => {
    const runtime = fakeRuntime({ env: ENV, commands: printing(JWT) })
    const first = await execute(run, ["auth", "status"], runtime)
    expect(first.code).toBe(0)
    expect(JSON.parse(first.stdout)).toEqual({
      type: "bearer",
      profile: null,
      source: "env",
      origin: "OPERATE_TOKEN_COMMAND",
      command: "print-token",
      cached: false,
      format: "jwt",
      subject: VALID_CLAIMS.sub,
      user: "alice",
      issuer: VALID_CLAIMS.iss,
      audience: ["engine-rest", "account"],
      expiresAt: "2023-11-14T23:13:20.000Z",
      expired: false,
    })
    runtime.stdout.chunks.length = 0
    const second = await execute(run, ["auth", "status"], runtime)
    expect(JSON.parse(second.stdout)).toMatchObject({ cached: true, source: "env" })
    expect(second.stdout + second.stderr).not.toContain(JWT)
    expect(runtime.commandRuns).toHaveLength(1)
  })

  it("status fails with the error of the command", async () => {
    const result = await cli(["auth", "status"], { env: ENV, commands: { exitCode: 2 } })
    expect(result.code).toBe(4)
    expect(errorOf(result.stderr)).toMatchObject({ code: "LOGIN_FAILED" })
    expect(result.stdout).toBe("")
  })

  it("logout removes the cached token of the command", async () => {
    const runtime = fakeRuntime({ env: ENV, commands: printing(JWT) })
    await execute(run, ["auth", "status"], runtime)
    const cached = [...runtime.files.keys()].filter((path) => path.startsWith(`${TOKEN_DIR}/`))
    expect(cached).toHaveLength(1)
    runtime.stdout.chunks.length = 0
    const logout = await execute(run, ["auth", "logout"], runtime)
    expect(logout.code).toBe(0)
    expect(JSON.parse(logout.stdout)).toEqual({
      profile: null,
      tokenCache: cached[0],
      removed: true,
      revoked: null,
    })
    expect(runtime.files.has(cached[0]!)).toBe(false)
    runtime.stdout.chunks.length = 0
    const again = await execute(run, ["auth", "logout"], runtime)
    expect(JSON.parse(again.stdout)).toMatchObject({ removed: false })
  })

  it("logout reports a cache file it cannot remove", async () => {
    const runtime = fakeRuntime({ env: ENV })
    const fs = { ...runtime.fs, remove: () => Promise.reject(new Error("EACCES")) }
    const result = await execute(run, ["auth", "logout"], { ...runtime, fs })
    expect(result.code).toBe(3)
    expect(errorOf(result.stderr).message).toMatch(/^Cannot remove the cached token .+ \(EACCES\)$/)
  })

  it("login does not apply and says that operate runs the command", async () => {
    const files = { [CONFIG_PATH]: profiles({ type: "bearer" }) }
    const stored = await cli(["auth", "login"], { files, env: ENV })
    expect(stored.code).toBe(2)
    expect(errorOf(stored.stderr)).toMatchObject({
      message: "operate auth login does not apply to bearer tokens",
      hint: 'Bearer auth is selected by the auth.type of profile "dev": operate runs the token command (OPERATE_TOKEN_COMMAND) whenever it needs a token and never logs in itself; `operate auth status` runs it and shows the token\'s claims and expiry. For an OAuth login run by operate: operate config set dev --auth oauth --oauth-issuer <url> --oauth-client-id <id>.',
    })
    const env = await cli(["auth", "login"], { env: ENV })
    expect(errorOf(env.stderr).hint).toBe(
      "Bearer auth is selected by a token command from OPERATE_TOKEN_COMMAND without an auth type: operate runs the token command (OPERATE_TOKEN_COMMAND) whenever it needs a token and never logs in itself; `operate auth status` runs it and shows the token's claims and expiry. For an OAuth login run by operate: unset OPERATE_TOKEN_COMMAND and configure OAuth: operate config set <profile> --auth oauth --oauth-issuer <url> --oauth-client-id <id>.",
    )
    expect(env.runtime.commandRuns).toEqual([])
  })
})

describe("config show with a token command", () => {
  it("shows the command unmasked, without running it", async () => {
    const result = await cli(["config", "show"], {
      env: { OPERATE_TOKEN_COMMAND: "./token.sh dev" },
    })
    expect(JSON.parse(result.stdout)).toMatchObject({
      values: {
        auth: { value: "bearer", source: "env" },
        tokenCommand: { value: "./token.sh dev", source: "env" },
      },
    })
    expect(result.runtime.commandRuns).toEqual([])
  })
})

describe("the cached token of a project", () => {
  it("is shared by the directories of a repository with a project file", async () => {
    const fake = server()
    const files = { "/home/tester/repo/.operate.json": '{"profiles":{}}' }
    const options = {
      fetch: fake.fetch,
      env: { ...ENV, OPERATE_URL: "http://localhost:8080/engine-rest" },
      commands: printing(JWT, OTHER),
      dirs: ["/home/tester/repo/.git"],
      files,
    }
    const inA = fakeRuntime({ ...options, cwd: "/home/tester/repo/services/a" })
    await execute(run, ["task", "list"], inA)
    await execute(run, ["task", "list"], { ...inA, cwd: "/home/tester/repo/services/b" })
    // outside the repository the working directory is the scope
    await execute(run, ["task", "list"], { ...inA, cwd: "/home/tester/elsewhere" })
    expect(inA.commandRuns).toHaveLength(2)
    expect(fake.requests.map((request) => request.headers.authorization)).toEqual([
      `Bearer ${JWT}`,
      `Bearer ${JWT}`,
      `Bearer ${OTHER}`,
    ])
  })
})
