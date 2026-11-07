/**
 * The CLI never writes a config file it would refuse to read: writeTarget checks the edited file
 * with the reader's rules, for the user's config file and for the project file, and on a problem
 * writes nothing, neither over an existing file nor as a new one.
 */

import { describe, expect, it } from "vitest"
import { CONFIG_PATH, fakeRuntime, fileText } from "../../../test/support/fake-runtime.js"
import type { ConfigFile } from "../../config/types.js"
import { writeTarget } from "./config-project.js"

const PROJECT = "/home/tester/repo/.pulse-cli.json"
const BEFORE = '{\n  "profiles": {}\n}\n'
// an OAuth token endpoint without the authorization endpoint, which the reader refuses
const REFUSED: ConfigFile = {
  profiles: { p: { auth: { type: "oauth", tokenEndpoint: "https://login.example.com/token" } } },
}
const PROBLEM =
  'profile "p" sets auth.tokenEndpoint without the other endpoint; set both auth.authorizationEndpoint and auth.tokenEndpoint, or neither (discovery from auth.issuer)'

const TARGETS = [
  ["the user's config file", CONFIG_PATH, false],
  ["the project file", PROJECT, true],
] as const

describe("writeTarget", () => {
  it.each(TARGETS)(
    "leaves %s as it was when the reader would refuse the edit",
    async (_, path, project) => {
      const runtime = fakeRuntime({ files: { [path]: BEFORE } })
      const error = await writeTarget(runtime, { path, project }, REFUSED).catch(
        (caught: unknown) => caught,
      )
      expect(error).toMatchObject({
        code: "CONFIG",
        message: `Invalid config file ${path} (not written): ${PROBLEM}`,
      })
      expect(fileText(runtime, path)).toBe(BEFORE)
    },
  )

  it.each(TARGETS)(
    "does not create %s when the reader would refuse it",
    async (_, path, project) => {
      const runtime = fakeRuntime()
      await expect(writeTarget(runtime, { path, project }, REFUSED)).rejects.toMatchObject({
        code: "CONFIG",
      })
      expect(runtime.files.has(path)).toBe(false)
    },
  )

  it.each(TARGETS)("writes %s when the reader accepts it", async (_, path, project) => {
    const runtime = fakeRuntime({ files: { [path]: BEFORE } })
    const file: ConfigFile = { defaultProfile: "p", profiles: { p: { url: "http://x" } } }
    await writeTarget(runtime, { path, project }, file)
    expect(JSON.parse(fileText(runtime, path) ?? "")).toEqual(file)
  })
})
