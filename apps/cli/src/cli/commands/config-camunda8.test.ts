/**
 * `pulse config set|unset` on a Camunda 8 profile of the user's config file through `run()`: no
 * single auth setting of its client credentials changes, no edit gives it an auth type its flavor
 * does not take, the CLI never sends a person to log in to a profile it refuses, and the way out
 * of the MCP server's passthrough leads to a profile the CLI uses.
 */

import { describe, expect, it } from "vitest"
import { ISSUER } from "../../../test/support/fake-idp.js"
import { CONFIG_PATH, execute, fakeRuntime, fileText } from "../../../test/support/fake-runtime.js"
import { run } from "../run.js"

const C8_URL = "https://c8.example.com/v2"

const PROFILES = {
  profiles: {
    c8: {
      url: C8_URL,
      flavor: "camunda8",
      auth: {
        type: "clientCredentials",
        tokenEndpoint: "https://login.example.com/oauth/token",
        audience: "zeebe-api",
      },
    },
    open: { url: C8_URL, flavor: "camunda8" },
    legacy: { url: C8_URL, flavor: "camunda8", auth: { type: "oauth", issuer: ISSUER } },
    gateway: { url: "http://engine:8080/engine-rest", auth: { type: "passthrough" } },
  },
}
const TEXT = `${JSON.stringify(PROFILES, null, 2)}\n`

async function cli(
  args: readonly string[],
  runtime = fakeRuntime({ files: { [CONFIG_PATH]: TEXT } }),
) {
  runtime.stdout.chunks.length = 0
  runtime.stderr.chunks.length = 0
  const result = await execute(run, args, runtime)
  return { ...result, file: fileText(runtime, CONFIG_PATH) }
}

function errorOf(stderr: string): Record<string, unknown> {
  const line = stderr.trim().split("\n").at(-1) ?? ""
  return (JSON.parse(line) as { error: Record<string, unknown> }).error
}

describe("config set and unset on a Camunda 8 profile", () => {
  it.each([
    [["config", "set", "c8", "--oauth-audience", "other"]],
    [["config", "set", "c8", "--auth", "basic", "--auth-user", "demo"]],
    [["config", "unset", "c8", "tokenEndpoint"]],
    [["config", "unset", "c8", "audience"]],
  ])("leaves its client credentials as the file has them: %j", async (args) => {
    const result = await cli(args)
    expect(result.code).toBe(3)
    expect(errorOf(result.stderr)).toMatchObject({
      code: "CONFIG",
      message: 'Profile "c8" signs in with clientCredentials, which the CLI does not edit',
    })
    expect(result.file).toBe(TEXT)
  })

  it("removes its whole auth object with unset auth", async () => {
    const result = await cli(["config", "unset", "c8", "auth"])
    expect(result.code).toBe(0)
    expect(JSON.parse(result.file ?? "{}")).toMatchObject({
      profiles: { c8: { url: C8_URL, flavor: "camunda8" } },
    })
  })

  it("gives it no OAuth login, which its flavor does not take", async () => {
    const result = await cli([
      "config",
      "set",
      "open",
      "--oauth-issuer",
      ISSUER,
      "--oauth-client-id",
      "pulse-cli",
    ])
    expect(result.code).toBe(3)
    expect(errorOf(result.stderr)).toMatchObject({
      code: "CONFIG",
      message: 'Profile "open" would sign in with oauth, which its flavor camunda8 does not take',
    })
    expect(result.file).toBe(TEXT)
  })

  it("sends no one to pulse auth login for a profile it refuses", async () => {
    const result = await cli(["config", "set", "legacy", "--oauth-client-id", "pulse-cli"])
    expect(result.code).toBe(0)
    expect(result.stderr).toContain("auth.type does not fit the API of the flavor")
    expect(result.stderr).not.toContain("pulse auth login")
  })
})

describe("the MCP server's passthrough in the user's config file", () => {
  it("leads by the way out of its refusal to a profile the CLI uses", async () => {
    const runtime = fakeRuntime({ files: { [CONFIG_PATH]: TEXT } })
    const refused = await cli(["config", "show", "--profile", "gateway"], runtime)
    expect(refused.code).toBe(3)
    const hint = String(errorOf(refused.stderr).hint)
    const command = /`pulse (config set gateway --auth) <type>`/.exec(hint)?.[1]
    expect(command).toBe("config set gateway --auth")
    const repaired = await cli([...(command ?? "").split(" "), "none"], runtime)
    expect(repaired.code).toBe(0)
    const shown = await cli(["config", "show", "--profile", "gateway"], runtime)
    expect(shown.code).toBe(0)
    expect(JSON.parse(repaired.file ?? "{}")).toMatchObject({
      profiles: { gateway: { auth: { type: "none" } } },
    })
  })
})
