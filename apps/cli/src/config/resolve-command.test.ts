/**
 * The token command of OPERATE_TOKEN_COMMAND (design §23) and profiles of a project file (design
 * §22) in config resolution: the token sources and their order, unused commands, the profile
 * selection with a project file and what `config show` makes of it.
 */

import { describe, expect, it } from "vitest"
import { OperateError } from "../errors.js"
import { parseConfigFile } from "./file.js"
import { showConfig } from "./edit.js"
import { mergeProject } from "./project.js"
import { bearerSource, unusedTokenNote } from "./resolve-bearer.js"
import { resolveAuth, selectedAuth } from "./resolve-auth.js"
import { missingProfileError, resolveConfig, selectProfile } from "./resolve.js"
import type { LoadedConfig, ProfileAuth, ProjectSource, SelectedProfile } from "./types.js"

function failure(action: () => unknown): OperateError {
  try {
    action()
  } catch (error) {
    if (error instanceof OperateError) return error
    throw error
  }
  throw new Error("expected an OperateError")
}

const PROJECT: ProjectSource = { path: "/repo/.operate.json", directory: "/repo" }

function profile(auth: ProfileAuth): SelectedProfile {
  return { name: "dev", profile: { auth } }
}

const COMMAND_ENV = { OPERATE_TOKEN_COMMAND: " ./token.sh dev " }

describe("resolveAuth with a token command", () => {
  it("takes OPERATE_TOKEN_COMMAND, trimmed, and selects bearer auth without a type", () => {
    const resolved = resolveAuth({}, COMMAND_ENV, {})
    expect(resolved.source).toBe("env")
    expect(resolved.auth).toEqual({
      type: "bearer",
      source: "env",
      origin: "OPERATE_TOKEN_COMMAND",
      command: "./token.sh dev",
    })
    expect(selectedAuth({}, COMMAND_ENV, {})).toEqual({
      type: "bearer",
      source: "env",
      label: "a bearer token command (from OPERATE_TOKEN_COMMAND) without an auth type",
      token: { origin: "OPERATE_TOKEN_COMMAND", command: true },
    })
    // a blank variable is unset
    expect(resolveAuth({}, { OPERATE_TOKEN_COMMAND: "  " }, {}).auth.type).toBe("none")
  })

  it("comes after --auth-token-stdin and OPERATE_TOKEN, before the profile", () => {
    const stored = profile({ type: "bearer", tokenEnv: "CI_TOKEN" })
    const env = { ...COMMAND_ENV, CI_TOKEN: "ci" }
    expect(resolveAuth({}, env, stored).auth).toMatchObject({
      command: "./token.sh dev",
      profile: "dev",
    })
    const token = resolveAuth({}, { ...env, OPERATE_TOKEN: "tok" }, stored)
    expect(token.auth).toMatchObject({ token: "tok", origin: "OPERATE_TOKEN" })
    const piped = resolveAuth({ authToken: "piped" }, env, stored)
    expect(piped.auth).toMatchObject({ token: "piped", origin: "--auth-token-stdin" })
    expect(resolveAuth({}, { CI_TOKEN: "ci" }, stored).auth).toMatchObject({ token: "ci" })
  })

  it("is no key of a profile", () => {
    const text = JSON.stringify({
      profiles: { p: { auth: { type: "bearer", tokenCommand: "c" } } },
    })
    const error = failure(() => parseConfigFile(text, "/c.json"))
    expect(error.message).toBe(
      'Invalid config file /c.json: profile "p" sets auth.tokenCommand, which operate no longer reads: remove the key from the file and export OPERATE_TOKEN_COMMAND=<command> instead',
    )
  })

  it("names a Basic auth and token command conflict", () => {
    const error = failure(() => resolveAuth({ authUser: "u" }, COMMAND_ENV, {}))
    expect(error.message).toBe(
      "Both Basic auth and a bearer token command are configured, but no auth type says which one to use",
    )
    expect(error.details.hint).toContain(
      "a bearer token command (from OPERATE_TOKEN_COMMAND) selects bearer auth",
    )
  })

  it("reports an unused command next to another auth type", () => {
    const basic = profile({ type: "basic", username: "u", password: "p" })
    const resolved = resolveAuth({}, { OPERATE_TOKEN_COMMAND: "c" }, basic)
    expect(resolved.unusedToken).toEqual({
      value: "c",
      source: "env",
      reason: 'Basic auth is selected by the auth.type of profile "dev"',
      command: true,
    })
    expect(unusedTokenNote(resolved.unusedToken!)).toBe(
      'A bearer token command is set (from OPERATE_TOKEN_COMMAND) but not used: Basic auth is selected by the auth.type of profile "dev"; send it with --auth bearer or OPERATE_AUTH=bearer.',
    )
    const off = resolveAuth({ auth: "none" }, { OPERATE_TOKEN_COMMAND: "c" }, {})
    expect(unusedTokenNote(off.unusedToken!, true)).toBe(
      "A bearer token command is set (from OPERATE_TOKEN_COMMAND) but not used: bearer auth is switched off by --auth none; use it with OPERATE_AUTH=bearer.",
    )
  })

  it("is named in the hint of a missing token", () => {
    const error = failure(() => resolveAuth({ auth: "bearer" }, {}, {}))
    expect(error.details.hint).toContain(
      "Looked up the token in --auth-token-stdin, OPERATE_TOKEN, OPERATE_TOKEN_COMMAND and a profile (none is selected).",
    )
    expect(error.details.hint).toContain("export OPERATE_TOKEN_COMMAND=<command>")
  })
})

describe("bearerSource", () => {
  const context = (selected: SelectedProfile, env = {}) => ({ flags: {}, env, selected })

  it("names where the token would come from without reading a variable", () => {
    expect(bearerSource(context(profile({ tokenEnv: "UNSET" })))).toEqual({
      origin: 'auth.tokenEnv of profile "dev"',
      command: false,
    })
    expect(bearerSource(context(profile({ token: "t" })))).toEqual({
      origin: 'auth.token of profile "dev"',
      command: false,
    })
    expect(bearerSource(context(profile({}), { OPERATE_TOKEN_COMMAND: "c" }))).toEqual({
      origin: "OPERATE_TOKEN_COMMAND",
      command: true,
    })
    expect(bearerSource(context(profile({})))).toBeUndefined()
    expect(bearerSource(context({}))).toBeUndefined()
  })
})

describe("profiles of a project file", () => {
  const source = PROJECT
  const file = mergeProject(
    { defaultProfile: "mine", profiles: { mine: { url: "http://mine" } } },
    { source, file: { defaultProfile: "svc", profiles: { svc: { url: "http://svc" } } } },
  )!

  it("selects the project default and says where the profile comes from", () => {
    expect(selectProfile({}, {}, file)).toEqual({
      name: "svc",
      profile: { url: "http://svc" },
      project: source,
    })
    expect(selectProfile({ profile: "mine" }, {}, file)).toEqual({
      name: "mine",
      profile: { url: "http://mine" },
    })
    const resolved = resolveConfig({}, {}, file)
    expect(resolved).toMatchObject({ profile: "svc", url: "http://svc", project: source })
    expect(resolveConfig({ profile: "mine" }, {}, file).project).toBeUndefined()
  })

  it("names the project file when its default profile is missing", () => {
    const broken: LoadedConfig = { ...file, defaultProfile: "gone" }
    const error = failure(() => selectProfile({}, {}, broken))
    expect(error.details.hint).toBe(
      "It is the defaultProfile of the project file /repo/.operate.json; choose another one with `operate config use <profile> --project`. Known profiles: svc, mine. Create it with `operate config set gone --url <url>`.",
    )
    expect(missingProfileError("x", { profiles: {} }, "default").details.hint).toBe(
      "It is the defaultProfile of the config file; choose another one with `operate config use <profile>`. Create it with `operate config set x --url <url>`.",
    )
  })

  it("shows the project file and the file of the selected profile", () => {
    const view = showConfig(resolveConfig({}, {}, file), "/c.json", PROJECT.path)
    expect(view).toMatchObject({
      configFile: "/c.json",
      projectFile: PROJECT.path,
      profile: "svc",
      profileFile: PROJECT.path,
    })
    const own = showConfig(resolveConfig({ profile: "mine" }, {}, file), "/c.json", PROJECT.path)
    expect(own).toMatchObject({ profileFile: "/c.json" })
    expect(showConfig(resolveConfig({}, {}, undefined), "/c.json")).toMatchObject({
      projectFile: null,
      profileFile: null,
    })
  })
})

describe("config show with a token command", () => {
  it("shows the command (never run)", () => {
    const resolved = resolveConfig({}, { OPERATE_TOKEN_COMMAND: "c" }, undefined)
    const view = showConfig(resolved, "/c.json")
    expect(view.values.tokenCommand).toEqual({ value: "c", source: "env" })
    expect(view.values.token).toBeUndefined()
  })

  it("shows an unused command as unused", () => {
    const resolved = resolveConfig({ auth: "none" }, { OPERATE_TOKEN_COMMAND: "c" }, undefined)
    expect(showConfig(resolved, "/c.json").values).toMatchObject({
      tokenCommand: {
        value: "c",
        source: "env",
        unused: "bearer auth is switched off by --auth none",
      },
    })
  })
})
