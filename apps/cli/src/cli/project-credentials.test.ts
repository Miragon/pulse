/**
 * A repository's project file names no credential: no resolver ever reads a variable it chose.
 * Per auth type a profile of the project file names the variable that would hold the secret, the
 * variable is set, and the command fails before any request leaves (the fake engine and the fake
 * authorization server record every request). A profile of the user's own config file of the same
 * name reads its variable, so the check is not vacuous.
 */

import { describe, expect, it } from "vitest"
import { BASE_URL, fakeServer, json } from "../../test/support/fake-fetch.js"
import { fakeIdp, ISSUER, routeFetch } from "../../test/support/fake-idp.js"
import {
  CONFIG_PATH,
  execute,
  fakeRuntime,
  type FakeRuntimeOptions,
} from "../../test/support/fake-runtime.js"
import { run } from "./run.js"

const REPO = "/home/tester/repo"
const PROJECT = `${REPO}/.pulse-cli.json`
const SECRET = "S3cret-from-the-environment"
const VARIABLE = "REPO_CHOSEN_VARIABLE"

/** Runs the CLI in the repository against the recording fake engine and authorization server. */
async function cli(args: readonly string[], options: FakeRuntimeOptions) {
  const engine = fakeServer()
    .on("GET", "/task", json([]))
    .on("GET", "/version", json({ version: "7.24.0" }))
  const idp = fakeIdp()
  const runtime = fakeRuntime({
    fetch: routeFetch(idp, engine.fetch),
    cwd: `${REPO}/src`,
    dirs: [`${REPO}/.git`],
    env: { [VARIABLE]: SECRET },
    ...options,
  })
  const outcome = await execute(run, args, runtime)
  return { ...outcome, requests: [...engine.requests, ...idp.requests] }
}

function profileFile(auth: Readonly<Record<string, unknown>>): string {
  return JSON.stringify({ profiles: { p: { url: BASE_URL, auth } } })
}

const AUTHS = [
  ["basic", { type: "basic", username: "demo", passwordEnv: VARIABLE }],
  ["oauth", { type: "oauth", issuer: ISSUER, clientId: "pulse-cli", clientSecretEnv: VARIABLE }],
  ["bearer", { type: "bearer", tokenEnv: VARIABLE }],
] as const

describe("a variable a project file names", () => {
  it.each(AUTHS)("is never read for %s auth: no request leaves", async (_type, auth) => {
    const files = { [PROJECT]: profileFile(auth) }
    for (const args of [["task", "list"], ["ping"], ["auth", "status"], ["config", "show"]]) {
      const result = await cli(args, { files })
      expect(result.code, args.join(" ")).toBe(3)
      expect(JSON.parse(result.stderr)).toMatchObject({
        error: {
          code: "CONFIG",
          message: expect.stringMatching(
            /^Profile "p" of the project file \S+ cannot be used: auth\.\w+Env is set, but a file others share names no credential/,
          ) as string,
        },
      })
      expect(result.requests).toEqual([])
      expect(`${result.stdout}${result.stderr}`).not.toContain(SECRET)
      expect(`${result.stdout}${result.stderr}`).not.toContain(VARIABLE)
    }
  })

  it("is read from a profile of the user's own config file of the same name", async () => {
    const [, basic] = AUTHS[0]
    const files = { [PROJECT]: profileFile(basic), [CONFIG_PATH]: profileFile(basic) }
    const result = await cli(["task", "list", "--profile", "p"], { files })
    expect(result.code).toBe(0)
    const [request] = result.requests
    expect(request?.headers.authorization).toBe(`Basic ${btoa(`demo:${SECRET}`)}`)
  })
})
