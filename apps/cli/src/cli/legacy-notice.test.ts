/**
 * operate's names (up to 0.10.0) through `run()`: the variables, the user's config file, the
 * project file and the command name still work until LEGACY_REMOVAL, a run that uses one warns
 * once on stderr before the command, and edits never write operate's user file or a flavor into
 * operate's project file.
 */

import { describe, expect, it } from "vitest"
import {
  CONFIG_PATH,
  execute,
  fakeRuntime,
  type FakeRuntimeOptions,
  fileText,
} from "../../test/support/fake-runtime.js"
import { loadConfig } from "./config-files.js"
import { run } from "./run.js"

const REPO = "/home/tester/repo"
const LEGACY_CONFIG = "/home/tester/.config/operate/config.json"
const LEGACY_PROJECT = `${REPO}/.operate.json`
const OLD_URL = "http://old:8080/engine-rest"
const PROFILES = JSON.stringify({ defaultProfile: "old", profiles: { old: { url: OLD_URL } } })
const WARNING =
  /^Warning: operate is now pulse-cli, and its old names stop working in the first release after 2027-01-31: (.*)\. See https:\/\/miragon\.github\.io\/pulse\/cli\/installation#renamed-from-operate$/

function runtimeOf(options: FakeRuntimeOptions = {}) {
  return fakeRuntime({ cwd: `${REPO}/src`, dirs: [`${REPO}/.git`], ...options })
}

const cli = (args: readonly string[], options: FakeRuntimeOptions = {}) =>
  execute(run, args, runtimeOf(options))

const linesOf = (text: string) => text.split("\n").filter((line) => line !== "")

/** The uses the warning lists, or undefined without a warning. */
function usesOf(stderr: string): string | undefined {
  return WARNING.exec(linesOf(stderr)[0] ?? "")?.[1]
}

function valuesOf(stdout: string) {
  return (JSON.parse(stdout) as { values: Record<string, { value: unknown; source: string }> })
    .values
}

describe("the warning", () => {
  it("is one stderr line for an old variable, whose value is used", async () => {
    const result = await cli(["config", "show", "-o", "json"], { env: { OPERATE_URL: OLD_URL } })
    expect(result.code).toBe(0)
    expect(linesOf(result.stderr)).toHaveLength(1)
    expect(usesOf(result.stderr)).toBe("OPERATE_URL (now PULSE_CLI_URL)")
    expect(valuesOf(result.stdout).url).toEqual({ value: OLD_URL, source: "env" })
  })

  it("names the variable, the config file and the project file in one line", async () => {
    const result = await cli(["config", "show", "-o", "json"], {
      env: { OPERATE_TIMEOUT: "5000" },
      files: { [LEGACY_CONFIG]: PROFILES, [LEGACY_PROJECT]: '{"profiles":{"repo":{}}}' },
    })
    expect(linesOf(result.stderr)).toHaveLength(1)
    expect(usesOf(result.stderr)).toBe(
      `OPERATE_TIMEOUT (now PULSE_CLI_TIMEOUT); ${LEGACY_CONFIG} (now ${CONFIG_PATH}, which the next config edit writes); ${LEGACY_PROJECT} (now .pulse-cli.json)`,
    )
    expect(valuesOf(result.stdout).url).toEqual({ value: OLD_URL, source: "profile" })
  })

  it("names the command when the shell started pulse-cli as operate", async () => {
    const runtime = runtimeOf()
    const code = await run(["--version"], runtime, { invokedAs: "/opt/homebrew/bin/operate" })
    expect(code).toBe(0)
    expect(runtime.stdout.text()).toMatch(/^\d+\.\d+\.\d+/)
    expect(usesOf(runtime.stderr.text())).toBe("the command operate (now pulse-cli)")
    const plain = runtimeOf()
    await run(["--version"], plain, { invokedAs: "/usr/local/bin/pulse-cli" })
    expect(plain.stderr.text()).toBe("")
  })

  it("is never written during completion", async () => {
    const runtime = runtimeOf({
      env: { OPERATE_URL: OLD_URL },
      files: { [LEGACY_CONFIG]: PROFILES },
    })
    await run(["__complete", "proc"], runtime, { invokedAs: "operate" })
    expect(runtime.stderr.text()).toBe("")
  })

  it("is not written without old names", async () => {
    const result = await cli(["config", "show"], {
      env: { PULSE_CLI_URL: OLD_URL, OPERATE_PLATFORM: "operaton" },
      files: { [CONFIG_PATH]: PROFILES },
    })
    expect(result.stderr).toBe("")
  })

  it("comes before the JSON error of a failing command, which stays the last line", async () => {
    const result = await cli(["ping", "--flavor", "camunda8"], { env: { OPERATE_URL: OLD_URL } })
    expect(result.code).toBe(3)
    const lines = linesOf(result.stderr)
    expect(usesOf(result.stderr)).toBe("OPERATE_URL (now PULSE_CLI_URL)")
    expect(JSON.parse(lines.at(-1)!)).toMatchObject({ error: { code: "CONFIG" } })
  })

  it("says that old variables are ignored once a new one is set", async () => {
    const result = await cli(["config", "show", "-o", "json"], {
      env: { PULSE_CLI_TIMEOUT: "5000", OPERATE_URL: OLD_URL },
    })
    expect(usesOf(result.stderr)).toBe(
      "OPERATE_URL (ignored, since PULSE_CLI_ variables are set; now PULSE_CLI_URL)",
    )
    expect(valuesOf(result.stdout).url).toMatchObject({ source: "default" })
  })

  it("names a project file that a .pulse-cli.json shadows", async () => {
    const result = await cli(["config", "list"], {
      files: { [LEGACY_PROJECT]: "{}", [`${REPO}/.pulse-cli.json`]: "{}" },
    })
    expect(usesOf(result.stderr)).toBe(
      `${LEGACY_PROJECT} (ignored next to ${REPO}/.pulse-cli.json)`,
    )
  })

  it("still names the variables when the files cannot be looked up", async () => {
    const runtime = runtimeOf({ env: { OPERATE_URL: OLD_URL } })
    const fs = { ...runtime.fs, kind: () => Promise.reject(new Error("EACCES")) }
    await run(["--version"], { ...runtime, fs })
    expect(usesOf(runtime.stderr.text())).toBe("OPERATE_URL (now PULSE_CLI_URL)")
  })

  it("is made safe for a terminal, and left as it is for a pipe", async () => {
    const repo = "/home/tester/re\u001bpo"
    const options = {
      cwd: repo,
      dirs: [`${repo}/.git`],
      files: { [`${repo}/.operate.json`]: "{}" },
    }
    const tty = await execute(run, ["config", "list"], fakeRuntime({ ...options, stderrTTY: true }))
    expect(tty.stderr).toContain("/home/tester/re�po/.operate.json (now .pulse-cli.json)")
    const pipe = await execute(run, ["config", "list"], fakeRuntime(options))
    expect(pipe.stderr).toContain("/home/tester/re\u001bpo/.operate.json")
  })
})

describe("operate's config file", () => {
  it("is copied into the new file by the first edit and stays as it is", async () => {
    const runtime = runtimeOf({ files: { [LEGACY_CONFIG]: PROFILES } })
    const edit = await execute(
      run,
      ["config", "set", "p", "--url", "http://p/engine-rest"],
      runtime,
    )
    expect(edit.code).toBe(0)
    expect(JSON.parse(fileText(runtime, CONFIG_PATH) ?? "")).toEqual({
      defaultProfile: "old",
      profiles: { old: { url: OLD_URL }, p: { url: "http://p/engine-rest" } },
    })
    expect(runtime.files.get(CONFIG_PATH)?.mode).toBe(0o600)
    expect(fileText(runtime, LEGACY_CONFIG)).toBe(PROFILES)
    runtime.stderr.chunks.length = 0
    expect((await execute(run, ["config", "list"], runtime)).stderr).toBe("")
  })

  it("is the path config path prints while it is in effect", async () => {
    const result = await cli(["config", "path"], { files: { [LEGACY_CONFIG]: PROFILES } })
    expect(JSON.parse(result.stdout)).toEqual({ path: LEGACY_CONFIG })
  })

  it("keys the logins of its profiles by the new file, so they survive the first edit", async () => {
    const loaded = await loadConfig(runtimeOf({ files: { [LEGACY_CONFIG]: PROFILES } }), undefined)
    expect(loaded.path).toBe(LEGACY_CONFIG)
    expect(loaded.config?.origin).toBe(`config:${CONFIG_PATH}`)
  })
})

describe("operate's project file", () => {
  it("is edited in place, and no .pulse-cli.json is created", async () => {
    const runtime = runtimeOf({ files: { [LEGACY_PROJECT]: '{"profiles":{}}' } })
    const args = ["config", "set", "p", "--url", "http://p/engine-rest", "--project"]
    expect((await execute(run, args, runtime)).code).toBe(0)
    expect(JSON.parse(fileText(runtime, LEGACY_PROJECT) ?? "")).toEqual({
      defaultProfile: "p",
      profiles: { p: { url: "http://p/engine-rest" } },
    })
    expect(runtime.files.get(LEGACY_PROJECT)?.mode).toBe(0o644)
    expect(fileText(runtime, `${REPO}/.pulse-cli.json`)).toBeUndefined()
  })

  it("never gets a flavor, which operate rejects", async () => {
    const before = '{"profiles":{"p":{"url":"http://p/engine-rest"}}}'
    const runtime = runtimeOf({ files: { [LEGACY_PROJECT]: before } })
    const result = await execute(
      run,
      ["config", "set", "p", "--flavor", "operaton", "--project"],
      runtime,
    )
    expect(result.code).toBe(3)
    const error = (JSON.parse(linesOf(result.stderr).at(-1)!) as { error: Record<string, string> })
      .error
    expect(error.code).toBe("CONFIG")
    expect(error.message).toBe(
      `The project file ${LEGACY_PROJECT} cannot be written: profile "p" sets flavor, which operate (up to 0.10.0) refuses in .operate.json`,
    )
    expect(error.hint).toContain("git mv .operate.json .pulse-cli.json")
    expect(fileText(runtime, LEGACY_PROJECT)).toBe(before)
  })
})
