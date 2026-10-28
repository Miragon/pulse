/**
 * The wiring of bearer tokens through `run()`: one case per path from the resolver and the provider
 * to the wire, the exit code and the hints. The rules themselves are asserted by the unit tests of
 * src/config/ and src/auth/. `auth status` and `auth login|logout` are in bearer-auth.test.ts,
 * `config set|show` and mistyped flags in bearer-config.test.ts.
 */

import { describe, expect, it } from "vitest"
import { jwtWith, NOW_S, VALID_CLAIMS } from "../../test/support/bearer.js"
import { errorOf, profiles, server } from "../../test/support/cli-bearer.js"
import { BASE_URL, fakeServer, json } from "../../test/support/fake-fetch.js"
import {
  CONFIG_PATH,
  execute,
  fakeRuntime,
  type FakeRuntimeOptions,
} from "../../test/support/fake-runtime.js"
import { run } from "./run.js"

const JWT = jwtWith(VALID_CLAIMS)
const EXPIRED = jwtWith({ ...VALID_CLAIMS, exp: NOW_S - 31 })

async function cli(args: readonly string[], options: FakeRuntimeOptions = {}, status = 200) {
  const fake = server(status)
  const outcome = await execute(run, args, fakeRuntime({ fetch: fake.fetch, ...options }))
  return { ...outcome, requests: fake.requests }
}

describe("bearer token sources", () => {
  it("sends PULSE_CLI_TOKEN as Authorization: Bearer, and nothing else", async () => {
    const result = await cli(["task", "list"], { env: { PULSE_CLI_TOKEN: "opaque-token" } })
    expect(result).toMatchObject({ code: 0, stdout: "[]\n", stderr: "" })
    expect(result.requests.map((request) => request.headers.authorization)).toEqual([
      "Bearer opaque-token",
    ])
  })

  it('reads the first line of stdin for --auth-token-stdin, CR/LF and "Bearer " stripped', async () => {
    const result = await cli(["task", "list", "--auth-token-stdin"], {
      stdin: "Bearer abc.def\r\nsecond line\n",
    })
    expect(result.code).toBe(0)
    expect(result.requests[0]?.headers.authorization).toBe("Bearer abc.def")
    const before = await cli(["--auth-token-stdin", "task", "list"], { stdin: "xyz" })
    expect(before.requests[0]?.headers.authorization).toBe("Bearer xyz")
  })

  it("maps a resolution error to CONFIG (exit 3) before sending", async () => {
    const files = {
      [CONFIG_PATH]: profiles({ p: { auth: { type: "bearer", tokenEnv: "CI_TOKEN" } } }),
    }
    const unset = await cli(["task", "list"], { files })
    expect(unset.code).toBe(3)
    expect(errorOf(unset.stderr).message).toBe(
      'The token variable CI_TOKEN (auth.tokenEnv of profile "p") is not set or empty',
    )
    expect(unset.requests).toEqual([])
  })

  it("refuses an empty token from stdin before sending", async () => {
    const empty = await cli(["task", "list", "--auth-token-stdin"], { stdin: "  \n" })
    expect(empty.code).toBe(2)
    expect(errorOf(empty.stderr)).toMatchObject({
      code: "USAGE",
      message: "--auth-token-stdin read an empty token",
      hint: "Pipe the token into the command, e.g. gcloud auth print-access-token | pulse-cli ... --auth-token-stdin.",
    })
    expect(empty.requests).toEqual([])
  })
})

describe("JWT expiry", () => {
  it("fails with TOKEN_EXPIRED (exit 4) before sending an expired JWT", async () => {
    const result = await cli(["task", "list"], { env: { PULSE_CLI_TOKEN: EXPIRED } })
    expect(result.code).toBe(4)
    expect(result.requests).toEqual([])
    expect(errorOf(result.stderr)).toEqual({
      code: "TOKEN_EXPIRED",
      exitCode: 4,
      message: "The bearer token from PULSE_CLI_TOKEN expired at 2023-11-14T22:12:49.000Z",
      hint: "pulse-cli never refreshes bearer tokens: the bearer token from PULSE_CLI_TOKEN expired at 2023-11-14T22:12:49.000Z; fetch a new one (e.g. with your identity provider's CLI) and set PULSE_CLI_TOKEN.",
    })
  })
})

describe("bearer tokens in ping", () => {
  it("pings with auth bearer and the user and subject of a JWT", async () => {
    const jwt = await cli(["ping"], { env: { PULSE_CLI_TOKEN: JWT } })
    expect(JSON.parse(jwt.stdout)).toMatchObject({
      auth: "bearer",
      user: "alice",
      subject: VALID_CLAIMS.sub,
    })
    const opaque = JSON.parse(
      (await cli(["ping"], { env: { PULSE_CLI_TOKEN: "op" } })).stdout,
    ) as Record<string, unknown>
    expect(opaque.auth).toBe("bearer")
    expect(opaque).not.toHaveProperty("subject")
    expect(opaque).not.toHaveProperty("user")
  })

  it("warns about a token over plain http beyond loopback, not in a dry-run", async () => {
    const env = { PULSE_CLI_TOKEN: "t", PULSE_CLI_URL: "http://camunda.intranet:8080/engine-rest" }
    const fake = fakeServer("http://camunda.intranet:8080/engine-rest").on("GET", "/task", json([]))
    const result = await execute(run, ["task", "list"], fakeRuntime({ fetch: fake.fetch, env }))
    expect(result.stderr).toBe(
      "Warning: pulse-cli sends the bearer token over plain http to camunda.intranet:8080; anyone on the network path can read and reuse it. Use https:// for the engine URL (RFC 6750 §5.3).\n",
    )
    const dry = await execute(run, ["task", "list", "--dry-run"], fakeRuntime({ env }))
    expect(dry.stderr).toBe("")
  })
})

describe("a rejected bearer token", () => {
  it("explains a 401 without retrying", async () => {
    const result = await cli(["task", "list"], { env: { PULSE_CLI_TOKEN: JWT } }, 401)
    expect(result.code).toBe(4)
    expect(result.requests).toHaveLength(1)
    const error = errorOf(result.stderr)
    expect(error).toMatchObject({ code: "UNAUTHORIZED", engineMessage: "Jwt is expired" })
    expect(error.hint).toContain(
      "the engine rejected the bearer token from PULSE_CLI_TOKEN (a JWT: subject",
    )
    expect(error.hint).toContain(
      "fetch a new token (e.g. with your identity provider's CLI) and set PULSE_CLI_TOKEN",
    )
  })
})

describe("a bearer token that the auth type does not use", () => {
  const sso = {
    [CONFIG_PATH]: profiles({
      p: { auth: { type: "oauth", issuer: "https://login.example.com/realms/x", clientId: "cli" } },
      b: { auth: { type: "basic", username: "demo", passwordEnv: "PW" } },
    }),
  }
  const note =
    'A bearer token is set (from PULSE_CLI_TOKEN) but not used: OAuth is selected by the auth.type of profile "p"; send it with --auth bearer or PULSE_CLI_AUTH=bearer.'

  it("is named by the LOGIN_REQUIRED hint and the 401 hint, and sent with --auth bearer", async () => {
    const env = { PULSE_CLI_TOKEN: JWT, PW: "pw" }
    const result = await cli(["task", "list"], { files: sso, env })
    expect(result.code).toBe(4)
    expect(errorOf(result.stderr).code).toBe("LOGIN_REQUIRED")
    expect(String(errorOf(result.stderr).hint).endsWith(` ${note}`)).toBe(true)
    const rejected = await cli(["task", "list", "--profile", "b"], { files: sso, env }, 401)
    expect(errorOf(rejected.stderr).hint).toContain(
      'A bearer token is set (from PULSE_CLI_TOKEN) but not used: Basic auth is selected by the auth.type of profile "b"',
    )
    const sent = await cli(["task", "list", "--auth", "bearer"], { files: sso, env })
    expect(sent.requests[0]?.headers.authorization).toBe(`Bearer ${JWT}`)
    for (const output of [result, rejected]) expect(output.stderr).not.toContain(JWT)
  })
})

describe("completion of the bearer options", () => {
  async function values(words: readonly string[]): Promise<string[]> {
    const result = await execute(run, ["__complete", ...words], fakeRuntime())
    return result.stdout
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => line.split("\t")[0] ?? "")
  }

  it("offers bearer and the token options", async () => {
    expect(await values(["ping", "--auth", "b"])).toEqual(["basic", "bearer"])
    expect(await values(["task", "list", "--auth-to"])).toEqual(["--auth-token-stdin"])
    expect(await values(["config", "set", "p", "--auth-token"])).toEqual([
      "--auth-token-env",
      "--auth-token-stdin",
    ])
    expect(await values(["config", "set", "p", "--auth", "be"])).toEqual(["bearer"])
    expect(await values(["config", "show", "--auth-t"])).toEqual(["--auth-token-stdin"])
  })

  it("documents the base URL of the fixtures", () => {
    expect(BASE_URL).toBe("http://localhost:8080/engine-rest")
  })
})
