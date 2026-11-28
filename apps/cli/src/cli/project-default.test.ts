/**
 * The default of a repository whose project file names a profile your config file holds too,
 * through `run()`: your profile replaces the project's as a whole, so the project's default names
 * no profile of the project's any more. A command then fails (CONFIG) and sends nothing, unless
 * that profile is your own default too; it never falls back to your default (e.g. `prod`).
 */

import { describe, expect, it } from "vitest"
import { fakeServer, json } from "../../test/support/fake-fetch.js"
import {
  CONFIG_PATH,
  execute,
  fakeRuntime,
  type FakeRuntime,
} from "../../test/support/fake-runtime.js"
import { run } from "./run.js"

const REPO = "/home/tester/repo"
const PROJECT = `${REPO}/.pulse.json`
const PROJECT_X = "http://project-x/engine-rest"
const OWN_X = "http://own-x/engine-rest"
const PROD = "http://prod/engine-rest"

/** The project's default `x`, your own `x` and your default (`prod` unless named). */
function files(userDefault = "prod", project: object = { defaultProfile: "x" }) {
  return {
    [PROJECT]: JSON.stringify({ ...project, profiles: { x: { url: PROJECT_X } } }),
    [CONFIG_PATH]: JSON.stringify({
      defaultProfile: userDefault,
      profiles: { x: { url: OWN_X }, prod: { url: PROD } },
    }),
  }
}

function runtimeOf(options: { files: Record<string, string>; env?: Record<string, string> }) {
  const server = fakeServer().on("GET", "/task", json([]))
  const runtime = fakeRuntime({
    fetch: server.fetch,
    cwd: `${REPO}/src`,
    dirs: [`${REPO}/.git`],
    ...options,
  })
  return { runtime, server }
}

/** Runs `args` in the repository; the hosts the engine saw, in order. */
async function reached(runtime: FakeRuntime, args: readonly string[], sent: { url: string }[]) {
  runtime.stdout.chunks.length = 0
  runtime.stderr.chunks.length = 0
  const outcome = await execute(run, args, runtime)
  return { ...outcome, hosts: sent.map(({ url }) => new URL(url).host) }
}

function errorOf(stderr: string): Record<string, unknown> {
  return (JSON.parse(stderr) as { error: Record<string, unknown> }).error
}

const MESSAGE = `The default profile of the project file ${PROJECT} cannot be used: defaultProfile names "x", a profile your config file holds too and replaces as a whole.`
const HINT =
  "Choose a profile with --profile or PULSE_CLI_PROFILE (--profile x takes yours), or give --url, which selects no profile."

const NO_DEFAULT = `Notice: in this repository the project file ${PROJECT} gives no default: defaultProfile names "x", a profile your config file holds too and replaces as a whole. Use --profile or PULSE_CLI_PROFILE, or make "x" your default everywhere with \`pulse config use x\`.`

describe("a project default your config file replaces", () => {
  it("fails a command (CONFIG) and sends nothing, never reaching your default", async () => {
    const { runtime, server } = runtimeOf({ files: files() })
    const outcome = await reached(runtime, ["task", "list"], server.requests)
    expect(outcome.hosts).toEqual([])
    expect(outcome.code).toBe(3)
    expect(errorOf(outcome.stderr)).toMatchObject({ code: "CONFIG", message: MESSAGE, hint: HINT })
    // so does a project file whose only profile it is, without a defaultProfile
    const only = runtimeOf({ files: files("prod", {}) })
    const alone = await reached(only.runtime, ["task", "list"], only.server.requests)
    expect(alone.hosts).toEqual([])
    expect(errorOf(alone.stderr).message).toBe(
      MESSAGE.replace("defaultProfile names", "its only profile is"),
    )
  })

  it("reaches the profile a person names, and yours when it is your default too", async () => {
    const { runtime, server } = runtimeOf({ files: files() })
    expect(
      (await reached(runtime, ["task", "list", "--profile", "x"], server.requests)).hosts,
    ).toEqual(["own-x"])
    server.requests.length = 0
    const prod = await reached(runtime, ["task", "list", "--profile", "prod"], server.requests)
    expect(prod.hosts).toEqual(["prod"])
    const named = runtimeOf({ files: files(), env: { PULSE_CLI_PROFILE: "x" } })
    expect((await reached(named.runtime, ["task", "list"], named.server.requests)).hosts).toEqual([
      "own-x",
    ])
    const agreed = runtimeOf({ files: files("x") })
    expect((await reached(agreed.runtime, ["task", "list"], agreed.server.requests)).hosts).toEqual(
      ["own-x"],
    )
  })

  it("says so when config use or config set leaves the repository without a default", async () => {
    // your default "x" agrees with the project's, until you choose another one
    const { runtime, server } = runtimeOf({ files: files("x") })
    const use = await reached(runtime, ["config", "use", "prod"], server.requests)
    expect([use.code, use.stderr]).toEqual([0, `${NO_DEFAULT}\n`])
    const next = await reached(runtime, ["task", "list"], server.requests)
    expect([next.code, next.hosts]).toEqual([3, []])
    expect((await reached(runtime, ["config", "use", "x"], server.requests)).stderr).toBe("")
    // a profile "x" of yours, made after the project's, takes the project's default away
    const user = JSON.stringify({ defaultProfile: "prod", profiles: { prod: { url: PROD } } })
    const fresh = runtimeOf({ files: { ...files(), [CONFIG_PATH]: user } })
    const args = ["config", "set", "x", "--url", OWN_X]
    const set = await reached(fresh.runtime, args, fresh.server.requests)
    expect(set.code).toBe(0)
    expect(set.stderr).toContain(`as a whole: none of the project's settings of "x" apply.`)
    expect(set.stderr).toContain(`${NO_DEFAULT}\n`)
  })

  it("says so in config show and config list", async () => {
    const { runtime, server } = runtimeOf({ files: files() })
    const show = await reached(runtime, ["config", "show"], server.requests)
    expect(show.code).toBe(3)
    expect(errorOf(show.stderr).message).toBe(MESSAGE)
    const list = await reached(runtime, ["config", "list"], server.requests)
    expect(list.code).toBe(0)
    expect(list.stderr).toBe(
      `Notice: the project file ${PROJECT}: defaultProfile names "x", a profile your config file holds too and replaces as a whole.\n`,
    )
  })
})
