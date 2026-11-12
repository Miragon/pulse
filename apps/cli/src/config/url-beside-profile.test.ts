/**
 * A `--url` beside `--profile` (url-beside-profile.ts): a profile of the user's own config file
 * that holds a header (any, whatever its name) or a credential (Basic auth, OAuth, a bearer token)
 * fails (CONFIG) when the flag's origin is not the one of its own `url`, before its credentials
 * resolve; the same origin in any spelling, a profile without headers or credentials beside the
 * user's own `-H` and PULSE_CLI_HEADERS, one of the project file, PULSE_CLI_URL and a URL without
 * `--profile` go on as before.
 */

import { describe, expect, it } from "vitest"
import { failure } from "../../test/support/failure.js"
import { mergeProject } from "./project.js"
import { resolveConfig, selectProfile } from "./resolve.js"
import type { ConfigFile, ConfigFlags, LoadedConfig, Profile, ProjectSource } from "./types.js"

const OWN = "https://orders.example.com/engine-rest"
const FOREIGN = "http://127.0.0.1:8942/engine-rest"
const SOURCE: ProjectSource = { path: "/repo/.pulse.json", directory: "/repo" }

/** The user's config file holding `orders` as given. */
function userFile(orders: Profile, extra: Partial<LoadedConfig> = {}): LoadedConfig {
  return { profiles: { orders }, ...extra }
}

/** The flags of the editors' command for a project file's target: --profile beside --url. */
function beside(url = FOREIGN, more: ConfigFlags = {}): ConfigFlags {
  return { profile: "orders", url, ...more }
}

/** What a profile can hold of each kind, by the words the error names it with. */
const HOLDING: readonly (readonly [string, Profile])[] = [
  ["a header (Authorization)", { headers: { Authorization: "Bearer profile-token" } }],
  ["headers (X-Api-Key, X-Team)", { headers: { "X-Api-Key": "profile-key", "X-Team": "t" } }],
  ["a header (Cookie)", { headers: { Cookie: "session=profile-cookie" } }],
  // every header counts, whatever its name: a plain one and a credential by a name masking misses
  ["a header (X-Team)", { headers: { "X-Team": "profile-team" } }],
  [
    "a header (Ocp-Apim-Subscription-Key)",
    { headers: { "Ocp-Apim-Subscription-Key": "profile-key" } },
  ],
  ["a header (X-Auth)", { headers: { "X-Auth": "profile-token" } }],
  ["Basic auth", { auth: { type: "basic", username: "demo", passwordEnv: "UNSET_VARIABLE" } }],
  ["Basic auth", { auth: { username: "demo" } }],
  ["Basic auth", { auth: { password: "profile-password" } }],
  ["an OAuth login", { auth: { type: "oauth", issuer: "https://idp/realms/r", clientId: "c" } }],
  ["an OAuth login", { auth: { type: "oauth" } }],
  ["an OAuth login", { auth: { clientSecretEnv: "UNSET_VARIABLE" } }],
  ["a bearer token", { auth: { type: "bearer", tokenEnv: "UNSET_VARIABLE" } }],
  ["a bearer token", { auth: { token: "profile-token" } }],
]

describe("a --url beside --profile of another origin than a profile of yours that holds one", () => {
  it.each(HOLDING)("fails for %s (case %#), before any credential resolves", (what, held) => {
    const file = userFile({ url: OWN, engine: "orders", ...held })
    const error = failure(() => resolveConfig(beside(), {}, file))
    const them = what.startsWith("headers") ? "them" : "it"
    expect(error.code).toBe("CONFIG")
    expect(error.message).toBe(
      `Profile "orders" of your config file holds ${what} for https://orders.example.com; pulse does not send ${them} to http://127.0.0.1:8942, the origin --url names`,
    )
    expect(error.details.hint).toBe(
      "Drop --url to use the profile with its own URL, or point the profile at that engine with `pulse config set orders --url <url>`.",
    )
    expect(failure(() => selectProfile(beside(), {}, file)).message).toBe(error.message)
    expect(`${error.message} ${error.details.hint ?? ""}`).not.toMatch(
      /profile-(token|key|password|team|cookie)/,
    )
  })

  it("names every kind it holds, and the auth type that selects OAuth for it", () => {
    const both: Profile = {
      url: OWN,
      headers: { Authorization: "a", "X-Api-Key": "k" },
      auth: { username: "demo" },
    }
    expect(failure(() => selectProfile(beside(), {}, userFile(both))).message).toContain(
      " holds headers (Authorization, X-Api-Key) and Basic auth for https://orders.example.com; pulse does not send them ",
    )
    const three: Profile = {
      url: OWN,
      headers: { "X-Team": "t" },
      auth: { username: "demo", tokenEnv: "UNSET_VARIABLE" },
    }
    expect(failure(() => selectProfile(beside(), {}, userFile(three))).message).toContain(
      " holds a header (X-Team), Basic auth and a bearer token for ",
    )
    // OAuth from the flag or the environment logs the profile in under its own name
    const bare = userFile({ url: OWN })
    expect(selectProfile(beside(), {}, bare).name).toBe("orders")
    for (const [flags, env] of [
      [beside(FOREIGN, { auth: "oauth" }), {}],
      [beside(), { PULSE_CLI_AUTH: "oauth" }],
    ] as const) {
      expect(failure(() => selectProfile(flags, env, bare)).message).toContain(
        " holds an OAuth login for https://orders.example.com; pulse does not send it ",
      )
    }
  })

  it("counts a credential the flags or the environment switch off: the profile holds it", () => {
    const off: readonly (readonly [Profile, ConfigFlags, Record<string, string>])[] = [
      [{ auth: { type: "oauth" } }, { auth: "none" }, {}],
      [{ auth: { type: "oauth" } }, {}, { PULSE_CLI_AUTH: "none" }],
      [{ auth: { type: "oauth" } }, {}, { PULSE_CLI_AUTH: "basic" }],
      [{ auth: { issuer: "https://idp/realms/r", clientId: "c" } }, { auth: "none" }, {}],
      [{ auth: { username: "demo", password: "p" } }, { auth: "none" }, {}],
      [{ auth: { type: "bearer", token: "t" } }, { auth: "none" }, {}],
      [{ headers: { Authorization: "Bearer t" } }, { headers: ["Authorization: other"] }, {}],
      [{ headers: { "X-Team": "t" } }, { headers: ["x-team: other"] }, {}],
      [{ headers: { "X-Team": "t" } }, {}, { PULSE_CLI_HEADERS: "X-Team: other" }],
    ]
    for (const [held, flags, env] of off) {
      const file = userFile({ url: OWN, ...held })
      expect(failure(() => selectProfile(beside(FOREIGN, flags), env, file)).code).toBe("CONFIG")
    }
  })

  it("fails for each origin part that differs: scheme, host and port", () => {
    const file = userFile({
      url: "https://orders.example.com:8443/engine-rest",
      auth: { username: "u" },
    })
    for (const url of [
      "http://orders.example.com:8443/engine-rest",
      "https://billing.example.com:8443/engine-rest",
      "https://orders.example.com/engine-rest",
    ]) {
      expect(failure(() => selectProfile(beside(url), {}, file)).code).toBe("CONFIG")
    }
  })

  it("fails for a profile without a URL of its own, which has no origin", () => {
    const error = failure(() => selectProfile(beside(), {}, userFile({ auth: { username: "u" } })))
    expect(error.message).toBe(
      'Profile "orders" of your config file holds Basic auth but no URL; pulse does not send it to http://127.0.0.1:8942, the origin --url names',
    )
    expect(error.details.hint).toBe(
      "Point the profile at that engine with `pulse config set orders --url <url>`.",
    )
    // a URL the profile format would refuse (the file refuses such a profile) counts as none
    const odd = userFile({ url: "no url", auth: { username: "u" } })
    expect(failure(() => selectProfile(beside(), {}, odd)).message).toBe(error.message)
    // a header alone, whatever its name, keeps it from every --url too
    const team = failure(() =>
      selectProfile(beside(), {}, userFile({ headers: { "X-Team": "t" } })),
    )
    expect(team.message).toBe(
      'Profile "orders" of your config file holds a header (X-Team) but no URL; pulse does not send it to http://127.0.0.1:8942, the origin --url names',
    )
    expect(team.details.hint).toBe(error.details.hint)
  })

  it("names the config file --config or PULSE_CLI_CONFIG names", () => {
    const file = userFile({ url: OWN, auth: { username: "u" } }, { configFile: "/etc/pulse.json" })
    expect(failure(() => selectProfile(beside(), {}, file)).message).toMatch(
      /^Profile "orders" of the config file \/etc\/pulse\.json holds Basic auth for /,
    )
  })

  it("fails on an invalid --url as such first", () => {
    const file = userFile({ url: OWN, auth: { username: "u" } })
    expect(failure(() => selectProfile(beside("ftp://h"), {}, file)).message).toMatch(
      /^Engine URL must start with http:\/\/ or https:\/\//,
    )
  })
})

describe("a --url beside --profile that goes on", () => {
  const holding: Profile = {
    url: "http://Orders.example.com:80/engine-rest",
    headers: { "X-Api-Key": "profile-key" },
    auth: { type: "basic", username: "demo", password: "profile-password" },
  }

  it("of the profile's own origin, in any spelling: the profile applies per value", () => {
    for (const url of [
      "HTTP://orders.EXAMPLE.com/other-rest/",
      "http://orders.example.com:80",
      " http://orders.example.com/engine-rest ",
    ]) {
      const resolved = resolveConfig(beside(url), {}, userFile(holding))
      expect(resolved).toMatchObject({
        profile: "orders",
        url: url.trim().replace(/\/+$/, ""),
        headers: holding.headers,
        auth: { type: "basic", username: "demo", password: "profile-password" },
        sources: { url: "flag", headers: "profile" },
      })
    }
  })

  it("for a profile without a header or a credential: no stored auth, a type alone", () => {
    const plain: readonly Profile[] = [
      { url: OWN, engine: "orders", headers: {}, readOnly: true, timeout: 5000 },
      { url: OWN, auth: { type: "none" } },
      { url: OWN, auth: { type: "basic" } },
      { url: OWN, auth: { type: "bearer" } },
      {},
    ]
    for (const profile of plain) {
      const resolved = resolveConfig(beside(), { PULSE_CLI_AUTH: "none" }, userFile(profile))
      expect(resolved).toMatchObject({ profile: "orders", url: FOREIGN, headers: {} })
    }
  })

  it("beside -H and PULSE_CLI_HEADERS, your own per run, for a profile without headers", () => {
    const flags = beside(FOREIGN, { headers: ["X-Team: mine"] })
    const env = { PULSE_CLI_HEADERS: "X-Api-Key: run-key\nOcp-Apim-Subscription-Key: run-sub" }
    expect(resolveConfig(flags, env, userFile({ url: OWN }))).toMatchObject({
      profile: "orders",
      url: FOREIGN,
      headers: { "X-Team": "mine", "X-Api-Key": "run-key", "Ocp-Apim-Subscription-Key": "run-sub" },
      sources: { url: "flag", headers: "flag" },
    })
  })

  it("for a profile of the project file, which chose its URL itself", () => {
    const project: ConfigFile = { profiles: { orders: { url: OWN, headers: { "X-Team": "t" } } } }
    const merged = mergeProject(undefined, { source: SOURCE, file: project })
    expect(resolveConfig(beside(), {}, merged)).toMatchObject({
      profile: "orders",
      url: FOREIGN,
      headers: { "X-Team": "t" },
      project: SOURCE,
    })
    // its OAuth login, stored or selected, goes along too: the project file chose that origin
    const sso: ConfigFile = {
      profiles: {
        orders: { url: OWN, auth: { type: "oauth", issuer: "https://idp/r", clientId: "c" } },
      },
    }
    const oauth = mergeProject(undefined, { source: SOURCE, file: sso })
    expect(resolveConfig(beside(), {}, oauth)).toMatchObject({
      url: FOREIGN,
      auth: { type: "oauth", issuer: "https://idp/r", clientId: "c" },
      project: SOURCE,
    })
    const env = {
      PULSE_CLI_AUTH: "oauth",
      PULSE_CLI_OAUTH_ISSUER: "https://idp/r",
      PULSE_CLI_OAUTH_CLIENT_ID: "c",
    }
    expect(resolveConfig(beside(), env, merged)).toMatchObject({
      url: FOREIGN,
      auth: { type: "oauth" },
      project: SOURCE,
    })
    // a project profile with a secret header is refused as such, whatever the URL
    const secret = {
      profiles: { orders: { url: OWN } },
      refused: { orders: [{ code: "secret-header" as const, key: "headers" }] },
    }
    const refused = mergeProject(undefined, { source: SOURCE, file: secret })
    expect(failure(() => selectProfile(beside(), {}, refused)).message).toMatch(
      /^Profile "orders" of the project file \/repo\/\.pulse\.json cannot be used/,
    )
  })

  it("but not when the name is in both files and resolves to your profile", () => {
    const project: ConfigFile = { profiles: { orders: { url: FOREIGN } } }
    const user = userFile({ url: OWN, headers: { "X-Api-Key": "profile-key" } })
    const merged = mergeProject(user, { source: SOURCE, file: project })
    expect(failure(() => selectProfile(beside(), {}, merged)).message).toMatch(
      /^Profile "orders" of your config file holds a header \(X-Api-Key\) for /,
    )
    const plain = mergeProject(userFile({ url: OWN, headers: { "X-Team": "mine" } }), {
      source: SOURCE,
      file: project,
    })
    expect(failure(() => selectProfile(beside(), {}, plain)).message).toMatch(
      /^Profile "orders" of your config file holds a header \(X-Team\) for /,
    )
    // the same origin as the project's URL is the common case: it goes on
    const same = mergeProject(userFile({ url: FOREIGN, headers: { "X-Api-Key": "k" } }), {
      source: SOURCE,
      file: project,
    })
    expect(resolveConfig(beside(), {}, same)).toMatchObject({
      url: FOREIGN,
      headers: { "X-Api-Key": "k" },
    })
    const team = mergeProject(userFile({ url: FOREIGN, headers: { "X-Team": "mine" } }), {
      source: SOURCE,
      file: project,
    })
    expect(resolveConfig(beside(), {}, team)).toMatchObject({
      url: FOREIGN,
      headers: { "X-Team": "mine" },
    })
  })

  it("for PULSE_CLI_URL beside --profile, which stays per value", () => {
    const resolved = resolveConfig(
      { profile: "orders" },
      { PULSE_CLI_URL: FOREIGN },
      userFile(holding),
    )
    expect(resolved).toMatchObject({
      url: FOREIGN,
      headers: holding.headers,
      sources: { url: "env" },
    })
  })

  it("for a --url without --profile, which selects no profile", () => {
    const file = userFile(holding, { defaultProfile: "orders" })
    for (const env of [{}, { PULSE_CLI_PROFILE: "orders" }]) {
      expect(resolveConfig({ url: FOREIGN }, env, file)).toMatchObject({
        url: FOREIGN,
        headers: {},
      })
    }
  })
})
