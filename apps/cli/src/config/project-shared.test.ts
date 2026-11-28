/**
 * What a project file hands a command: no key of a secret or of the variable that holds one (the
 * profile stays refused, and no reader can reach a variable the repository chose), and a default
 * of its own or none, never the user's, also when its only profile has no valid name or the
 * user's file replaces its default (the user's own default of that name aside).
 */

import { SECRET_KEYS, VARIABLE_KEYS } from "@miragon/pulse-profile"
import { describe, expect, it } from "vitest"
import { PulseCliError } from "../errors.js"
import { parseConfigFile } from "./file.js"
import { mergeProject, parseProjectFile } from "./project.js"
import { selectProfile } from "./resolve.js"
import type { ConfigFile, ProjectSource } from "./types.js"

const path = "/repo/.pulse.json"
const source: ProjectSource = { path, directory: "/repo" }
const ENGINE_URL = "http://h/engine-rest"

describe("a project file", () => {
  it.each([...SECRET_KEYS, ...VARIABLE_KEYS])("keeps no %s in its profiles", (key) => {
    const auth = { type: "basic", username: "u", [key]: "REPO_CHOSEN" }
    const text = JSON.stringify({ profiles: { p: { url: ENGINE_URL, auth } } })
    const file = parseProjectFile(text, path)
    expect(file.profiles).toEqual({
      p: { url: ENGINE_URL, auth: { type: "basic", username: "u" } },
    })
    expect(file.refused?.p).toContainEqual({
      code: "credential-in-shared-file",
      key: `auth.${key}`,
    })
    expect(JSON.stringify(file)).not.toContain("REPO_CHOSEN")
    // the user's own file keeps it: there it names the user's variable
    expect(JSON.stringify(parseConfigFile(text, "/c.json"))).toContain("REPO_CHOSEN")
  })

  it("keeps a profile without an auth object, or with one that is no object, as it is", () => {
    const text = JSON.stringify({
      profiles: { a: { url: ENGINE_URL }, b: { auth: "basic" }, c: 1 },
    })
    expect(parseProjectFile(text, path).profiles).toEqual({
      a: { url: ENGINE_URL },
      b: { auth: "basic" },
      c: 1,
    })
  })

  it("gives no default when its only profile has no valid name, never the user's", () => {
    const user: ConfigFile = { defaultProfile: "prod", profiles: { prod: { url: "https://prod" } } }
    const file = parseProjectFile(
      JSON.stringify({ profiles: { "-dev": { url: ENGINE_URL } } }),
      path,
    )
    const merged = mergeProject(user, { source, file })
    expect(merged?.defaultProfile).toBeUndefined()
    expect(merged?.defaultProblem).toEqual({ problem: { code: "invalid-name" }, project: path })
    let failure: unknown
    try {
      selectProfile({}, {}, merged)
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(PulseCliError)
    expect((failure as PulseCliError).message).toBe(
      `The default profile of the project file ${path} cannot be used: The profile's name is not valid (it is not shown): use letters, digits, ".", "_" and "-", starting with a letter or digit.`,
    )
    expect(selectProfile({ profile: "prod" }, {}, merged).name).toBe("prod")
  })

  it("gives no default when the user's file replaces it, never the user's other one", () => {
    const user: ConfigFile = {
      defaultProfile: "mine",
      profiles: { prod: { url: "https://prod" }, mine: {} },
    }
    const profiles = { prod: { url: ENGINE_URL } }
    const overridden = { overridden: "prod", only: false, project: path }
    const named = mergeProject(user, { source, file: { defaultProfile: "prod", profiles } })
    expect(named?.defaultProfile).toBeUndefined()
    expect(named?.defaultProblem).toEqual(overridden)
    const only = mergeProject(user, { source, file: { profiles } })
    expect(only?.defaultProblem).toEqual({ ...overridden, only: true })
    expect(mergeProject({ profiles: user.profiles }, { source, file: { profiles } })).toMatchObject(
      {
        defaultProblem: { ...overridden, only: true },
      },
    )
    // the user's own default of that name is the user's choice: it stays, as the user's
    const agreed = mergeProject(
      { ...user, defaultProfile: " prod " },
      { source, file: { profiles } },
    )
    expect(agreed).toMatchObject({ defaultProfile: "prod", project: { defaultProfile: false } })
    expect(agreed?.defaultProblem).toBeUndefined()
    expect(selectProfile({}, {}, agreed)).toMatchObject({
      name: "prod",
      profile: user.profiles.prod,
    })
  })
})
