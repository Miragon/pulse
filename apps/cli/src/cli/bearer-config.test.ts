/**
 * Bearer tokens end to end through `run()`, part 3: `config set|show|unset|list` with a bearer
 * token and the mistyped bearer flags.
 */

import { describe, expect, it } from "vitest"
import { jwtWith, VALID_CLAIMS } from "../../test/support/bearer.js"
import { errorOf, profiles, server } from "../../test/support/cli-bearer.js"
import {
  CONFIG_PATH,
  execute,
  fakeRuntime,
  type FakeRuntimeOptions,
  fileText,
} from "../../test/support/fake-runtime.js"
import { run } from "./run.js"

const JWT = jwtWith(VALID_CLAIMS)

async function cli(args: readonly string[], options: FakeRuntimeOptions = {}, status = 200) {
  const fake = server(status)
  const outcome = await execute(run, args, fakeRuntime({ fetch: fake.fetch, ...options }))
  return { ...outcome, requests: fake.requests }
}

describe("pulse-cli config with a bearer token", () => {
  it("stores the name of the variable and warns when it is not set, without naming it", async () => {
    const result = await cli(["config", "set", "ci", "--auth-token-env", "CI_ENGINE_TOKEN"])
    expect(result.code).toBe(0)
    expect(JSON.parse(fileText(result.runtime, CONFIG_PATH) ?? "{}")).toEqual({
      defaultProfile: "ci",
      profiles: { ci: { auth: { type: "bearer", tokenEnv: "CI_ENGINE_TOKEN" } } },
    })
    expect(result.stderr).toBe(
      "Warning: the variable named by --auth-token-env is not set in this environment. Pass the name of a variable that holds the token (e.g. CI_ENGINE_TOKEN), never the token itself; commands read it when they run.\n",
    )
    const set = await cli(["config", "set", "ci", "--auth", "bearer", "--auth-token-env", "X"], {
      env: { X: "value" },
    })
    expect(set.stderr).toBe("")
  })

  it("stores a token from stdin with a plain text warning and prints it masked", async () => {
    const result = await cli(["config", "set", "ci", "--auth-token-stdin", "-o", "json"], {
      stdin: "Bearer lit.token\n",
    })
    expect(result.code).toBe(0)
    expect(JSON.parse(fileText(result.runtime, CONFIG_PATH) ?? "{}")).toMatchObject({
      profiles: { ci: { auth: { type: "bearer", token: "lit.token" } } },
    })
    expect(JSON.parse(result.stdout)).toMatchObject({ auth: { type: "bearer", token: "***" } })
    expect(result.stdout).not.toContain("lit.token")
    expect(result.stderr).toBe(
      `Warning: the bearer token is stored in plain text in ${CONFIG_PATH} (mode 0600). Prefer --auth-token-env <VAR>, which stores only the name of an environment variable.\n`,
    )
  })

  it("refuses two secrets from stdin and names replaced Basic auth settings", async () => {
    const both = await cli(["config", "set", "ci", "--auth-token-stdin", "--auth-password-stdin"], {
      stdin: "x",
    })
    expect(errorOf(both.stderr).message).toBe(
      "--auth-password-stdin and --auth-token-stdin both read stdin",
    )
    const files = {
      [CONFIG_PATH]: profiles({ p: { auth: { type: "basic", username: "u", passwordEnv: "PW" } } }),
    }
    const replaced = await cli(["config", "set", "p", "--auth-token-env", "X"], {
      files,
      env: { X: "v" },
    })
    expect(replaced.stderr).toBe(
      "Notice: removed the Basic auth settings of the profile; bearer auth replaces them.\n",
    )
    const oauth = {
      [CONFIG_PATH]: profiles({ p: { auth: { type: "oauth", clientId: "c" } } }),
    }
    const fromOAuth = await cli(["config", "set", "p", "--auth", "bearer"], { files: oauth })
    expect(fromOAuth.stderr).toBe(
      "Notice: removed the OAuth settings of the profile; bearer auth replaces them.\n",
    )
    const header = {
      [CONFIG_PATH]: profiles({ p: { headers: { Authorization: "Bearer x" } } }),
    }
    const upgraded = await cli(["config", "set", "p", "--auth-token-env", "X"], {
      files: header,
      env: { X: "v" },
    })
    expect(upgraded.stderr).toBe(
      "Notice: removed the Authorization header of the profile; bearer auth replaces it.\n",
    )
  })

  it("shows the token masked with its source, the real value with --show-secrets", async () => {
    const env = { PULSE_CLI_TOKEN: "shown.token" }
    const view = JSON.parse((await cli(["config", "show"], { env })).stdout) as {
      values: Record<string, unknown>
    }
    expect(view.values.auth).toEqual({ value: "bearer", source: "env" })
    expect(view.values.token).toEqual({ value: "***", source: "env" })
    const shown = await cli(["config", "show", "--show-secrets"], { env })
    expect(shown.stdout).toContain('"token":{"value":"shown.token","source":"env"}')
    const stdin = await cli(["config", "show", "--auth-token-stdin", "-o", "table"], {
      stdin: "piped",
    })
    expect(stdin.stdout).toMatch(/\ntoken +\*\*\* +flag\n/)
  })

  it("reports a token the auth type does not use", async () => {
    const env = {
      PULSE_CLI_TOKEN: "tok",
      PULSE_CLI_USERNAME: "u",
      PULSE_CLI_PASSWORD: "p",
      PULSE_CLI_AUTH: "basic",
    }
    const json = JSON.parse((await cli(["config", "show"], { env })).stdout) as {
      values: Record<string, unknown>
    }
    expect(json.values.token).toEqual({
      value: "***",
      source: "env",
      unused: "Basic auth is selected by PULSE_CLI_AUTH=basic",
    })
    const table = await cli(["config", "show", "-o", "table"], { env })
    expect(table.stdout).toMatch(
      /\ntoken +\*\*\* \(unused: Basic auth is selected by PULSE_CLI_AUTH=basic\) +env\n/,
    )
    expect(table.stdout).not.toContain("tok ")
  })

  it("unsets the token and lists the type", async () => {
    const files = { [CONFIG_PATH]: profiles({ p: { auth: { type: "bearer", token: "t" } } }) }
    const list = await cli(["config", "list"], { files })
    expect(JSON.parse(list.stdout)).toMatchObject([{ name: "p", auth: "bearer" }])
    const unset = await cli(["config", "unset", "p", "token"], { files })
    expect(JSON.parse(fileText(unset.runtime, CONFIG_PATH) ?? "{}")).toMatchObject({
      profiles: { p: { auth: { type: "bearer" } } },
    })
  })
})

describe("mistyped bearer flags", () => {
  it("never echoes a token given as a flag value", async () => {
    const value = await cli(["task", "list", "--auth-token=s3cr3t.tok"])
    expect(errorOf(value.stderr)).toMatchObject({ message: 'Unknown option "--auth-token"' })
    expect(errorOf(value.stderr).hint).toContain("Did you mean --auth-token-stdin?")
    const stdin = await cli(["task", "list", "--auth-token-stdin=s3cr3t.tok"])
    expect(errorOf(stdin.stderr).message).toBe('Option "--auth-token-stdin" takes no value')
    const extra = await cli(["task", "list", "--auth-token-stdin", "s3cr3t.tok"], { stdin: "t" })
    expect(errorOf(extra.stderr).hint).toContain(
      "--auth-token-stdin takes no value: pipe the token into it",
    )
    const guessed = await cli(["config", "set", "p", "--token-env", "X"])
    expect(errorOf(guessed.stderr).hint).toContain("Did you mean --auth-token-env?")
    for (const result of [value, stdin, extra, guessed]) {
      expect(result.stderr).not.toContain("s3cr3t.tok")
      expect(result.requests).toEqual([])
    }
  })

  it("never echoes a token typed before the command name", async () => {
    const stdin = await cli(["--auth-token-stdin", JWT, "task", "list"], { stdin: "t" })
    expect(errorOf(stdin.stderr)).toEqual({
      code: "USAGE",
      exitCode: 2,
      message: "Unknown command (not repeated: it may be a token or password)",
      hint: `--auth-token-stdin takes no value: pipe the token into it, e.g. printf '%s\\n' "$TOKEN" | pulse-cli ... --auth-token-stdin. Run "pulse-cli --help" for the commands.`,
    })
    const typed = await cli(["--auth", "bearer", JWT, "task", "list"])
    expect(errorOf(typed.stderr).hint).toBe(
      '--auth takes only the type: the token goes into PULSE_CLI_TOKEN or --auth-token-stdin, not after --auth bearer. Run "pulse-cli --help" for the commands.',
    )
    const password = await cli(["--auth-password-stdin", "s3cr3t.pw", "task", "list"])
    const group = await cli(["auth", JWT])
    // a typo next to a secret option keeps its suggestion (known names only)
    const typo = await cli(["--auth-token-stdin", "tsk", "list"], { stdin: "t" })
    expect(errorOf(typo.stderr).hint).toMatch(/^Did you mean task\? /)
    const plain = await cli(["tsk", "list"])
    expect(errorOf(plain.stderr).message).toBe('Unknown command "tsk"')
    for (const result of [stdin, typed, password, group]) {
      expect(result.code).toBe(2)
      expect(result.stderr).not.toContain(JWT)
      expect(result.stderr).not.toContain("s3cr3t.pw")
      expect(result.requests).toEqual([])
    }
  })

  it("never echoes a token typed after --auth bearer or given to an auth command", async () => {
    const after = await cli(["task", "list", "--auth", "bearer", JWT])
    expect(errorOf(after.stderr)).toEqual({
      code: "USAGE",
      exitCode: 2,
      message: "Too many arguments for 'list'. Expected 0 arguments but got 1.",
      hint: '--auth takes only the type: the token goes into PULSE_CLI_TOKEN or --auth-token-stdin, not after --auth bearer. Run "pulse-cli task list --help" for the usage.',
    })
    const equals = await cli(["ping", "--auth=Bearer", JWT])
    const set = await cli(["config", "set", "p", "--auth", "bearer", JWT])
    expect(errorOf(set.stderr).message).toBe(
      "Too many arguments for 'set'. Expected 1 argument but got 2.",
    )
    const status = await cli(["auth", "status", JWT])
    expect(errorOf(status.stderr)).toEqual({
      code: "USAGE",
      exitCode: 2,
      message: "Too many arguments for 'status'. Expected 0 arguments but got 1.",
      hint: `pulse-cli auth status takes no token argument: pipe the token into --auth-token-stdin, e.g. printf '%s\\n' "$TOKEN" | pulse-cli auth status --auth-token-stdin. Run "pulse-cli auth status --help" for the usage.`,
    })
    const logout = await cli(["auth", "logout", JWT])
    for (const result of [after, equals, set, status, logout]) {
      expect(result.code).toBe(2)
      expect(result.stderr).not.toContain(JWT)
      expect(result.requests).toEqual([])
    }
  })

  it("never echoes a token given as the auth type", async () => {
    const files = { [CONFIG_PATH]: profiles({ p: { auth: { type: `Bearer ${JWT}` } } }) }
    const results = [
      await cli(["task", "list", "--auth", `Bearer ${JWT}`]),
      await cli(["task", "list", `--auth=${JWT}`]),
      await cli(["task", "list", "--auth", `bearer:${JWT}`]),
      await cli(["task", "list"], { env: { PULSE_CLI_AUTH: `Bearer ${JWT}` } }),
      await cli(["config", "set", "p", "--auth", `Bearer ${JWT}`]),
      await cli(["task", "list"], { files }),
      await cli(["config", "show"], { files }),
    ]
    for (const result of results) {
      expect(result.code).toBe(3)
      expect(errorOf(result.stderr)).toMatchObject({
        code: "CONFIG",
        message: "Unsupported auth type (not one of none, basic, oauth, bearer)",
      })
      expect(errorOf(result.stderr).hint).toContain(
        "A bearer token itself goes into PULSE_CLI_TOKEN or --auth-token-stdin",
      )
      expect(result.stderr).not.toContain(JWT)
      expect(result.requests).toEqual([])
    }
    expect(fileText(results[4]!.runtime, CONFIG_PATH)).toBeUndefined()
    // a mistyped type name is still quoted
    const typo = await cli(["task", "list", "--auth", "Bearer"])
    expect(errorOf(typo.stderr).message).toBe('Unsupported auth type "Bearer"')
  })

  it("refuses a token given to --auth-token-env without storing or repeating it", async () => {
    const token = "tok_SECRETabcdefghijklmnopqrstuvwxyz0123"
    const result = await cli(["config", "set", "p", "--auth", "bearer", "--auth-token-env", token])
    expect(result.code).toBe(3)
    expect(errorOf(result.stderr).message).toBe(
      "--auth-token-env names a variable that is not set and does not look like a variable name: it may be the token itself, so it is neither stored nor repeated",
    )
    expect(result.stdout + result.stderr).not.toContain(token)
    expect(fileText(result.runtime, CONFIG_PATH)).toBeUndefined()
    // a set variable in any form is stored; an unset name in the usual form only warns
    const set = await cli(["config", "set", "p", "--auth-token-env", "ci_token"], {
      env: { ci_token: "v" },
    })
    expect(set.code).toBe(0)
    const usual = await cli(["config", "set", "p", "--auth-token-env", "CI_ENGINE_TOKEN"])
    expect(usual.code).toBe(0)
    // a hand-edited file: an unusual unset name is not repeated either
    const files = { [CONFIG_PATH]: profiles({ p: { auth: { type: "bearer", tokenEnv: token } } }) }
    for (const args of [
      ["task", "list"],
      ["config", "show"],
      ["auth", "status"],
    ]) {
      const run = await cli(args, { files })
      expect(errorOf(run.stderr)).toMatchObject({
        code: "CONFIG",
        message: 'The token variable named by auth.tokenEnv of profile "p" is not set or empty',
      })
      expect(run.stderr).not.toContain(token)
    }
  })
})
