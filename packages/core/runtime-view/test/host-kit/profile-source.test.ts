import { describe, expect, test } from "vitest"
import type { EngineTarget } from "../../src/host-kit/connections/engine-target.js"
import { LOCAL_TARGET } from "./support/local-target.js"
import { ProfileSource } from "../../src/host-kit/connections/profile-source.js"
import { TargetsProblem } from "../../src/host-kit/connections/targets-problem.js"
import { WritePolicy } from "../../src/host-kit/connections/write-policy.js"

const PROJECT = "/work/.pulse.json"
const OWN = "/home/dev/.config/pulse-cli/config.json"
const WORDING = { setting: "the writes setting", enableOnRemote: "Turn on writes" }

function readOnlyFrom(source: EngineTarget["source"]): string | undefined {
  const target: EngineTarget = { ...LOCAL_TARGET, readOnly: true, source }
  return WritePolicy.access(target, "enabled", { kind: "none" }, WORDING).note
}

describe("where a profile comes from", () => {
  test("decides what the file may name: a project file no credential, the user config its own", () => {
    expect(ProfileSource.PROJECT.credentials).toBe("none")
    expect(ProfileSource.USER_CONFIG.credentials).toBe("env-or-literal")
    expect(ProfileSource.of("file")).toBe(ProfileSource.PROJECT)
    expect(ProfileSource.of("user-config")).toBe(ProfileSource.USER_CONFIG)
  })

  test("labels a problem of the user config apart from a project file's", () => {
    const message = "The text is not valid JSON (line 1, column 2)."

    expect(new TargetsProblem(PROJECT, message).label()).toBe(`.pulse.json: ${message}`)
    expect(new TargetsProblem(OWN, message, undefined, ProfileSource.USER_CONFIG).label()).toBe(
      `CLI config: ${message}`,
    )
    expect(new TargetsProblem(OWN, message, undefined, ProfileSource.USER_CONFIG).detail()).toBe(
      `${OWN}: ${message}`,
    )
  })

  test("names the file a read-only profile comes from", () => {
    expect(readOnlyFrom({ kind: "file", path: PROJECT })).toBe(
      "Read-only. local is a read-only profile in .pulse.json.",
    )
    expect(readOnlyFrom({ kind: "user-config", path: OWN })).toBe(
      "Read-only. local is a read-only profile in your CLI config.",
    )
    expect(readOnlyFrom({ kind: "default" })).toBe(
      "Read-only. local is a read-only profile in its project file.",
    )
  })
})
