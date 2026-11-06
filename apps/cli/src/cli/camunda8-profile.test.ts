/**
 * A Camunda 8 profile, which only Pulse for VS Code reads, end to end through `run()`: as the
 * default of the project file or of the user's config file it leaves the commands that need no
 * engine running, every command that uses it refuses it by name and says why it was selected,
 * whatever --flavor or PULSE_CLI_FLAVOR say, and `config set` does not edit its client
 * credentials.
 */

import { describe, expect, it } from "vitest"
import { BASE_URL, fakeServer, json } from "../../test/support/fake-fetch.js"
import {
  CONFIG_PATH,
  execute,
  fakeRuntime,
  type FakeRuntimeOptions,
  fileText,
} from "../../test/support/fake-runtime.js"
import { run } from "./run.js"

const REPO = "/home/tester/repo"
const PROJECT = `${REPO}/.pulse-cli.json`
const C8 = {
  url: "http://localhost:8080/v2",
  flavor: "camunda8",
  cockpitUrl: "http://localhost:8080/operate",
}
const C8_DEFAULT = JSON.stringify({
  defaultProfile: "c8",
  profiles: { c8: C8, c7: { url: BASE_URL } },
})

const REFUSED = 'Profile "c8" names Camunda 8, which the CLI does not support'
const READS_IT = "Pulse for VS Code reads such profiles."
const PROJECT_DEFAULT = `It is the defaultProfile of the project file ${PROJECT}; choose another one with \`pulse config use <profile> --project\`. ${READS_IT}`
const USER_DEFAULT = `It is the defaultProfile of the config file; choose another one with \`pulse config use <profile>\`. ${READS_IT}`

/** A runtime in a repository whose engine answers ping, and the server that records requests. */
function setup(files: Record<string, string>, options: FakeRuntimeOptions = {}) {
  const server = fakeServer()
    .on("GET", "/version", json({ version: "7.24.0" }))
    .on("GET", "/engine", json([{ name: "default" }]))
  const runtime = fakeRuntime({
    fetch: server.fetch,
    cwd: `${REPO}/src`,
    dirs: [`${REPO}/.git`],
    files,
    ...options,
  })
  return { server, runtime }
}

async function cli(
  args: readonly string[],
  files: Record<string, string>,
  options: FakeRuntimeOptions = {},
) {
  const { server, runtime } = setup(files, options)
  return { ...(await execute(run, args, runtime)), requests: server.requests }
}

function errorOf(stderr: string): Record<string, unknown> {
  return (JSON.parse(stderr) as { error: Record<string, unknown> }).error
}

function named(commands: readonly (readonly string[])[]) {
  return commands.map((args) => [args.join(" "), args] as const)
}

describe.each([
  ["the project file", PROJECT, ["--project"], PROJECT_DEFAULT],
  ["the user's config file", CONFIG_PATH, [], USER_DEFAULT],
] as const)("a Camunda 8 profile as the default of %s", (_, path, project, hint) => {
  const files = { [path]: C8_DEFAULT }

  it.each(
    named([
      ["--version"],
      ["--help"],
      ["guide"],
      ["commands", "-o", "json"],
      ["config", "list"],
      ["config", "path"],
      ["config", "path", "--project"],
      ["config", "use", "c7", ...project],
      ["config", "set", "c7", ...project, "--default"],
      ["config", "unset", "c8", "cockpitUrl", ...project],
      ["config", "delete", "c8", ...project],
    ]),
  )("leaves `pulse %s` running", async (_name, args) => {
    const result = await cli(args, files)
    expect(result.code, result.stderr).toBe(0)
  })

  it.each(
    named([["ping"], ["config", "show"], ["task", "list"], ["auth", "status"], ["auth", "logout"]]),
  )("refuses the profile by name in `pulse %s`", async (_name, args) => {
    const result = await cli(args, files)
    expect(result.code).toBe(3)
    expect(errorOf(result.stderr)).toMatchObject({ code: "CONFIG", message: REFUSED, hint })
    expect(result.requests).toEqual([])
  })

  it.each([
    [["ping", "--flavor", "operaton"], {}],
    [["ping"], { PULSE_CLI_FLAVOR: "cibseven" }],
    [["config", "show", "--flavor", "camunda7"], {}],
    [["task", "list", "--profile", "c8", "--flavor", "operaton"], { PULSE_CLI_FLAVOR: "camunda7" }],
  ])("is refused for %j whatever the flavor, with %j", async (args, env) => {
    const result = await cli(args, files, { env })
    expect(result.code).toBe(3)
    expect(errorOf(result.stderr).message).toBe(REFUSED)
    expect(result.requests).toEqual([])
  })

  it("names --profile and PULSE_CLI_PROFILE when they select it", async () => {
    const flag = await cli(["ping", "--profile", "c8"], files)
    expect(errorOf(flag.stderr)).toMatchObject({ message: REFUSED, hint: READS_IT })
    const env = await cli(["ping"], files, { env: { PULSE_CLI_PROFILE: "c8" } })
    expect(errorOf(env.stderr)).toMatchObject({
      message: REFUSED,
      hint: `It is selected by PULSE_CLI_PROFILE. ${READS_IT}`,
    })
  })

  it("lets --profile and PULSE_CLI_PROFILE pick a Camunda 7 profile", async () => {
    expect((await cli(["ping", "--profile", "c7"], files)).code).toBe(0)
    expect((await cli(["ping"], files, { env: { PULSE_CLI_PROFILE: "c7" } })).code).toBe(0)
  })

  it("is left behind by `config use <profile>`, as the hint says", async () => {
    const { server, runtime } = setup(files)
    expect((await execute(run, ["config", "use", "c7", ...project], runtime)).code).toBe(0)
    expect(JSON.parse(fileText(runtime, path) ?? "")).toMatchObject({ defaultProfile: "c7" })
    expect((await execute(run, ["ping"], runtime)).code).toBe(0)
    expect(server.requests.map((request) => request.path)).toContain("/version")
  })
})

const AUTH = {
  type: "clientCredentials",
  tokenEndpoint: "https://login.cloud.camunda.io/oauth/token",
  audience: "zeebe.camunda.io",
}
const SAAS_FILE = `${JSON.stringify(
  {
    defaultProfile: "c7",
    profiles: {
      saas: { url: "https://bru-2.api.camunda.io/v2", flavor: "camunda8", auth: AUTH },
      c7: { url: BASE_URL },
    },
  },
  null,
  2,
)}\n`
const TARGETS = [
  ["the project file", PROJECT, ["--project"]],
  ["the user's config file", CONFIG_PATH, []],
] as const

describe("config set on a profile whose auth type the CLI does not know", () => {
  it.each(
    named([
      ["--oauth-audience", "other.camunda.io"],
      ["--oauth-scopes", "a b"],
      ["--oauth-issuer", "https://login.example.com"],
      ["--oauth-client-id", "pulse"],
      ["--auth", "none"],
      ["--auth", "oauth"],
      ["--auth-user", "demo"],
      ["--auth", "bearer", "--auth-token-env", "CI_TOKEN"],
    ]),
  )("refuses `%s` and writes nothing", async (_name, options) => {
    for (const [target, path, project] of TARGETS) {
      const { runtime } = setup({ [path]: SAAS_FILE })
      const result = await execute(run, ["config", "set", "saas", ...project, ...options], runtime)
      expect(result.code, target).toBe(3)
      expect(errorOf(result.stderr), target).toMatchObject({
        code: "CONFIG",
        message: 'Profile "saas" has an unknown auth type',
        hint: "Edit its auth in the file.",
      })
      expect(fileText(runtime, path), target).toBe(SAAS_FILE)
    }
  })

  it("edits its other values and keeps its auth", async () => {
    for (const [target, path, project] of TARGETS) {
      const { runtime } = setup({ [path]: SAAS_FILE })
      const args = ["config", "set", "saas", ...project, "--url", "https://x.camunda.io/v2"]
      expect((await execute(run, args, runtime)).code, target).toBe(0)
      expect(JSON.parse(fileText(runtime, path) ?? ""), target).toMatchObject({
        profiles: { saas: { url: "https://x.camunda.io/v2", flavor: "camunda8", auth: AUTH } },
      })
    }
  })
})
