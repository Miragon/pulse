import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { describe, expect, test } from "vitest"
import { UserConfigFile } from "../../src/host/connections/user-config-file.js"

const HOME = "/home/dev"

describe("the CLI's user config, found the way the CLI finds it", () => {
  test("lives under ~/.config/pulse-cli by default", () => {
    expect(UserConfigFile.locate({}, HOME, "linux")).toEqual({
      path: "/home/dev/.config/pulse-cli/config.json",
      explicit: false,
    })
  })

  test("follows an absolute XDG_CONFIG_HOME and ignores a relative one", () => {
    expect(UserConfigFile.locate({ XDG_CONFIG_HOME: "/xdg" }, HOME, "darwin").path).toBe(
      "/xdg/pulse-cli/config.json",
    )
    expect(UserConfigFile.locate({ XDG_CONFIG_HOME: "xdg" }, HOME, "linux").path).toBe(
      "/home/dev/.config/pulse-cli/config.json",
    )
  })

  test("lives under %APPDATA% on Windows", () => {
    expect(UserConfigFile.locate({ APPDATA: "D:\\Roaming" }, "C:\\Users\\dev", "win32").path).toBe(
      "D:\\Roaming\\pulse-cli\\config.json",
    )
    expect(UserConfigFile.locate({ XDG_CONFIG_HOME: "/xdg" }, "C:\\Users\\dev", "win32").path).toBe(
      "C:\\Users\\dev\\AppData\\Roaming\\pulse-cli\\config.json",
    )
  })

  test("is the file PULSE_CLI_CONFIG names, unless it is blank", () => {
    expect(UserConfigFile.locate({ PULSE_CLI_CONFIG: "/ci/pulse.json" }, HOME, "linux")).toEqual({
      path: resolve("/ci/pulse.json"),
      explicit: true,
    })
    expect(UserConfigFile.locate({ PULSE_CLI_CONFIG: "  " }, HOME, "linux").explicit).toBe(false)
  })
})

describe("a new user config", () => {
  const PRIVATE = 0o600

  test("is created with its folder, readable by its owner only and without profiles", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "pulse-user-config-")), "pulse-cli", "config.json")

    expect(await UserConfigFile.createIfMissing(path)).toBe(true)

    expect(statSync(path).mode & 0o777).toBe(PRIVATE)
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ profiles: {} })
  })

  test("never replaces a file that is there", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "pulse-user-config-")), "config.json")
    writeFileSync(path, '{ "defaultProfile": "dev" }\n')

    expect(await UserConfigFile.createIfMissing(path)).toBe(false)

    expect(readFileSync(path, "utf8")).toBe('{ "defaultProfile": "dev" }\n')
  })
})
