/**
 * The warning on stderr when a URL without `--profile` (`--url` or PULSE_CLI_URL) leaves out the
 * PULSE_CLI_PROFILE the user set, through `run()`: one line, once per command, naming where the URL
 * came from and advising to drop each URL that is set, never `--profile` beside it; none for a
 * defaultProfile, beside `--profile` or without the variable. It never changes stdout, a JSON or a
 * table output, nor the exit code, and an error stays the last line.
 */

import { describe, expect, it } from "vitest"
import { errorOf as lastErrorOf, T0 } from "../../test/support/cli-auth.js"
import { workflowSetup } from "../../test/support/cli-workflow.js"
import { BASE_URL, fakeServer } from "../../test/support/fake-fetch.js"
import { fakeIdp, ISSUER, routeFetch } from "../../test/support/fake-idp.js"
import { CONFIG_PATH, execute, fakeRuntime } from "../../test/support/fake-runtime.js"
import { ADVANCE, PROFILE_FILE } from "../../test/support/no-profile.js"
import { ENGINE_URL, WorkflowEngine } from "../../test/support/workflow-engine.js"
import { run } from "./run.js"

/** The URL of the profile orders: beside --profile a --url of another origin fails. */
const ORDERS_URL = "https://orders.example.com/engine-rest"

const BY_FLAG =
  "Warning: PULSE_CLI_PROFILE=orders does not apply beside --url; drop --url to use it.\n"
const BY_VARIABLE =
  "Warning: PULSE_CLI_PROFILE=orders does not apply beside PULSE_CLI_URL; unset PULSE_CLI_URL to use it.\n"
/** Both give a URL: the flag wins, and the advice names both. */
const BY_BOTH =
  "Warning: PULSE_CLI_PROFILE=orders does not apply beside --url; drop --url and unset PULSE_CLI_URL to use it.\n"

/** One run of `args` on a fresh fake engine with the default profile and the given variables. */
async function runWith(args: readonly string[], env: Record<string, string>) {
  const { cli, engine } = workflowSetup(run, "approve", {
    env,
    files: { [CONFIG_PATH]: PROFILE_FILE },
  })
  return { ...(await cli(args)), engine }
}

describe("a URL without --profile beside PULSE_CLI_PROFILE", () => {
  it("warns once on stderr, naming --url, and leaves stdout and the exit code as they are", async () => {
    for (const output of [[], ["-o", "json"], ["-o", "table"]]) {
      const args = [...ADVANCE, "--url", ENGINE_URL, ...output]
      const warned = await runWith(args, { PULSE_CLI_PROFILE: "orders" })
      const quiet = await runWith(args, {})
      expect(warned.stderr).toBe(BY_FLAG)
      expect(quiet.stderr).toBe("")
      expect(warned.stdout).toBe(quiet.stdout)
      expect(warned.stdout.length).toBeGreaterThan(0)
      expect(warned.code).toBe(quiet.code)
      expect(warned.engine.stage).toBe("book")
    }
  })

  it("advises unsetting PULSE_CLI_URL when it gives the URL, and dropping both when both do", async () => {
    const env = { PULSE_CLI_URL: ENGINE_URL }
    const warned = await runWith(ADVANCE, { ...env, PULSE_CLI_PROFILE: "orders" })
    const quiet = await runWith(ADVANCE, env)
    expect(warned.stderr).toBe(BY_VARIABLE)
    expect(warned.stdout).toBe(quiet.stdout)
    expect(warned.code).toBe(0)
    const both = await runWith([...ADVANCE, "--url", ENGINE_URL], {
      ...env,
      PULSE_CLI_PROFILE: "orders",
    })
    expect(both.stderr).toBe(BY_BOTH)
    // a blank PULSE_CLI_URL is none: only --url gives the URL, and only it has to go
    const blank = await runWith([...ADVANCE, "--url", ENGINE_URL], {
      PULSE_CLI_URL: " ",
      PULSE_CLI_PROFILE: "orders",
    })
    expect(blank.stderr).toBe(BY_FLAG)
  })

  it("says nothing for a defaultProfile, beside --profile, or without a URL", async () => {
    expect((await runWith([...ADVANCE, "--url", ENGINE_URL], {})).stderr).toBe("")
    const named = ["inspect", "pi-1", "--profile", "orders", "--url", ORDERS_URL]
    expect((await runWith(named, { PULSE_CLI_PROFILE: "basic" })).stderr).toBe("")
    const variable = { PULSE_CLI_URL: ENGINE_URL, PULSE_CLI_PROFILE: "basic" }
    expect((await runWith(["inspect", "pi-1", "--profile", "orders"], variable)).stderr).toBe("")
    const own = { PULSE_CLI_PROFILE: "orders", PULSE_CLI_URL: " " }
    const refused = await runWith([...ADVANCE, "-o", "json"], own)
    expect(lastErrorOf(refused.stderr)).toMatchObject({ code: "READ_ONLY" })
    expect(refused.stderr.split("\n")).toHaveLength(2)
  })

  it("names no value that is no profile name", async () => {
    const odd = await runWith([...ADVANCE, "--url", ENGINE_URL], { PULSE_CLI_PROFILE: "a b" })
    expect(odd.stderr).toBe(
      "Warning: PULSE_CLI_PROFILE does not apply beside --url; drop --url to use it.\n",
    )
  })

  it("comes before an error, which stays the last line with its exit code", async () => {
    const server = fakeServer().on(
      "GET",
      "/process-instance/pi-1",
      new Response("", { status: 401 }),
    )
    const outcome = async (env: Record<string, string>) => {
      const runtime = fakeRuntime({
        fetch: server.fetch,
        env,
        files: { [CONFIG_PATH]: PROFILE_FILE },
      })
      return execute(run, ["process-instance", "get", "pi-1", "--url", BASE_URL], runtime)
    }
    const warned = await outcome({ PULSE_CLI_PROFILE: "orders" })
    const quiet = await outcome({})
    expect(warned.code).toBe(quiet.code)
    expect(warned.stdout).toBe(quiet.stdout)
    // the 401 names what the URL leaves out (PULSE_CLI_PROFILE here, the default profile there)
    const [notice, error, end] = warned.stderr.split("\n")
    expect(`${notice ?? ""}\n`).toBe(BY_FLAG)
    expect(JSON.parse(error ?? "")).toMatchObject({ error: { code: "UNAUTHORIZED", exitCode: 4 } })
    expect(end).toBe("")
    expect(lastErrorOf(quiet.stderr)).toMatchObject({ code: "UNAUTHORIZED" })
  })
})

describe("a URL without --profile beside PULSE_CLI_PROFILE and a configuration that fails", () => {
  /**
   * The run with the variable writes the line once and first, then the CONFIG error of the run
   * without it as its last line (a hint may name PULSE_CLI_PROFILE as what the URL leaves out).
   */
  async function compare(args: readonly string[], env: Record<string, string>) {
    const base = { PULSE_CLI_URL: ENGINE_URL, ...env }
    const warned = await runWith(args, { ...base, PULSE_CLI_PROFILE: "orders" })
    const quiet = await runWith(args, base)
    expect(warned.stderr.startsWith(BY_VARIABLE)).toBe(true)
    expect(warned.stderr.split(BY_VARIABLE)).toHaveLength(2)
    expect(warned.stderr.slice(BY_VARIABLE.length).split("\n")).toHaveLength(2)
    expect(quiet.stderr.split("\n")).toHaveLength(2)
    const { code, exitCode, message } = lastErrorOf(quiet.stderr)
    expect(code).toBe("CONFIG")
    expect(lastErrorOf(warned.stderr)).toMatchObject({ code, exitCode, message })
    expect(warned.stdout).toBe(quiet.stdout)
    expect([warned.code, quiet.code]).toEqual([3, 3])
  }

  it("warns before the error of a resolution that fails", async () => {
    const failing = [
      { PULSE_CLI_AUTH: "basic" },
      { PULSE_CLI_AUTH: "oauth" },
      { PULSE_CLI_TIMEOUT: "abc" },
      { PULSE_CLI_OUTPUT: "xml" },
    ]
    for (const env of failing) await compare(ADVANCE, env)
  })

  it("warns once before the CONFIG error of the auth commands", async () => {
    for (const command of ["login", "status", "logout"]) {
      await compare(["auth", command], { PULSE_CLI_AUTH: "basic" })
    }
    await compare(["auth", "logout"], { PULSE_CLI_OUTPUT: "xml" })
  })
})

describe("the auth commands beside PULSE_CLI_PROFILE", () => {
  /** The OAuth login of the environment, its commands under PULSE_CLI_URL, the profile `env` adds. */
  async function flow(env: Record<string, string>) {
    const idp = fakeIdp()
    const engine = new WorkflowEngine("approve")
    const runtime = fakeRuntime({
      fetch: routeFetch(idp, engine.fetch),
      now: () => T0,
      env: {
        PULSE_CLI_URL: ENGINE_URL,
        PULSE_CLI_AUTH: "oauth",
        PULSE_CLI_OAUTH_ISSUER: ISSUER,
        PULSE_CLI_OAUTH_CLIENT_ID: "pulse-cli",
        ...env,
      },
      files: { [CONFIG_PATH]: PROFILE_FILE },
      browser: async (url, fake) => {
        await fake.loopback.request("/callback", idp.authorize(url))
        return true
      },
    })
    const steps: { code: number; stdout: string; stderr: string }[] = []
    for (const args of [
      ["auth", "status"],
      ["auth", "login"],
      ["auth", "status"],
      ["auth", "logout"],
    ]) {
      runtime.stdout.chunks.length = 0
      runtime.stderr.chunks.length = 0
      const { code, stdout, stderr } = await execute(run, args, runtime)
      steps.push({ code, stdout, stderr })
    }
    return steps
  }

  it("warn once each under PULSE_CLI_URL, with stdout and exit codes as they are", async () => {
    const warned = await flow({ PULSE_CLI_PROFILE: "orders" })
    const quiet = await flow({})
    expect(lastErrorOf(warned[0]?.stderr ?? "")).toMatchObject({ code: "LOGIN_REQUIRED" })
    warned.forEach((step, index) => {
      const other = quiet[index]
      expect(step.stderr.startsWith(BY_VARIABLE)).toBe(true)
      expect(step.stderr.split(BY_VARIABLE)).toHaveLength(2)
      expect(step.stderr.slice(BY_VARIABLE.length)).toBe(other?.stderr)
      expect(step.stdout).toBe(other?.stdout)
      expect(step.code).toBe(other?.code)
    })
  })
})
