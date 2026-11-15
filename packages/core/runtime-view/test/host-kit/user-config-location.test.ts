import { CLI_CONFIG_LOCATIONS } from "@miragon/pulse-profile/testing"
import { describe, expect, test } from "vitest"
import { UserConfigLocation } from "../../src/host-kit/connections/user-config-location.js"

describe("the CLI's user config, found the way the CLI finds it", () => {
  test.each(CLI_CONFIG_LOCATIONS.map((location) => [location.about, location] as const))(
    "%s",
    (_about, { env, home, platform, path, explicit }) => {
      const location = new UserConfigLocation(env, home, platform)
      expect(location.path).toBe(path)
      expect(location.explicit).toBe(explicit)
    },
  )

  test("is relative only where PULSE_CLI_CONFIG names it by a relative path", () => {
    const relative = CLI_CONFIG_LOCATIONS.filter(({ env, home, platform }) =>
      new UserConfigLocation(env, home, platform).isRelative(),
    )
    expect(relative.map(({ env }) => env.PULSE_CLI_CONFIG)).toEqual(["./pulse.json"])
  })

  test("names its folder and its file on the platform it runs on", () => {
    const linux = new UserConfigLocation({}, "/home/me", "linux")
    const windows = new UserConfigLocation({ APPDATA: "D:\\Roaming" }, "C:\\Users\\me", "win32")

    expect([linux.folder(), linux.fileName()]).toEqual([
      "/home/me/.config/pulse-cli",
      "config.json",
    ])
    expect([windows.folder(), windows.fileName()]).toEqual([
      "D:\\Roaming\\pulse-cli",
      "config.json",
    ])
    expect(
      new UserConfigLocation({ PULSE_CLI_CONFIG: "C:\\ci\\pulse.json" }, "", "win32").isRelative(),
    ).toBe(false)
  })

  test("names the folder that holds its folder, which a watcher waits in until the folder is there", () => {
    const linux = new UserConfigLocation({}, "/home/me", "linux")
    const windows = new UserConfigLocation({ APPDATA: "D:\\Roaming" }, "C:\\Users\\me", "win32")
    const atTheRoot = new UserConfigLocation({ PULSE_CLI_CONFIG: "/pulse.json" }, "", "linux")

    expect([linux.parentFolder(), linux.folderName()]).toEqual(["/home/me/.config", "pulse-cli"])
    expect([windows.parentFolder(), windows.folderName()]).toEqual(["D:\\Roaming", "pulse-cli"])
    expect([atTheRoot.folder(), atTheRoot.parentFolder(), atTheRoot.folderName()]).toEqual([
      "/",
      "/",
      "",
    ])
  })

  test("reads the variable the CLI reads", () => {
    expect(UserConfigLocation.VARIABLE).toBe("PULSE_CLI_CONFIG")
  })
})
