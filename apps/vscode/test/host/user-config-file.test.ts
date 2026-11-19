import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ProfileSource, TargetsParser } from "@miragon/pulse-runtime-view/host-kit"
import { afterEach, describe, expect, test, vi } from "vitest"
import { UserConfigFile } from "../../src/host/connections/user-config-file.js"

const PRIVATE = 0o600

function folder(): string {
  return mkdtempSync(join(tmpdir(), "pulse-user-config-"))
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("the CLI's user config of the extension host", () => {
  test("is found the way the CLI finds it, from the host's environment", () => {
    vi.stubEnv("PULSE_CLI_CONFIG", "")

    const found = UserConfigFile.location()

    expect(found.explicit).toBe(false)
    expect(found.path.endsWith(join("pulse-cli", "config.json"))).toBe(true)

    vi.stubEnv("PULSE_CLI_CONFIG", "/ci/pulse.json")

    expect(UserConfigFile.location()).toMatchObject({ path: "/ci/pulse.json", explicit: true })
  })
})

describe("a new user config", () => {
  test("is created with its folder, readable by its owner only and without profiles", async () => {
    const path = join(folder(), "pulse-cli", "config.json")

    expect(await UserConfigFile.createIfMissing(path)).toBe(true)

    expect(statSync(path).mode & 0o777).toBe(PRIVATE)
    expect(readFileSync(path, "utf8")).toBe(UserConfigFile.EMPTY)
  })

  test("holds no profile and nothing the editors or the CLI refuse", () => {
    const parser = new TargetsParser(
      "/home/dev/.config/pulse-cli/config.json",
      ProfileSource.USER_CONFIG,
    )

    expect(parser.parse(UserConfigFile.EMPTY)).toEqual({ names: [], targets: [], problems: [] })
  })

  test("never replaces a file that is there", async () => {
    const path = join(folder(), "config.json")
    writeFileSync(path, '{ "defaultProfile": "dev" }\n')

    expect(await UserConfigFile.createIfMissing(path)).toBe(false)

    expect(readFileSync(path, "utf8")).toBe('{ "defaultProfile": "dev" }\n')
  })

  test("fails as the file system does when its folder takes no file", async () => {
    const locked = folder()
    chmodSync(locked, 0o500)

    await expect(UserConfigFile.createIfMissing(join(locked, "config.json"))).rejects.toThrow()

    chmodSync(locked, 0o700)
  })
})
