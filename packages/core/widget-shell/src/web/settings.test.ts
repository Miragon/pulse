import { describe, expect, it } from "vitest"
import { oauthKeycloakProvider } from "../oauth-providers.js"
import { describeWebSettings, readWebSettings, WEB_ENV_VARS } from "./settings.js"

const provider = oauthKeycloakProvider({ serverUrl: "https://kc.example.test", realm: "pulse" })
const KEY = Buffer.alloc(32, 7).toString("base64url")
const OLD_KEY = Buffer.alloc(48, 9).toString("base64url")
const SECRET = "s3cret-value"

const ON = {
  MCP_WEB_CLIENT_ID: "pulse-web",
  MCP_WEB_CLIENT_SECRET: SECRET,
  MCP_WEB_SESSION_KEYS: KEY,
}
const MCP_URL = "https://pulse.example.test"
/** The folder of the web build the root names. */
const ROOT_DIR = "/srv/pulse/web"

/** `mcpUrl` null: MCP_URL unset; `dir` null: the root names no web build. */
const read = (
  env: NodeJS.ProcessEnv,
  mcpUrl: string | null = MCP_URL,
  oauth = true,
  dir: string | null = ROOT_DIR,
) =>
  readWebSettings(env, {
    provider: oauth ? provider : undefined,
    mcpUrl: mcpUrl ?? undefined,
    dir: dir ?? undefined,
  })

const refusal = (
  env: NodeJS.ProcessEnv,
  mcpUrl: string | null = MCP_URL,
  oauth = true,
  dir: string | null = ROOT_DIR,
): string => {
  try {
    read(env, mcpUrl, oauth, dir)
  } catch (error) {
    return (error as Error).message
  }
  throw new Error("expected the settings to be refused")
}

describe("WEB_ENV_VARS", () => {
  it("names every variable the web app reads", () => {
    expect(WEB_ENV_VARS).toEqual([
      "MCP_WEB_CLIENT_ID",
      "MCP_WEB_CLIENT_SECRET",
      "MCP_WEB_SCOPES",
      "MCP_WEB_SESSION_KEYS",
      "MCP_WEB_SESSION_HOURS",
      "MCP_WEB_SESSION_CHECK_MINUTES",
      "MCP_WEB_DIR",
    ])
  })
})

describe("readWebSettings", () => {
  it("leaves the web app off without a client id, also without a provider or MCP_URL", () => {
    expect(read({}, null, false)).toBeUndefined()
    expect(read({ MCP_WEB_CLIENT_ID: "  " })).toBeUndefined()
    expect(read({ MCP_WEB_DIR: "/srv/web" }, null, false)).toBeUndefined()
  })

  it("reads the client, the decoded keys in order, the default 8 hours and MCP_URL's origin", () => {
    const settings = read(
      { ...ON, MCP_WEB_SESSION_KEYS: ` ${KEY} ,, ${OLD_KEY}=,` },
      "https://pulse.example.test:8443/",
    )
    expect(settings).toEqual({
      clientId: "pulse-web",
      clientSecret: SECRET,
      scopes: undefined,
      sessionKeys: [new Uint8Array(32).fill(7), new Uint8Array(48).fill(9)],
      sessionHours: 8,
      sessionCheckMinutes: undefined,
      dir: ROOT_DIR,
      origin: "https://pulse.example.test:8443",
    })
    expect(settings).toHaveProperty("sessionCheckMinutes", undefined)
    expect(settings).toHaveProperty("scopes", undefined)
  })

  it("reads the scopes the sign-in asks for, separated by spaces or commas, each once", () => {
    expect(read({ ...ON, MCP_WEB_SCOPES: " " })?.scopes).toBeUndefined()
    expect(read({ ...ON, MCP_WEB_SCOPES: "openid" })?.scopes).toEqual(["openid"])
    expect(
      read({ ...ON, MCP_WEB_SCOPES: " openid,profile  offline_access openid api://pulse/mcp " })
        ?.scopes,
    ).toEqual(["openid", "profile", "offline_access", "api://pulse/mcp"])
  })

  it("refuses scopes that hold no scope, or a character no scope holds", () => {
    expect(refusal({ ...ON, MCP_WEB_SCOPES: " , ," })).toBe(
      "MCP_WEB_SCOPES holds no scope. Name the scopes, separated by spaces or commas.",
    )
    for (const odd of ['say"hi', "back\\slash", "umlaut-ä"]) {
      expect(refusal({ ...ON, MCP_WEB_SCOPES: `openid ${odd}` }), odd).toBe(
        `MCP_WEB_SCOPES names "${odd}", which is no scope (RFC 6749 §3.3).`,
      )
    }
    expect(read({ ...ON, MCP_WEB_SCOPES: "a!#[]~" })?.scopes).toEqual(["a!#[]~"])
  })

  it("takes whole session hours from 1 to 24", () => {
    expect(read({ ...ON, MCP_WEB_SESSION_HOURS: "1" })?.sessionHours).toBe(1)
    expect(read({ ...ON, MCP_WEB_SESSION_HOURS: " 24 " })?.sessionHours).toBe(24)
  })

  it("checks no session at the provider unless told to, then every 1 to 60 whole minutes", () => {
    expect(read({ ...ON, MCP_WEB_SESSION_CHECK_MINUTES: " " })?.sessionCheckMinutes).toBeUndefined()
    expect(read({ ...ON, MCP_WEB_SESSION_CHECK_MINUTES: "1" })?.sessionCheckMinutes).toBe(1)
    expect(read({ ...ON, MCP_WEB_SESSION_CHECK_MINUTES: " 5 " })?.sessionCheckMinutes).toBe(5)
    expect(read({ ...ON, MCP_WEB_SESSION_CHECK_MINUTES: "60" })?.sessionCheckMinutes).toBe(60)
  })

  it("refuses a check that is no whole number of minutes from 1 to 60", () => {
    for (const minutes of ["0", "61", "2.5", "-5", "5m", "1e1"]) {
      expect(refusal({ ...ON, MCP_WEB_SESSION_CHECK_MINUTES: minutes }), minutes).toBe(
        `MCP_WEB_SESSION_CHECK_MINUTES "${minutes}" must be a whole number of minutes from 1 to 60, ` +
          "or unset to renew the session's token only when it is due.",
      )
    }
  })

  it("serves the web build the root names, unless MCP_WEB_DIR names another", () => {
    expect(read(ON)?.dir).toBe(ROOT_DIR)
    expect(read({ ...ON, MCP_WEB_DIR: " /srv/web " })?.dir).toBe("/srv/web")
    expect(read({ ...ON, MCP_WEB_DIR: "/srv/web" }, MCP_URL, true, null)?.dir).toBe("/srv/web")
  })

  it("refuses a client id without a web build, when neither the root nor MCP_WEB_DIR names one", () => {
    expect(refusal({ ...ON, MCP_WEB_DIR: " " }, MCP_URL, true, null)).toBe(
      "MCP_WEB_CLIENT_ID is set, but no web build is named: set MCP_WEB_DIR to the folder the web app was built into.",
    )
  })

  it("serves plain http on the machine itself only", () => {
    expect(read(ON, "http://localhost:8400")?.origin).toBe("http://localhost:8400")
    expect(read(ON, "http://127.0.0.1:8400")?.origin).toBe("http://127.0.0.1:8400")
    expect(read(ON, "http://[::1]:8400")?.origin).toBe("http://[::1]:8400")
    expect(refusal(ON, "http://pulse.example.test")).toBe(
      'MCP_URL "http://pulse.example.test" does not use HTTPS, which the web app\'s session cookie needs: use an https:// URL (plain http:// works only on localhost).',
    )
    expect(refusal(ON, "ftp://localhost")).toContain("does not use HTTPS")
  })

  it("refuses a client id without an OAuth provider", () => {
    expect(refusal(ON, MCP_URL, false)).toBe(
      "MCP_WEB_CLIENT_ID is set, but no OAuth provider is: the web app signs people in through the server's provider. Set one provider's MCP_OAUTH_* variables, or unset MCP_WEB_CLIENT_ID.",
    )
  })

  it("refuses a client id without its secret or without session keys", () => {
    expect(refusal({ ...ON, MCP_WEB_CLIENT_SECRET: " " })).toBe(
      "MCP_WEB_CLIENT_ID is set, but MCP_WEB_CLIENT_SECRET is not: the web app signs in as a confidential client. Set the client's secret.",
    )
    expect(refusal({ ...ON, MCP_WEB_SESSION_KEYS: undefined })).toMatch(
      /^MCP_WEB_CLIENT_ID is set, but MCP_WEB_SESSION_KEYS is not: the session cookie is sealed with them\. Set one or more keys of at least 32 random bytes in base64url, separated by commas \(node -e .+ prints one\)\.$/,
    )
    expect(refusal({ ...ON, MCP_WEB_SESSION_KEYS: " , ," })).toMatch(
      /^MCP_WEB_SESSION_KEYS holds no key\. Set one or more keys/,
    )
  })

  it("refuses a short key or one that is not base64url, by its position and never its value", () => {
    const short = Buffer.alloc(31, 1).toString("base64url")
    const message = refusal({ ...ON, MCP_WEB_SESSION_KEYS: `${KEY},${short}` })
    expect(message).toMatch(/^MCP_WEB_SESSION_KEYS: key 2 holds 31 bytes, fewer than 32\. Set /)
    expect(message).not.toContain(short)
    const standard = `${Buffer.alloc(32, 255).toString("base64")}`
    const wrong = refusal({ ...ON, MCP_WEB_SESSION_KEYS: standard })
    expect(wrong).toMatch(
      /^MCP_WEB_SESSION_KEYS: key 1 is not base64url \(A-Z, a-z, 0-9, - and _\)\. Set /,
    )
    expect(wrong).not.toContain(standard)
    expect(refusal({ ...ON, MCP_WEB_SESSION_KEYS: `${KEY}===` })).toContain(
      "key 1 is not base64url",
    )
  })

  it("refuses session hours that are no whole number from 1 to 24", () => {
    for (const hours of ["0", "25", "1.5", "-1", "8h", "1e1"]) {
      expect(refusal({ ...ON, MCP_WEB_SESSION_HOURS: hours }), hours).toBe(
        `MCP_WEB_SESSION_HOURS "${hours}" must be a whole number of hours from 1 to 24.`,
      )
    }
  })

  it("refuses a client id without MCP_URL, or with one that is no URL", () => {
    expect(refusal(ON, null)).toBe(
      "The web app needs MCP_URL, the server's public origin: the sign-in returns to <MCP_URL>/app/auth/callback.",
    )
    expect(refusal(ON, " ")).toContain("The web app needs MCP_URL")
    expect(refusal(ON, "pulse.example.test")).toBe(
      'MCP_URL "pulse.example.test" is not an absolute URL.',
    )
  })

  it("refuses the client's other variables without the client id, so the web is never off unseen", () => {
    expect(refusal({ MCP_WEB_CLIENT_SECRET: SECRET })).toBe(
      "MCP_WEB_CLIENT_SECRET is set, but MCP_WEB_CLIENT_ID is not, so the web app stays off. Set MCP_WEB_CLIENT_ID to turn it on, or unset the others.",
    )
    expect(refusal({ MCP_WEB_SESSION_KEYS: KEY, MCP_WEB_SESSION_HOURS: "8" })).toBe(
      "MCP_WEB_SESSION_KEYS and MCP_WEB_SESSION_HOURS are set, but MCP_WEB_CLIENT_ID is not, so the web app stays off. Set MCP_WEB_CLIENT_ID to turn it on, or unset the others.",
    )
    expect(refusal({ MCP_WEB_SESSION_CHECK_MINUTES: "5" })).toBe(
      "MCP_WEB_SESSION_CHECK_MINUTES is set, but MCP_WEB_CLIENT_ID is not, so the web app stays off. Set MCP_WEB_CLIENT_ID to turn it on, or unset the others.",
    )
    expect(refusal({ MCP_WEB_SCOPES: "openid" })).toBe(
      "MCP_WEB_SCOPES is set, but MCP_WEB_CLIENT_ID is not, so the web app stays off. Set MCP_WEB_CLIENT_ID to turn it on, or unset the others.",
    )
  })

  it("never quotes the secret or a key in a refusal", () => {
    const messages = [
      refusal({ ...ON, MCP_WEB_SESSION_HOURS: "x" }),
      refusal(ON, null),
      refusal({ MCP_WEB_CLIENT_SECRET: SECRET, MCP_WEB_SESSION_KEYS: KEY }),
    ]
    for (const message of messages) {
      expect(message).not.toContain(SECRET)
      expect(message).not.toContain(KEY)
    }
  })
})

describe("describeWebSettings", () => {
  it("says where the app runs, for which client, for how long and with how many keys, never a secret", () => {
    const one = read(ON)
    const two = read({ ...ON, MCP_WEB_SESSION_KEYS: `${KEY},${OLD_KEY}`, MCP_WEB_DIR: "/srv/web" })
    if (one === undefined || two === undefined) throw new Error("expected settings")
    expect(describeWebSettings(one)).toBe(
      "Web app: on at https://pulse.example.test/app for client pulse-web; sessions last 8 h; 1 session key; web build from /srv/pulse/web.",
    )
    expect(describeWebSettings(two)).toBe(
      "Web app: on at https://pulse.example.test/app for client pulse-web; sessions last 8 h; 2 session keys (the first seals); web build from /srv/web.",
    )
    for (const line of [describeWebSettings(one), describeWebSettings(two)]) {
      expect(line).not.toContain(SECRET)
      expect(line).not.toContain(KEY)
    }
  })

  it("names the scopes the sign-in asks for where MCP_WEB_SCOPES names them", () => {
    const scoped = read({ ...ON, MCP_WEB_SCOPES: "openid,allatclaims" })
    if (scoped === undefined) throw new Error("expected settings")
    expect(describeWebSettings(scoped)).toBe(
      "Web app: on at https://pulse.example.test/app for client pulse-web with the scopes openid allatclaims; sessions last 8 h; 1 session key; web build from /srv/pulse/web.",
    )
  })

  it("names the session's check at the provider where one runs", () => {
    const checked = read({ ...ON, MCP_WEB_SESSION_CHECK_MINUTES: "5" })
    if (checked === undefined) throw new Error("expected settings")
    expect(describeWebSettings(checked)).toBe(
      "Web app: on at https://pulse.example.test/app for client pulse-web; sessions last 8 h, checked at the identity provider every 5 min; 1 session key; web build from /srv/pulse/web.",
    )
  })
})
