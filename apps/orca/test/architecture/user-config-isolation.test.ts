import { execFileSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { pathToFileURL } from "node:url"
import { afterAll, describe, expect, test } from "vitest"
import { PACKAGE_ROOT, PLUGIN_SOURCES } from "./support/files.js"

interface ConfigHome {
  readonly XDG_CONFIG_HOME?: string | undefined
  readonly APPDATA?: string | undefined
  readonly PULSE_CLI_CONFIG?: string | undefined
}

const ROOT_ONLY = "src/worker/composition-root.ts"
const FINDS_THE_CONFIG = /new UserConfigLocation\(|process\.env|\bhomedir\b|["']node:os["']/
const PRINTS_ITS_ENVIRONMENT = [
  "const { XDG_CONFIG_HOME, APPDATA, PULSE_CLI_CONFIG } = process.env",
  "process.stdout.write(JSON.stringify({ XDG_CONFIG_HOME, APPDATA, PULSE_CLI_CONFIG }))",
].join("\n")

const DEVELOPERS_OWN: ConfigHome = {
  XDG_CONFIG_HOME: "/home/me/.config",
  APPDATA: "/home/me/AppData/Roaming",
  PULSE_CLI_CONFIG: "/home/me/ci.json",
}

const planted = mkdtempSync(join(tmpdir(), "pulse-orca-cli-"))

afterAll(() => {
  rmSync(planted, { recursive: true, force: true })
})

function sourcesOf(folder: string): string[] {
  return readdirSync(folder, { recursive: true, encoding: "utf8" })
    .filter((path) => /\.tsx?$/.test(path))
    .map((path) => join(folder, path))
}

function findsTheConfig(source: string): boolean {
  return FINDS_THE_CONFIG.test(source)
}

function isIsolated(home: ConfigHome): boolean {
  const folder = home.XDG_CONFIG_HOME ?? ""
  return (
    folder === home.APPDATA &&
    home.PULSE_CLI_CONFIG === "" &&
    !relative(tmpdir(), folder).startsWith("..") &&
    !folder.startsWith(join(homedir(), ".config"))
  )
}

async function kitHome(): Promise<ConfigHome> {
  const kit = pathToFileURL(join(PACKAGE_ROOT, "vitest.kit.config.ts")).href
  const loaded = (await import(kit)) as { readonly default: { readonly test: { env: ConfigHome } } }
  return loaded.default.test.env
}

function cliRun(...args: string[]): ConfigHome {
  const cli = join(planted, "app.asar.unpacked", "out", "cli", "index.js")
  mkdirSync(dirname(cli), { recursive: true })
  writeFileSync(cli, PRINTS_ITS_ENVIRONMENT)
  const output = execFileSync(process.execPath, [join(PACKAGE_ROOT, "scripts/orca.mjs"), ...args], {
    encoding: "utf8",
    env: { ...process.env, ORCA_RESOURCES: planted, ...DEVELOPERS_OWN },
  })
  return JSON.parse(output) as ConfigHome
}

describe("the CLI's user config", () => {
  test("is found by the composition root alone, from the worker's environment", () => {
    const finders = sourcesOf(PLUGIN_SOURCES)
      .filter((path) => findsTheConfig(readFileSync(path, "utf8")))
      .map((path) => relative(PACKAGE_ROOT, path))

    expect(finders).toEqual([ROOT_ONLY])
  })

  test("flags a planted part that finds it itself", () => {
    expect(
      [
        "new UserConfigLocation(process.env, home, platform)",
        "const env = process.env",
        'import { homedir } from "node:os"',
        "const home = homedir()",
        'import { UserConfigLocation } from "@miragon/pulse-runtime-view/host-kit"',
        "registry.userConfigLocation()",
      ].map((source) => findsTheConfig(source)),
    ).toEqual([true, true, true, true, false, false])
  })

  test("is read from a temporary folder by the worker's tests and the kit's", async () => {
    const unit = {
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
      APPDATA: process.env.APPDATA,
      PULSE_CLI_CONFIG: process.env.PULSE_CLI_CONFIG,
    }

    for (const home of [unit, await kitHome()]) {
      expect(isIsolated(home)).toBe(true)
      expect(existsSync(home.XDG_CONFIG_HOME ?? "")).toBe(true)
    }
  })

  test("is read from a temporary folder by orca plugin check, which runs the worker", () => {
    const checked = cliRun("plugin", "check", "dist")

    expect(isIsolated(checked)).toBe(true)
    expect(checked.PULSE_CLI_CONFIG).toBe("")
    expect(existsSync(checked.XDG_CONFIG_HOME ?? "")).toBe(false)
    expect(cliRun("plugin", "validate", "dist")).toEqual(DEVELOPERS_OWN)
  })

  test("refuses a config home that lets PULSE_CLI_CONFIG through or sits in the home folder", () => {
    const folder = join(tmpdir(), "pulse-orca-config-planted")

    expect(isIsolated({ XDG_CONFIG_HOME: folder, APPDATA: folder, PULSE_CLI_CONFIG: "" })).toBe(
      true,
    )
    expect(isIsolated({ XDG_CONFIG_HOME: folder, APPDATA: folder })).toBe(false)
    expect(
      isIsolated({ XDG_CONFIG_HOME: folder, APPDATA: "elsewhere", PULSE_CLI_CONFIG: "" }),
    ).toBe(false)
    const own = join(homedir(), ".config")
    expect(isIsolated({ XDG_CONFIG_HOME: own, APPDATA: own, PULSE_CLI_CONFIG: "" })).toBe(false)
  })
})
