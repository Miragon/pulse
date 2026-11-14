/**
 * Camunda 8 profiles in a file the CLI reads: the file loads, a command that uses one fails with
 * the CLI's way out (profile-problems.ts), and `config set` and `config unset` change no single
 * setting of Camunda 8's client credentials, which another Pulse client serves and whose rules the
 * CLI does not know, while `config unset <profile> auth` removes the whole object, the MCP
 * server's passthrough (it holds no setting) and a type no client knows stay repairable, and no
 * edit gives a profile an auth type its flavor does not take (edit.ts, auth-edit.ts).
 */

import { describe, expect, it } from "vitest"
import { failure } from "../../test/support/failure.js"
import { setProfile, unsetProfileKeys } from "./edit.js"
import { parseConfigFile } from "./file.js"
import { mergeProject, parseProjectFile } from "./project.js"
import { resolveConfig } from "./resolve.js"
import type { ConfigFile } from "./types.js"

const C8_URL = "https://c8.example.com/v2"
const TOKEN_ENDPOINT = "https://login.example.com/oauth/token"

/** The user's file with a Camunda 8 profile of the editors, an MCP server's and a broken one. */
const FILE: ConfigFile = parseConfigFile(
  JSON.stringify({
    profiles: {
      c8: {
        url: C8_URL,
        flavor: "camunda8",
        auth: {
          type: "clientCredentials",
          tokenEndpoint: TOKEN_ENDPOINT,
          clientId: "pulse",
          audience: "zeebe-api",
        },
      },
      open: { url: C8_URL, flavor: "camunda8" },
      gateway: { url: "http://engine:8080/engine-rest", auth: { type: "passthrough" } },
      typo: { url: "http://localhost:8080/engine-rest", auth: { type: "kerberos" } },
    },
  }),
  "/home/me/.config/pulse-cli/config.json",
)

describe("an auth type the CLI does not serve", () => {
  it.each([
    [{ oauthAudience: "other" }],
    [{ auth: "basic", authUser: "demo" }],
    [{ oauthClientSecretEnv: "C8_SECRET" }],
  ])("refuses an auth option of config set on client credentials: %j", (changes) => {
    const error = failure(() => setProfile(FILE, "c8", changes))
    expect(error.code).toBe("CONFIG")
    expect(error.message).toBe(
      'Profile "c8" signs in with clientCredentials, which the CLI does not edit',
    )
    expect(error.details.hint).toBe(
      "Edit its auth in the file, or remove all its auth settings with `pulse config unset c8 auth`.",
    )
  })

  it("lets config set change the other keys and keeps the auth as the file has it", () => {
    const edited = setProfile(FILE, "c8", { cockpitUrl: "https://c8.example.com/operate" })
    expect(edited.profiles.c8).toEqual({
      ...FILE.profiles.c8,
      cockpitUrl: "https://c8.example.com/operate",
    })
  })

  it.each([["tokenEndpoint"], ["audience"], ["auth.clientId"], ["clientSecret"], ["auth.type"]])(
    "refuses config unset of the single setting %s, stored or not",
    (key) => {
      const error = failure(() => unsetProfileKeys(FILE, "c8", [key]))
      expect(error.code).toBe("CONFIG")
      expect(error.message).toBe(
        'Profile "c8" signs in with clientCredentials, which the CLI does not edit',
      )
    },
  )

  it("still removes the whole auth object with config unset auth", () => {
    expect(unsetProfileKeys(FILE, "c8", ["auth"]).profiles.c8).toEqual({
      url: C8_URL,
      flavor: "camunda8",
    })
    expect(unsetProfileKeys(FILE, "gateway", ["auth"]).profiles.gateway).toEqual({
      url: "http://engine:8080/engine-rest",
    })
  })

  it("lets an auth option replace the MCP server's passthrough, which holds no setting", () => {
    expect(setProfile(FILE, "gateway", { auth: "bearer" }).profiles.gateway).toEqual({
      url: "http://engine:8080/engine-rest",
      auth: { type: "bearer" },
    })
    expect(unsetProfileKeys(FILE, "gateway", ["auth.type"]).profiles.gateway).toEqual({
      url: "http://engine:8080/engine-rest",
    })
  })

  it("leaves an auth type no client knows to an auth option, which repairs it", () => {
    expect(setProfile(FILE, "typo", { auth: "basic", authUser: "demo" }).profiles.typo).toEqual({
      url: "http://localhost:8080/engine-rest",
      auth: { type: "basic", username: "demo" },
    })
    expect(unsetProfileKeys(FILE, "typo", ["auth.type"]).profiles.typo).toEqual({
      url: "http://localhost:8080/engine-rest",
    })
  })
})

describe("an auth type the flavor of a profile does not take", () => {
  it("refuses config set that gives a camunda8 profile an OAuth login", () => {
    const error = failure(() =>
      setProfile(FILE, "open", { oauthIssuer: "https://login.example.com", oauthClientId: "p" }),
    )
    expect(error.code).toBe("CONFIG")
    expect(error.message).toBe(
      'Profile "open" would sign in with oauth, which its flavor camunda8 does not take',
    )
    expect(error.details.hint).toBe(
      "Flavor camunda8 takes the auth types none, basic, bearer, clientCredentials: choose one of them with --auth, or remove all auth settings with `pulse config unset open auth` first.",
    )
  })

  it.each([
    ["config set --flavor", () => setProfile(FILE, "c8", { flavor: "operaton" }), "operaton"],
    ["config unset flavor", () => unsetProfileKeys(FILE, "c8", ["flavor"]), "camunda7"],
  ])("refuses %s that leaves client credentials on Camunda 7", (_, edit, flavor) => {
    expect(failure(edit).message).toBe(
      `Profile "c8" would sign in with clientCredentials, which its flavor ${flavor} does not take`,
    )
  })

  it("lets config set give a camunda8 profile a type its flavor takes", () => {
    expect(setProfile(FILE, "open", { auth: "bearer" }).profiles.open).toEqual({
      url: C8_URL,
      flavor: "camunda8",
      auth: { type: "bearer" },
    })
  })

  it("keeps a profile the file holds that way editable", () => {
    const file = parseConfigFile(
      JSON.stringify({ profiles: { p: { flavor: "camunda8", auth: { type: "oauth" } } } }),
      "/home/me/config.json",
    )
    expect(setProfile(file, "p", { oauthAudience: "a" }).profiles.p).toEqual({
      flavor: "camunda8",
      auth: { type: "oauth", audience: "a" },
    })
    expect(setProfile(file, "p", { auth: "basic", authUser: "demo" }).profiles.p).toEqual({
      flavor: "camunda8",
      auth: { type: "basic", username: "demo" },
    })
  })
})

/** The error of a command that uses profile `name` of the user's file holding `profiles`. */
function useError(profiles: Readonly<Record<string, unknown>>, name: string) {
  const file = parseConfigFile(JSON.stringify({ profiles }), "/home/me/config.json")
  return failure(() => resolveConfig({ profile: name }, {}, file))
}

describe("a command that uses a Camunda 8 profile", () => {
  it("fails with the CLI's dialect, never a way that changes the profile", () => {
    const error = useError(FILE.profiles, "c8")
    expect(error.code).toBe("CONFIG")
    expect(error.message).toBe(
      'Profile "c8" of your config file cannot be used: This client does not speak the API of this flavor. This client cannot authenticate with this auth.type.',
    )
    expect(error.details.hint).toBe(
      "The CLI reads engines of the Camunda 7 REST API (operaton, cibseven, camunda7) and leaves this profile as it stands: choose another one with --profile or PULSE_CLI_PROFILE, or give --url, which selects no profile.",
    )
  })

  it("names the way out of an auth type the flavor does not take, in the project file too", () => {
    const profiles = { p: { auth: { type: "clientCredentials", tokenEndpoint: TOKEN_ENDPOINT } } }
    expect(useError(profiles, "p").details.hint).toBe(
      "Fix auth.type or flavor in the file, or remove all auth settings with `pulse config unset p auth`.",
    )
    const project = parseProjectFile(JSON.stringify({ profiles }), "/repo/.pulse.json")
    const loaded = mergeProject(undefined, {
      source: { path: "/repo/.pulse.json", directory: "/repo" },
      file: project,
    })
    expect(failure(() => resolveConfig({ profile: "p" }, {}, loaded)).details.hint).toBe(
      "Fix auth.type or flavor in the file, or remove all auth settings with `pulse config unset p auth --project`.",
    )
  })

  it("sends a missing token endpoint to the file, which pulse config does not edit", () => {
    const profiles = {
      c8: { url: C8_URL, flavor: "camunda8", auth: { type: "clientCredentials" } },
    }
    const error = useError(profiles, "c8")
    expect(error.message).toContain("auth.tokenEndpoint is missing")
    expect(error.details.hint).toBe(
      "Set auth.tokenEndpoint in the file: pulse config does not edit client credentials.",
    )
  })
})
