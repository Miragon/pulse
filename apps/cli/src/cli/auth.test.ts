/**
 * Basic auth end to end through `run()`: flags, environment and profiles, the header on the wire,
 * masking in dry-run, curl, verbose and config output, and the errors.
 */

import { describe, expect, it } from "vitest"
import { cliOf, errorOf, profiles } from "../../test/support/cli-basic-auth.js"
import { BASE_URL } from "../../test/support/fake-fetch.js"
import { CONFIG_PATH } from "../../test/support/fake-runtime.js"
import { run } from "./run.js"

const cli = cliOf(run)

const DEMO = "Basic ZGVtbzpkZW1v"

describe("Basic auth credentials", () => {
  it("sends the header with the user from the flag and the password from stdin", async () => {
    const result = await cli(
      ["task", "list", "--auth", "basic", "--auth-user", "demo", "--auth-password-stdin"],
      { stdin: "demo\n" },
    )
    expect(result).toMatchObject({ code: 0, stdout: "[]\n", stderr: "" })
    expect(result.requests.map((request) => request.headers.authorization)).toEqual([DEMO])
  })

  it("accepts the auth options before the command path", async () => {
    const result = await cli(
      ["--auth", "basic", "--auth-password-stdin", "--auth-user", "demo", "task", "list"],
      { stdin: "demo" },
    )
    expect(result.code).toBe(0)
    expect(result.requests[0]?.headers.authorization).toBe(DEMO)
  })

  it("takes the credentials from OPERATE_USERNAME and OPERATE_PASSWORD", async () => {
    const env = { OPERATE_USERNAME: "demo", OPERATE_PASSWORD: "demo" }
    const result = await cli(["task", "list"], { env })
    expect(result.code).toBe(0)
    expect(result.requests[0]?.headers.authorization).toBe(DEMO)
  })

  it("takes the credentials from the profile, the password from its variable", async () => {
    const file = profiles({
      p: { auth: { type: "basic", username: "demo", passwordEnv: "CAMUNDA_PASSWORD" } },
    })
    const result = await cli(["task", "list"], {
      files: { [CONFIG_PATH]: file },
      env: { CAMUNDA_PASSWORD: "demo" },
    })
    expect(result.code).toBe(0)
    expect(result.requests[0]?.headers.authorization).toBe(DEMO)
  })

  it("sends no credentials with --auth none, even if the profile has Basic auth", async () => {
    const file = profiles({ p: { auth: { username: "demo", password: "demo" } } })
    const result = await cli(["task", "list", "--auth", "none"], {
      files: { [CONFIG_PATH]: file },
    })
    expect(result.code).toBe(0)
    expect(result.requests[0]?.headers).not.toHaveProperty("authorization")
  })

  it("reports user and auth in ping", async () => {
    const result = await cli(["ping", "--auth-user", "demo"], {
      env: { OPERATE_PASSWORD: "demo" },
    })
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ auth: "basic", user: "demo" })
    expect(result.requests.map((request) => request.headers.authorization)).toEqual([DEMO, DEMO])
    const none = await cli(["ping"])
    expect(JSON.parse(none.stdout)).not.toHaveProperty("user")
    expect(JSON.parse(none.stdout)).toMatchObject({ auth: "none" })
  })

  it("fails with exit 3 before any request when the password is missing", async () => {
    const result = await cli(["task", "list", "--auth", "basic", "--auth-user", "demo"])
    expect(result.code).toBe(3)
    expect(result.requests).toEqual([])
    expect(errorOf(result.stderr)).toMatchObject({
      code: "CONFIG",
      exitCode: 3,
      message: "Basic auth is selected but the password is missing",
    })
    const dryRun = await cli(["ping", "--auth", "basic", "--dry-run"])
    expect(errorOf(dryRun.stderr)).toMatchObject({
      message: "Basic auth is selected but the username and the password are missing",
    })
  })

  it("refuses Basic auth together with an Authorization header", async () => {
    const result = await cli(["task", "list", "-H", "Authorization: Bearer t"], {
      env: { OPERATE_USERNAME: "demo", OPERATE_PASSWORD: "demo" },
    })
    expect(result.code).toBe(3)
    expect(result.requests).toEqual([])
    expect(errorOf(result.stderr)).toMatchObject({
      message: "Basic auth and an Authorization header are both configured",
    })
  })
})

describe("--auth-password-stdin", () => {
  it("refuses --body - on operation commands and api, before reading stdin", async () => {
    for (const args of [
      ["message", "correlate", "--body", "-"],
      ["api", "POST", "/message", "--body", "-"],
    ]) {
      const result = await cli([...args, "--auth-user", "demo", "--auth-password-stdin"], {
        stdin: "demo\n",
      })
      expect(result.code).toBe(2)
      expect(result.requests).toEqual([])
      expect(errorOf(result.stderr)).toMatchObject({
        code: "USAGE",
        message: "--auth-password-stdin and --body - both read stdin",
      })
    }
  })

  it("allows a body from a file", async () => {
    const result = await cli(
      [
        "api",
        "POST",
        "/message",
        "--body",
        "@m.json",
        "--auth-user",
        "demo",
        "--auth-password-stdin",
      ],
      { stdin: "demo", files: { "m.json": '{"messageName":"m"}' } },
    )
    expect(result.code).toBe(0)
    expect(result.requests[0]).toMatchObject({
      body: '{"messageName":"m"}',
      headers: { authorization: DEMO },
    })
  })

  it("refuses an empty password with exit 2", async () => {
    const result = await cli(["task", "list", "--auth-user", "demo", "--auth-password-stdin"], {
      stdin: "\n",
    })
    expect(result.code).toBe(2)
    expect(errorOf(result.stderr)).toMatchObject({
      message: "--auth-password-stdin read an empty password",
    })
  })
})

describe("masking", () => {
  const env = { OPERATE_USERNAME: "demo", OPERATE_PASSWORD: "demo" }

  it("shows Authorization: Basic *** in dry-run previews and curl", async () => {
    for (const args of [
      ["task", "list", "--dry-run"],
      ["api", "GET", "/task", "--dry-run"],
      ["ping", "--dry-run"],
    ]) {
      const result = await cli(args, { env })
      expect(result.code).toBe(0)
      expect(result.requests).toEqual([])
      const preview = JSON.parse(result.stdout) as { headers: unknown; curl: string }
      expect(preview.headers).toMatchObject({ Authorization: "Basic ***" })
      expect(preview.curl).toContain(`-H 'Authorization: Basic ***'`)
      expect(result.stdout).not.toContain("ZGVtbzpkZW1v")
    }
    const table = await cli(["task", "list", "--dry-run", "-o", "table"], { env })
    expect(table.stdout).toBe(
      `curl '${BASE_URL}/task' -H 'Accept: application/json' -H 'Authorization: Basic ***'\n`,
    )
  })

  it("shows the real header with --show-secrets", async () => {
    const result = await cli(["task", "list", "--dry-run", "--show-secrets"], { env })
    expect(JSON.parse(result.stdout)).toMatchObject({ headers: { Authorization: DEMO } })
  })

  it("masks the header in the verbose trace", async () => {
    const result = await cli(["task", "list", "--verbose"], { env })
    expect(result.stderr).toContain("\n> Authorization: Basic ***\n")
    expect(result.stderr).not.toContain("ZGVtbzpkZW1v")
    const shown = await cli(["task", "list", "--verbose", "--show-secrets"], { env })
    expect(shown.stderr).toContain(`\n> Authorization: ${DEMO}\n`)
  })
})

describe("HTTP 401", () => {
  it("names the rejected user and the source of the credentials", async () => {
    const result = await cli(
      ["task", "list"],
      { env: { OPERATE_USERNAME: "demo", OPERATE_PASSWORD: "wrong" } },
      401,
    )
    expect(result.code).toBe(4)
    expect(errorOf(result.stderr)).toMatchObject({
      code: "UNAUTHORIZED",
      hint: "The engine rejected the credentials of user demo (source: env). Check the username and the password; `operate config show` shows where each comes from. After a failed login the engine refuses the user for a few seconds (and locks it after repeated failures), so wait before retrying.",
    })
    expect(result.stderr).not.toContain("wrong")
  })

  it("says that operate sent no credentials and how to send them", async () => {
    const result = await cli(["task", "list"], {}, 401)
    expect(result.code).toBe(4)
    const { hint } = errorOf(result.stderr) as { hint: string }
    expect(hint).toContain("operate sent no credentials")
    expect(hint).toContain("--auth basic --auth-user <name>")
    expect(hint).toContain("OPERATE_USERNAME and OPERATE_PASSWORD")
    expect(hint).toContain(
      "`operate config set <profile> --auth basic --auth-user <name> --auth-password-env <VAR>`",
    )
  })
})

describe("credentials that select nothing", () => {
  it("selects Basic auth for --auth-password-stdin and fails without a username", async () => {
    const result = await cli(["task", "list", "--auth-password-stdin"], { stdin: "demo\n" })
    expect(result.code).toBe(3)
    expect(result.requests).toEqual([])
    expect(errorOf(result.stderr)).toMatchObject({
      code: "CONFIG",
      message: "Basic auth is selected but the username is missing",
    })
    expect((errorOf(result.stderr) as { hint: string }).hint).toMatch(
      /^Basic auth was selected by --auth-password-stdin without an auth type\. /,
    )
  })

  it("says in the 401 hint that OPERATE_AUTH=none switched Basic auth off", async () => {
    const result = await cli(
      ["task", "list", "--auth-user", "demo", "--auth-password-stdin"],
      { stdin: "demo\n", env: { OPERATE_AUTH: "none" } },
      401,
    )
    expect(result.code).toBe(4)
    expect(result.requests[0]?.headers.authorization).toBeUndefined()
    expect((errorOf(result.stderr) as { hint: string }).hint).toMatch(
      /^The engine requires authentication and operate sent no credentials: Basic auth is switched off by OPERATE_AUTH=none\. Use Basic auth: /,
    )
  })

  it("says in the 401 hint that a password without a username was not used", async () => {
    const result = await cli(["task", "list"], { env: { OPERATE_PASSWORD: "demo" } }, 401)
    expect((errorOf(result.stderr) as { hint: string }).hint).toMatch(
      /^The engine requires authentication and operate sent no credentials: a password is set \(from OPERATE_PASSWORD\), but no username\. /,
    )
    expect(result.stderr).not.toContain('"demo"')
  })
})
