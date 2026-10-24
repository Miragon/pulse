import { describe, expect, it } from "vitest"
import {
  CONFIG_PATH,
  execute,
  fakeRuntime,
  type FakeRuntime,
  type FakeRuntimeOptions,
  fileText,
} from "../../../test/support/fake-runtime.js"
import { run } from "../run.js"

const URL_A = "http://a:8080/engine-rest"
const URL_B = "http://b:8080/engine-rest"

function cli(args: readonly string[], options: FakeRuntimeOptions = {}) {
  return execute(run, args, fakeRuntime(options))
}

function stored(runtime: FakeRuntime, path = CONFIG_PATH): unknown {
  const content = fileText(runtime, path)
  return content === undefined ? undefined : JSON.parse(content)
}

function errorOf(stderr: string): Record<string, unknown> {
  return (JSON.parse(stderr) as { error: Record<string, unknown> }).error
}

/** Runs the commands one after the other on the same runtime; returns the last outcome. */
async function sequence(runtime: FakeRuntime, ...commands: (readonly string[])[]) {
  let last = await execute(run, [], runtime)
  for (const args of commands) {
    runtime.stdout.chunks.length = 0
    runtime.stderr.chunks.length = 0
    last = await execute(run, args, runtime)
    expect(last.code, `${args.join(" ")}: ${last.stderr}`).toBe(0)
  }
  return last
}

describe("config path", () => {
  it("prints the default location as JSON or plain line", async () => {
    expect((await cli(["config", "path"])).stdout).toBe(`{"path":"${CONFIG_PATH}"}\n`)
    expect((await cli(["config", "path"], { stdoutTTY: true })).stdout).toBe(`${CONFIG_PATH}\n`)
    expect((await cli(["config", "path", "-o", "table"])).stdout).toBe(`${CONFIG_PATH}\n`)
    expect((await cli(["config", "path"], { env: { OPERATE_OUTPUT: "table" } })).stdout).toBe(
      `${CONFIG_PATH}\n`,
    )
  })

  it("follows --config and OPERATE_CONFIG", async () => {
    const env = { OPERATE_CONFIG: "/env.json", OPERATE_OUTPUT: " " }
    expect((await cli(["config", "path"], { env })).stdout).toBe('{"path":"/env.json"}\n')
    expect((await cli(["config", "path", "--config", "/flag.json"], { env })).stdout).toBe(
      '{"path":"/flag.json"}\n',
    )
  })

  it("rejects an unknown output format", async () => {
    const result = await cli(["config", "path", "-o", "yaml"])
    expect(result.code).toBe(3)
    expect(errorOf(result.stderr)).toMatchObject({ message: 'Unknown output format "yaml"' })
  })
})

describe("config set", () => {
  it("creates the file with mode 0600 and makes the first profile the default", async () => {
    const result = await cli(["config", "set", "local", "--url", `${URL_A}/`])
    expect(result).toMatchObject({
      code: 0,
      stdout: `{"name":"local","default":true,"url":"${URL_A}"}\n`,
      stderr: "",
    })
    expect(result.runtime.files.get(CONFIG_PATH)?.mode).toBe(0o600)
    expect(result.runtime.dirs.has("/home/tester/.config/operate")).toBe(true)
    expect(stored(result.runtime)).toEqual({
      defaultProfile: "local",
      profiles: { local: { url: URL_A } },
    })
  })

  it("stores every option, masks header values in the output and keeps them in the file", async () => {
    const result = await cli([
      "config",
      "set",
      "prod",
      "--url",
      URL_B,
      "--engine",
      "second",
      "--auth",
      "none",
      "--output",
      "table",
      "--timeout",
      "5000",
      "-H",
      "Authorization: Bearer abc",
      "--header",
      "X-Tenant: t1",
      "--read-only",
      "--config",
      "/c.json",
    ])
    expect(result.code).toBe(0)
    const profile = {
      url: URL_B,
      engine: "second",
      auth: { type: "none" },
      output: "table",
      timeout: 5000,
      headers: { Authorization: "Bearer abc", "X-Tenant": "t1" },
      readOnly: true,
    }
    expect(stored(result.runtime, "/c.json")).toEqual({
      defaultProfile: "prod",
      profiles: { prod: profile },
    })
    expect(JSON.parse(result.stdout)).toEqual({
      name: "prod",
      default: true,
      ...profile,
      headers: { Authorization: "Bearer ***", "X-Tenant": "t1" },
    })
  })

  it("changes only the given values and switches the default with --default", async () => {
    const runtime = fakeRuntime()
    await sequence(
      runtime,
      ["config", "set", "a", "--url", URL_A, "--read-only"],
      ["config", "set", "b", "--url", URL_B],
    )
    expect(stored(runtime)).toMatchObject({ defaultProfile: "a" })
    const last = await sequence(
      runtime,
      ["config", "set", "a", "--no-read-only"],
      ["config", "set", "b", "--default"],
    )
    expect(stored(runtime)).toEqual({
      defaultProfile: "b",
      profiles: { a: { url: URL_A, readOnly: false }, b: { url: URL_B } },
    })
    expect(last.stdout).toBe(`{"name":"b","default":true,"url":"${URL_B}"}\n`)
  })

  it("prints the profile as table on a terminal", async () => {
    const result = await cli(["config", "set", "local", "--url", URL_A], { stdoutTTY: true })
    expect(result.stdout).toBe(`FIELD    VALUE\nname     local\ndefault  true\nurl      ${URL_A}\n`)
  })

  it("prints with -o, while --output is the stored profile value", async () => {
    const result = await cli([
      "config",
      "set",
      "local",
      "--url",
      URL_A,
      "--output",
      "json",
      "-o",
      "table",
    ])
    expect(result.stdout).toBe(
      `FIELD    VALUE\nname     local\ndefault  true\nurl      ${URL_A}\noutput   json\n`,
    )
    expect(stored(result.runtime)).toMatchObject({ profiles: { local: { output: "json" } } })
    // --output never chooses how config set prints: JSON in a pipe
    const piped = await cli(["config", "set", "local", "--output", "table"])
    expect(JSON.parse(piped.stdout)).toEqual({ name: "local", default: true, output: "table" })
  })

  it("takes -o before the command path, too", async () => {
    const result = await cli(["-o", "table", "config", "set", "local", "--url", URL_A])
    expect(result.stdout).toMatch(/^FIELD +VALUE\n/)
    expect(stored(result.runtime)).toEqual({
      defaultProfile: "local",
      profiles: { local: { url: URL_A } },
    })
  })

  it("renders errors in the -o format, never in the format of --output", async () => {
    const unknown = await cli(["config", "set", "local", "--output", "table", "--bogus"])
    expect(errorOf(unknown.stderr)).toMatchObject({ message: 'Unknown option "--bogus"' })
    const table = await cli(["config", "set", "local", "-o", "table", "--url", "ftp://x"])
    expect(table.stderr).toMatch(/^Error: Engine URL must start with http/)
    const invalid = await cli(["config", "set", "local", "-o", "yaml"])
    expect(errorOf(invalid.stderr)).toMatchObject({ message: 'Unknown output format "yaml"' })
    expect(invalid.runtime.files.size).toBe(0)
  })

  it("rejects invalid values without writing the file", async () => {
    const result = await cli(["config", "set", "local", "--url", "ftp://x"])
    expect(result.code).toBe(3)
    expect(errorOf(result.stderr)).toMatchObject({
      code: "CONFIG",
      message: 'Engine URL must start with http:// or https://, got "ftp://x"',
    })
    expect(result.runtime.files.size).toBe(0)
  })

  it("rejects an invalid profile name", async () => {
    const result = await cli(["config", "set", "-bad", "--url", URL_A])
    expect(result.code).toBe(2)
    const named = await cli(["config", "set", "a b", "--url", URL_A])
    expect(errorOf(named.stderr)).toMatchObject({ message: 'Invalid profile name "a b"' })
  })
})

describe("config unset, use, delete and list", () => {
  async function prepared() {
    const runtime = fakeRuntime()
    await sequence(
      runtime,
      ["config", "set", "a", "--url", URL_A, "--engine", "e1", "-H", "X-A: 1"],
      ["config", "set", "b", "--url", URL_B, "--read-only"],
    )
    return runtime
  }

  it("removes keys from a profile", async () => {
    const runtime = await prepared()
    const result = await sequence(runtime, ["config", "unset", "a", "engine", "header"])
    expect(result.stdout).toBe(`{"name":"a","default":true,"url":"${URL_A}"}\n`)
    expect(stored(runtime)).toMatchObject({ profiles: { a: { url: URL_A } } })
  })

  it("prints unset, use and delete results in the -o format", async () => {
    const runtime = await prepared()
    const unset = await sequence(runtime, ["config", "unset", "a", "engine", "-o", "table"])
    expect(unset.stdout).toMatch(/^FIELD +VALUE\nname +a\n/)
    const use = await sequence(runtime, ["config", "use", "b", "--output", "table"])
    expect(use.stdout).toMatch(/^FIELD +VALUE\nname +b\n/)
    const missing = await execute(run, ["config", "delete", "c", "-o", "table"], runtime)
    expect(missing.stderr).toMatch(/^Error: Profile "c" does not exist\n/)
  })

  it("rejects unknown keys", async () => {
    const runtime = await prepared()
    const result = await execute(run, ["config", "unset", "a", "colour"], runtime)
    expect(result.code).toBe(3)
    expect(errorOf(result.stderr)).toMatchObject({ message: 'Unknown profile key "colour"' })
  })

  it("switches the default profile", async () => {
    const runtime = await prepared()
    const result = await sequence(runtime, ["config", "use", "b"])
    expect(result.stdout).toBe(`{"name":"b","default":true,"url":"${URL_B}","readOnly":true}\n`)
    expect(stored(runtime)).toMatchObject({ defaultProfile: "b" })
  })

  it("refuses to use a missing profile", async () => {
    const runtime = await prepared()
    const result = await execute(run, ["config", "use", "c"], runtime)
    expect(result.code).toBe(3)
    expect(errorOf(result.stderr)).toMatchObject({
      code: "CONFIG",
      message: 'Profile "c" does not exist',
    })
  })

  it("deletes a profile and clears the default", async () => {
    const runtime = await prepared()
    const result = await sequence(runtime, ["config", "delete", "a"])
    expect(result.stdout).toBe("")
    expect(result.stderr).toBe(`Deleted profile "a" from ${CONFIG_PATH}\n`)
    expect(stored(runtime)).toEqual({ profiles: { b: { url: URL_B, readOnly: true } } })
  })

  it("lists the profiles", async () => {
    const runtime = await prepared()
    const result = await sequence(runtime, ["config", "list"])
    expect(JSON.parse(result.stdout)).toEqual([
      {
        name: "a",
        default: true,
        url: URL_A,
        engine: "e1",
        auth: null,
        readOnly: false,
        scope: "user",
      },
      {
        name: "b",
        default: false,
        url: URL_B,
        engine: null,
        auth: null,
        readOnly: true,
        scope: "user",
      },
    ])
    const table = await sequence(runtime, ["config", "list", "-o", "table"])
    expect(table.stdout).toBe(
      [
        "name  default  url                        engine  readOnly  scope",
        `a     true     ${URL_A}  e1      false     user`,
        `b     false    ${URL_B}          true      user`,
        "",
      ].join("\n"),
    )
  })

  it("lists nothing without a config file", async () => {
    expect((await cli(["config", "list"])).stdout).toBe("[]\n")
    expect((await cli(["config", "list", "-o", "table"])).stdout).toBe("No results.\n")
  })
})

describe("config show", () => {
  const file = JSON.stringify({
    defaultProfile: "a",
    profiles: { a: { url: URL_A, headers: { Authorization: "Basic xyz" }, timeout: 1000 } },
  })

  it("shows every value with its source and masks header values", async () => {
    const result = await cli(["config", "show", "--engine", "e2"], {
      files: { [CONFIG_PATH]: file },
      env: { OPERATE_READ_ONLY: "true" },
    })
    expect(JSON.parse(result.stdout)).toEqual({
      configFile: CONFIG_PATH,
      projectFile: null,
      profile: "a",
      profileFile: CONFIG_PATH,
      values: {
        url: { value: URL_A, source: "profile" },
        cockpitUrl: { value: null, source: "default" },
        engine: { value: "e2", source: "flag" },
        platform: { value: "camunda7", source: "default" },
        auth: { value: "none", source: "default" },
        username: { value: null, source: "default" },
        password: { value: null, source: "default" },
        output: { value: null, source: "default" },
        timeout: { value: 1000, source: "profile" },
        headers: { value: { Authorization: "Basic ***" }, source: "profile" },
        readOnly: { value: true, source: "env" },
      },
    })
  })

  it("shows headers of OPERATE_HEADERS with source env, masked", async () => {
    const result = await cli(["config", "show"], {
      files: { [CONFIG_PATH]: file },
      env: { OPERATE_HEADERS: "Authorization: Bearer from-env" },
    })
    expect(JSON.parse(result.stdout)).toMatchObject({
      values: { headers: { value: { Authorization: "Bearer ***" }, source: "env" } },
    })
  })

  it("fails for a config file named by --config that does not exist", async () => {
    const result = await cli(["config", "show", "--config", "/typo.json"])
    expect(result.code).toBe(3)
    expect(errorOf(result.stderr)).toMatchObject({
      code: "CONFIG",
      message: "Config file /typo.json does not exist",
    })
    const list = await cli(["config", "list"], { env: { OPERATE_CONFIG: "/typo.json" } })
    expect(errorOf(list.stderr)).toMatchObject({
      message: "Config file /typo.json does not exist",
    })
    const created = await cli(["config", "set", "p", "--url", URL_A, "--config", "/new.json"])
    expect(created.code).toBe(0)
    expect(stored(created.runtime, "/new.json")).toMatchObject({ profiles: { p: { url: URL_A } } })
  })

  it("shows header values with --show-secrets", async () => {
    const result = await cli(["config", "show", "--show-secrets"], {
      files: { [CONFIG_PATH]: file },
    })
    expect(JSON.parse(result.stdout)).toMatchObject({
      values: { headers: { value: { Authorization: "Basic xyz" } } },
    })
  })

  it("prints a KEY VALUE SOURCE table", async () => {
    const result = await cli(["config", "show", "-o", "table"], { files: { [CONFIG_PATH]: file } })
    expect(result.stdout).toBe(
      [
        `Config file: ${CONFIG_PATH}`,
        "Profile: a",
        "",
        "KEY         VALUE                          SOURCE",
        `url         ${URL_A}      profile`,
        "cockpitUrl                                 default",
        "engine                                     default",
        "platform    camunda7                       default",
        "auth        none                           default",
        "username                                   default",
        "password                                   default",
        "output                                     default",
        "timeout     1000                           profile",
        'headers     {"Authorization":"Basic ***"}  profile',
        "readOnly    false                          default",
        "",
      ].join("\n"),
    )
    const none = await cli(["config", "show", "-o", "table"])
    expect(none.stdout).toMatch(/^Config file: .*\nProfile: \(none\)\n\n/)
  })

  it("shows what an operation command resolves, not the -o of config show itself", async () => {
    const files = {
      [CONFIG_PATH]: JSON.stringify({ defaultProfile: "a", profiles: { a: { output: "table" } } }),
    }
    const json = await cli(["config", "show", "-o", "json"], { files, stdoutTTY: true })
    // pretty on a terminal; the profile's table still is what an operation command would use
    expect(JSON.parse(json.stdout)).toMatchObject({
      values: { output: { value: "table", source: "profile" } },
    })
    expect(json.stdout).toMatch(/^\{\n {2}"configFile"/)
    const env = await cli(["config", "show", "--output", "table"], {
      env: { OPERATE_OUTPUT: "json" },
    })
    expect(env.stdout).toMatch(/\noutput +json +env\n/)
    // without -o the resolved output format also picks the display format
    const profile = await cli(["config", "show"], { files })
    expect(profile.stdout).toMatch(/\noutput +table +profile\n/)
  })

  it("rejects an unknown -o before reading the configuration", async () => {
    const result = await cli(["config", "show", "-o", "yaml", "--config", "/typo.json"])
    expect(result.code).toBe(3)
    expect(errorOf(result.stderr)).toMatchObject({ message: 'Unknown output format "yaml"' })
  })

  it("renders later errors in the -o format", async () => {
    const result = await cli(["config", "show", "-o", "table", "--profile", "x"])
    expect(result.code).toBe(3)
    expect(result.stderr).toMatch(/^Error: Profile "x" does not exist\n/)
  })

  it("reports a missing profile", async () => {
    const result = await cli(["config", "show", "--profile", "x"], {
      files: { [CONFIG_PATH]: file },
    })
    expect(result.code).toBe(3)
    expect(errorOf(result.stderr)).toMatchObject({ message: 'Profile "x" does not exist' })
  })
})
