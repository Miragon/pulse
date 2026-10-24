/**
 * The files of operate (up to 0.10.0) that pulse-cli reads until LEGACY_REMOVAL: the user's
 * config.json in ~/.config/operate while the new one is missing, and .operate.json in a directory
 * without a .pulse-cli.json (file.ts, project.ts).
 */

import { describe, expect, it } from "vitest"
import { CONFIG_PATH, fakeRuntime } from "../../test/support/fake-runtime.js"
import { tokenDirectory, userConfigFile } from "./file.js"
import { findProjectFile, legacyProjectProblem } from "./project.js"

const LEGACY_CONFIG = "/home/tester/.config/operate/config.json"
const FILE = '{"profiles":{}}'

async function userFile(options: Parameters<typeof fakeRuntime>[0], explicit?: string) {
  const runtime = fakeRuntime(options)
  return userConfigFile(runtime.fs, runtime.env, runtime, explicit)
}

describe("userConfigFile", () => {
  it("is the new file when it exists or when neither exists", async () => {
    const current = { path: CONFIG_PATH, canonical: CONFIG_PATH, legacy: false }
    expect(await userFile({ files: { [CONFIG_PATH]: FILE } })).toEqual(current)
    expect(await userFile({ files: { [CONFIG_PATH]: FILE, [LEGACY_CONFIG]: FILE } })).toEqual(
      current,
    )
    expect(await userFile({})).toEqual(current)
  })

  it("is operate's file while only that one exists; edits still write the new one", async () => {
    expect(await userFile({ files: { [LEGACY_CONFIG]: FILE } })).toEqual({
      path: LEGACY_CONFIG,
      canonical: CONFIG_PATH,
      legacy: true,
    })
  })

  it("follows an absolute XDG_CONFIG_HOME and ignores a relative one", async () => {
    const env = { XDG_CONFIG_HOME: "/xdg" }
    expect(await userFile({ env, files: { "/xdg/operate/config.json": FILE } })).toEqual({
      path: "/xdg/operate/config.json",
      canonical: "/xdg/pulse-cli/config.json",
      legacy: true,
    })
    const relative = { XDG_CONFIG_HOME: "xdg" }
    expect(await userFile({ env: relative, files: { [LEGACY_CONFIG]: FILE } })).toMatchObject({
      path: LEGACY_CONFIG,
      legacy: true,
    })
  })

  it("reads %APPDATA%\\operate on Windows, else the roaming profile", async () => {
    const windows = { platform: "win32", homedir: "C:\\Users\\me" }
    const appData = await userFile({
      ...windows,
      env: { APPDATA: "D:\\Roaming" },
      files: { "D:\\Roaming\\operate\\config.json": FILE },
    })
    expect(appData).toEqual({
      path: "D:\\Roaming\\operate\\config.json",
      canonical: "D:\\Roaming\\pulse-cli\\config.json",
      legacy: true,
    })
    const roaming = "C:\\Users\\me\\AppData\\Roaming\\operate\\config.json"
    expect(await userFile({ ...windows, files: { [roaming]: FILE } })).toMatchObject({
      path: roaming,
      legacy: true,
    })
  })

  it("never falls back for --config or PULSE_CLI_CONFIG", async () => {
    const files = { [LEGACY_CONFIG]: FILE }
    expect(await userFile({ files }, "/x.json")).toEqual({
      path: "/x.json",
      canonical: "/x.json",
      legacy: false,
    })
    expect(await userFile({ files, env: { PULSE_CLI_CONFIG: "/e.json" } })).toEqual({
      path: "/e.json",
      canonical: "/e.json",
      legacy: false,
    })
  })

  it("keeps the new file when an existence check fails", async () => {
    const runtime = fakeRuntime({ files: { [LEGACY_CONFIG]: FILE } })
    const failing = (path: string) => ({
      ...runtime.fs,
      exists: (candidate: string) =>
        candidate === path ? Promise.reject(new Error("EACCES")) : runtime.fs.exists(candidate),
    })
    const unknownNew = await userConfigFile(failing(CONFIG_PATH), runtime.env, runtime)
    expect(unknownNew).toMatchObject({ path: CONFIG_PATH, legacy: false })
    const unknownOld = await userConfigFile(failing(LEGACY_CONFIG), runtime.env, runtime)
    expect(unknownOld).toMatchObject({ path: CONFIG_PATH, legacy: false })
  })

  it("leaves the tokens in the new directory", () => {
    const runtime = fakeRuntime({ files: { [LEGACY_CONFIG]: FILE } })
    expect(tokenDirectory(runtime.env, runtime)).toBe("/home/tester/.config/pulse-cli/tokens")
  })
})

describe("findProjectFile with operate's project file", () => {
  const find = async (files: Record<string, string>, cwd = "/home/tester/repo/sub") => {
    const runtime = fakeRuntime({ files, dirs: ["/home/tester/repo/.git"], cwd })
    return findProjectFile(runtime.fs, cwd, runtime)
  }

  it("reads it where it is the only one", async () => {
    expect(await find({ "/home/tester/repo/.operate.json": FILE })).toEqual({
      path: "/home/tester/repo/.operate.json",
      exists: true,
      legacy: true,
    })
  })

  it("ignores it next to a .pulse-cli.json", async () => {
    const files = {
      "/home/tester/repo/.operate.json": FILE,
      "/home/tester/repo/.pulse-cli.json": FILE,
    }
    expect(await find(files)).toEqual({
      path: "/home/tester/repo/.pulse-cli.json",
      exists: true,
      shadowed: "/home/tester/repo/.operate.json",
    })
  })

  it("takes the nearest directory with either file", async () => {
    const legacyBelow = {
      "/home/tester/repo/.pulse-cli.json": FILE,
      "/home/tester/repo/sub/.operate.json": FILE,
    }
    expect(await find(legacyBelow)).toMatchObject({ path: "/home/tester/repo/sub/.operate.json" })
    const newBelow = {
      "/home/tester/repo/.operate.json": FILE,
      "/home/tester/repo/sub/.pulse-cli.json": FILE,
    }
    expect(await find(newBelow)).toEqual({
      path: "/home/tester/repo/sub/.pulse-cli.json",
      exists: true,
    })
  })

  it("creates a .pulse-cli.json at the repository root when there is none", async () => {
    expect(await find({})).toEqual({ path: "/home/tester/repo/.pulse-cli.json", exists: false })
  })

  it("never reads one above the repository root or in the home directory", async () => {
    const files = { "/home/tester/.operate.json": FILE, "/home/.operate.json": FILE }
    expect(await find(files)).toEqual({ path: "/home/tester/repo/.pulse-cli.json", exists: false })
    const runtime = fakeRuntime({ files })
    expect(await findProjectFile(runtime.fs, "/home/tester", runtime)).toBeUndefined()
  })
})

describe("legacyProjectProblem", () => {
  it("refuses flavor, which operate rejects, with a hint to rename the file", () => {
    const file = { profiles: { a: { url: "http://a" }, b: { flavor: "operaton" as const } } }
    expect(legacyProjectProblem(file)).toEqual({
      problem: 'profile "b" sets flavor, which operate (up to 0.10.0) refuses in .operate.json',
      hint: "Rename the file to .pulse-cli.json first (git mv .operate.json .pulse-cli.json) once everyone uses pulse-cli, or leave flavor out.",
    })
  })

  it("accepts a file without flavor", () => {
    expect(legacyProjectProblem({ profiles: { a: { url: "http://a" } } })).toBeUndefined()
    expect(legacyProjectProblem({ profiles: {} })).toBeUndefined()
  })
})
