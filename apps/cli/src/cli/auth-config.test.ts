/** The config commands with Basic auth credentials, through `run()`. */

import { describe, expect, it } from "vitest"
import { cliOf, errorOf, profiles } from "../../test/support/cli-basic-auth.js"
import { CONFIG_PATH, fileText } from "../../test/support/fake-runtime.js"
import { run } from "./run.js"

const cli = cliOf(run)

describe("config commands", () => {
  const setBasic = ["config", "set", "p", "--auth", "basic", "--auth-user", "demo"]
  const UNSET_WARNING =
    "Warning: the variable named by --auth-password-env is not set in this environment. Pass the name of a variable that holds the password (e.g. CAMUNDA_PASSWORD), never the password itself; commands read it when they run.\n"
  const REPLACED_NOTICE =
    "Notice: removed the Authorization header of the profile; Basic auth replaces it.\n"

  it("stores Basic auth with a password variable", async () => {
    const result = await cli([...setBasic, "--auth-password-env", "CAMUNDA_PASSWORD"], {
      env: { CAMUNDA_PASSWORD: "x" },
    })
    expect(result).toMatchObject({ code: 0, stderr: "" })
    const auth = { type: "basic", username: "demo", passwordEnv: "CAMUNDA_PASSWORD" }
    expect(JSON.parse(result.stdout)).toEqual({ name: "p", default: true, auth })
    expect(JSON.parse(fileText(result.runtime, CONFIG_PATH) ?? "")).toEqual({
      defaultProfile: "p",
      profiles: { p: { auth } },
    })
  })

  it("stores a literal password from stdin with a warning, and masks it in the output", async () => {
    const result = await cli(
      ["config", "set", "p", "--auth-user", "demo", "--auth-password-stdin"],
      {
        stdin: "pa:ss wörd\n",
      },
    )
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      name: "p",
      default: true,
      auth: { username: "demo", password: "***" },
    })
    expect(result.stderr).toBe(
      `Warning: the password is stored in plain text in ${CONFIG_PATH} (mode 0600). Prefer --auth-password-env <VAR>, which stores only the name of an environment variable.\n`,
    )
    expect(result.runtime.files.get(CONFIG_PATH)?.mode).toBe(0o600)
    expect(JSON.parse(fileText(result.runtime, CONFIG_PATH) ?? "")).toMatchObject({
      profiles: { p: { auth: { username: "demo", password: "pa:ss wörd" } } },
    })
  })

  it("warns, without naming it, when the password variable is not set here", async () => {
    for (const env of [{}, { CAMUNDA_PW_2: " " }]) {
      const result = await cli([...setBasic, "--auth-password-env", " CAMUNDA_PW_2 "], { env })
      expect(result.code).toBe(0)
      expect(result.stderr).toBe(UNSET_WARNING)
      expect(result.stderr).not.toContain("CAMUNDA_PW_2")
    }
    const other = await cli(["config", "set", "p", "--auth-user", "demo"], { env: {} })
    expect(other.stderr).toBe("")
    const set = await cli([...setBasic, "--auth-password-env", " PW "], { env: { PW: "x" } })
    expect(set).toMatchObject({ code: 0, stderr: "" })
  })

  it("refuses a password given to --auth-password-env without storing or repeating it", async () => {
    const password = "S3cr3tPW"
    for (const env of [{}, { S3cr3tPW: " " }]) {
      const result = await cli([...setBasic, "--auth-password-env", ` ${password} `], { env })
      expect(result.code).toBe(3)
      expect(errorOf(result.stderr)).toMatchObject({
        code: "CONFIG",
        message:
          "--auth-password-env names a variable that is not set and does not look like a variable name: it may be the password itself, so it is neither stored nor repeated",
      })
      expect(result.stdout + result.stderr).not.toContain(password)
      expect(fileText(result.runtime, CONFIG_PATH)).toBeUndefined()
    }
    // a set variable in any form is stored without a warning
    const set = await cli([...setBasic, "--auth-password-env", password], {
      env: { [password]: "x" },
    })
    expect(set).toMatchObject({ code: 0, stderr: "" })
    // a hand-edited file: an unusual unset name is not repeated either
    const files = {
      [CONFIG_PATH]: profiles({ p: { auth: { username: "demo", passwordEnv: password } } }),
    }
    for (const args of [
      ["task", "list"],
      ["config", "show"],
      ["ping", "--dry-run"],
    ]) {
      const run = await cli(args, { files })
      expect(errorOf(run.stderr)).toMatchObject({
        code: "CONFIG",
        message:
          'The password variable named by auth.passwordEnv of profile "p" is not set or empty',
      })
      expect(run.stdout + run.stderr).not.toContain(password)
    }
  })

  it("replaces a stored Authorization header with Basic auth, keeping other headers", async () => {
    const file = profiles({
      p: { url: "http://x", headers: { authorization: "Basic eDp5", "X-Tenant": "a" } },
    })
    const result = await cli([...setBasic, "--auth-password-env", "PW"], {
      files: { [CONFIG_PATH]: file },
      env: { PW: "x" },
    })
    expect(result.code).toBe(0)
    expect(result.stderr).toBe(REPLACED_NOTICE)
    expect(JSON.parse(fileText(result.runtime, CONFIG_PATH) ?? "")).toEqual({
      defaultProfile: "p",
      profiles: {
        p: {
          url: "http://x",
          auth: { type: "basic", username: "demo", passwordEnv: "PW" },
          headers: { "X-Tenant": "a" },
        },
      },
    })
    const ping = await cli(["ping", "--dry-run"], {
      files: { [CONFIG_PATH]: fileText(result.runtime, CONFIG_PATH) ?? "" },
      env: { PW: "x" },
    })
    expect(ping.code).toBe(0)
  })

  it("refuses an Authorization header for a profile with Basic auth", async () => {
    const file = profiles({ p: { auth: { username: "demo", passwordEnv: "PW" } } })
    const result = await cli(["config", "set", "p", "-H", "Authorization: Bearer t"], {
      files: { [CONFIG_PATH]: file },
    })
    expect(result.code).toBe(3)
    expect(errorOf(result.stderr)).toMatchObject({
      code: "CONFIG",
      message: 'Profile "p" would have both Basic auth and an Authorization header',
    })
    expect(fileText(result.runtime, CONFIG_PATH)).toBe(file)
    const both = await cli([...setBasic, "-H", "authorization: Bearer t"], {})
    expect(both.code).toBe(3)
    expect(both.runtime.files.has(CONFIG_PATH)).toBe(false)
    const off = await cli(
      ["config", "set", "p", "--auth", "none", "-H", "Authorization: Bearer t"],
      {
        files: { [CONFIG_PATH]: file },
      },
    )
    expect(off).toMatchObject({ code: 0, stderr: "" })
  })

  it("refuses a password variable and a password from stdin together", async () => {
    const result = await cli(
      ["config", "set", "p", "--auth-password-env", "PW", "--auth-password-stdin"],
      { stdin: "x\n" },
    )
    expect(result.code).toBe(3)
    expect(result.runtime.files.has(CONFIG_PATH)).toBe(false)
  })

  it("shows type, username and password with their sources, the password masked", async () => {
    const file = profiles({ p: { auth: { username: "demo", passwordEnv: "PW" } } })
    const options = { files: { [CONFIG_PATH]: file }, env: { PW: "top-secret" } }
    const result = await cli(["config", "show"], options)
    expect(JSON.parse(result.stdout)).toMatchObject({
      values: {
        auth: { value: "basic", source: "profile" },
        username: { value: "demo", source: "profile" },
        password: { value: "***", source: "profile" },
      },
    })
    expect(result.stdout).not.toContain("top-secret")
    const shown = await cli(["config", "show", "--show-secrets"], options)
    expect(JSON.parse(shown.stdout)).toMatchObject({
      values: { password: { value: "top-secret", source: "profile" } },
    })
    const flags = await cli(["config", "show", "--auth-user", "cli", "--auth-password-stdin"], {
      ...options,
      stdin: "from-stdin\n",
    })
    expect(JSON.parse(flags.stdout)).toMatchObject({
      values: {
        username: { value: "cli", source: "flag" },
        password: { value: "***", source: "flag" },
      },
    })
  })

  it("removes all auth settings with unset auth", async () => {
    const file = profiles({ p: { url: "http://x", auth: { username: "demo", password: "pw" } } })
    const result = await cli(["config", "unset", "p", "auth"], { files: { [CONFIG_PATH]: file } })
    expect(result.code).toBe(0)
    expect(JSON.parse(fileText(result.runtime, CONFIG_PATH) ?? "")).toEqual({
      defaultProfile: "p",
      profiles: { p: { url: "http://x" } },
    })
  })
})
