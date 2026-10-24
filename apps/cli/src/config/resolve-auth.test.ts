import { describe, expect, it } from "vitest"
import { NO_PROFILE, profile } from "../../test/support/config-auth.js"
import { failure } from "../../test/support/failure.js"
import { resolveAuth } from "./resolve-auth.js"
import type { ConfigFlags, SelectedProfile } from "./types.js"

describe("resolveAuth type", () => {
  it("is none without any auth setting", () => {
    expect(resolveAuth({}, {}, NO_PROFILE)).toEqual({ auth: { type: "none" }, source: "default" })
    expect(resolveAuth({}, {}, { name: "p", profile: {} })).toEqual({
      auth: { type: "none" },
      source: "default",
    })
  })

  it("takes an explicit none from every source and says where it was set", () => {
    expect(resolveAuth({ auth: "none" }, {}, NO_PROFILE)).toEqual({
      auth: { type: "none", off: "Basic auth is switched off by --auth none" },
      source: "flag",
    })
    expect(resolveAuth({}, { PULSE_CLI_AUTH: " none " }, NO_PROFILE)).toEqual({
      auth: { type: "none", off: "Basic auth is switched off by PULSE_CLI_AUTH=none" },
      source: "env",
    })
    expect(resolveAuth({}, {}, profile({ type: "none" }))).toEqual({
      auth: { type: "none", off: 'Basic auth is switched off by the auth.type of profile "prod"' },
      source: "profile",
    })
  })

  it("says where a password is set that nothing uses (no username, no type)", () => {
    const off = (env: Record<string, string>, selected: SelectedProfile) =>
      resolveAuth({}, env, selected).auth
    expect(off({ PULSE_CLI_PASSWORD: "pw" }, profile({ password: "x" }))).toEqual({
      type: "none",
      off: "a password is set (from PULSE_CLI_PASSWORD), but no username",
    })
    expect(off({ PULSE_CLI_PASSWORD: " " }, profile({ passwordEnv: "UNSET_VARIABLE" }))).toEqual({
      type: "none",
      off: 'a password is set (auth.passwordEnv of profile "prod"), but no username',
    })
    expect(off({}, profile({ password: "x" }, "p"))).toEqual({
      type: "none",
      off: 'a password is set (auth.password of profile "p"), but no username',
    })
    expect(off({ PW: "x" }, NO_PROFILE)).toEqual({ type: "none" })
    expect(off({}, { name: "p", profile: { auth: {} } })).toEqual({ type: "none" })
  })

  it("selects basic for --auth-password-stdin without a type, so a missing username fails", () => {
    const error = failure(() => resolveAuth({ authPassword: "pw" }, {}, NO_PROFILE))
    expect(error.message).toBe("Basic auth is selected but the username is missing")
    expect(error.details.hint).toMatch(
      /^Basic auth was selected by --auth-password-stdin without an auth type\. Looked up the username in --auth-user, /,
    )
    expect(resolveAuth({ authPassword: "pw" }, { PULSE_CLI_USERNAME: "u" }, NO_PROFILE)).toEqual({
      auth: {
        type: "basic",
        username: "u",
        password: "pw",
        sources: { username: "env", password: "flag" },
      },
      source: "env",
    })
    // an explicit none still wins: credentials are ignored
    expect(
      resolveAuth({ authPassword: "pw" }, { PULSE_CLI_AUTH: "none" }, NO_PROFILE).auth,
    ).toEqual({
      type: "none",
      off: "Basic auth is switched off by PULSE_CLI_AUTH=none",
    })
  })

  it("lets --auth none and PULSE_CLI_AUTH=none switch off Basic auth of the profile", () => {
    const basic = profile({ type: "basic", username: "demo", password: "pw" })
    expect(resolveAuth({ auth: "none" }, {}, basic)).toEqual({
      auth: { type: "none", off: "Basic auth is switched off by --auth none" },
      source: "flag",
    })
    expect(resolveAuth({}, { PULSE_CLI_AUTH: "none" }, basic)).toEqual({
      auth: { type: "none", off: "Basic auth is switched off by PULSE_CLI_AUTH=none" },
      source: "env",
    })
    // a username from the environment does not override an explicit none
    expect(resolveAuth({ auth: "none" }, { PULSE_CLI_USERNAME: "x" }, basic).auth.type).toBe("none")
  })

  it("selects basic for a username without a type, with the source of the username", () => {
    const env = { PULSE_CLI_USERNAME: "demo", PULSE_CLI_PASSWORD: "pw" }
    expect(resolveAuth({}, env, NO_PROFILE)).toEqual({
      auth: {
        type: "basic",
        username: "demo",
        password: "pw",
        sources: { username: "env", password: "env" },
      },
      source: "env",
    })
    expect(resolveAuth({ authUser: "demo", authPassword: "pw" }, {}, NO_PROFILE).source).toBe(
      "flag",
    )
    expect(resolveAuth({}, {}, profile({ username: "demo", password: "pw" })).source).toBe(
      "profile",
    )
  })

  it("ignores credentials when auth is none", () => {
    const resolved = resolveAuth(
      { auth: "none", authPassword: "a\nb" },
      { PULSE_CLI_PASSWORD: "x" },
      profile({ passwordEnv: "UNSET_VARIABLE" }),
    )
    expect(resolved.auth).toEqual({
      type: "none",
      off: "Basic auth is switched off by --auth none",
    })
  })

  it("rejects an unsupported type from any source", () => {
    expect(failure(() => resolveAuth({ auth: "digest" }, {}, NO_PROFILE)).message).toBe(
      'Unsupported auth type "digest"',
    )
    expect(failure(() => resolveAuth({}, { PULSE_CLI_AUTH: "OAuth" }, NO_PROFILE)).message).toBe(
      'Unsupported auth type "OAuth"',
    )
  })
})

describe("resolveAuth password", () => {
  const user = { authUser: "demo", auth: "basic" }

  function password(flags: ConfigFlags, env: Record<string, string>, selected: SelectedProfile) {
    const { auth } = resolveAuth({ ...user, ...flags }, env, selected)
    return auth.type === "basic" ? [auth.password, auth.sources.password] : undefined
  }

  it("prefers stdin, then PULSE_CLI_PASSWORD, then passwordEnv, then the stored password", () => {
    const env = { PULSE_CLI_PASSWORD: "from-env", PW: "from-variable" }
    const stored = profile({ passwordEnv: "PW" })
    expect(password({ authPassword: "from-stdin" }, env, stored)).toEqual(["from-stdin", "flag"])
    expect(password({}, env, stored)).toEqual(["from-env", "env"])
    expect(password({}, { PW: "from-variable" }, stored)).toEqual(["from-variable", "profile"])
    expect(password({}, {}, profile({ password: "literal" }))).toEqual(["literal", "profile"])
  })

  it("keeps passwords exactly, but treats blank values as unset", () => {
    expect(password({ authPassword: " p w " }, {}, NO_PROFILE)).toEqual([" p w ", "flag"])
    expect(password({ authPassword: "  " }, { PULSE_CLI_PASSWORD: " x " }, NO_PROFILE)).toEqual([
      " x ",
      "env",
    ])
    expect(password({}, { PULSE_CLI_PASSWORD: "" }, profile({ password: "p" }))).toEqual([
      "p",
      "profile",
    ])
  })

  it("only reads the passwordEnv variable when no other source has a password", () => {
    expect(
      password({}, { PULSE_CLI_PASSWORD: "env" }, profile({ passwordEnv: "UNSET_VARIABLE" })),
    ).toEqual(["env", "env"])
  })

  it.each([undefined, "", "   "])(
    "fails naming the passwordEnv variable when it is %j, never its value",
    (value) => {
      const env = value === undefined ? {} : { CAMUNDA_PASSWORD: value }
      const error = failure(() =>
        resolveAuth(user, env, profile({ passwordEnv: "CAMUNDA_PASSWORD" })),
      )
      expect(error.code).toBe("CONFIG")
      expect(error.exitCode).toBe(3)
      expect(error.message).toBe(
        'The password variable CAMUNDA_PASSWORD (auth.passwordEnv of profile "prod") is not set or empty',
      )
      expect(error.details.hint).toBe(
        "Export it, e.g. export CAMUNDA_PASSWORD=<password>, or name another variable with `pulse-cli config set prod --auth-password-env <VAR>`.",
      )
    },
  )
})

describe("resolveAuth missing credentials", () => {
  it("names what is missing and where it was looked up", () => {
    const error = failure(() => resolveAuth({ auth: "basic" }, {}, NO_PROFILE))
    expect(error.code).toBe("CONFIG")
    expect(error.exitCode).toBe(3)
    expect(error.message).toBe(
      "Basic auth is selected but the username and the password are missing",
    )
    expect(error.details.hint).toBe(
      "Basic auth was selected by --auth basic. Looked up the username in --auth-user, PULSE_CLI_USERNAME and a profile (none is selected); the password in --auth-password-stdin, PULSE_CLI_PASSWORD and a profile (none is selected). Pipe the password into --auth-password-stdin, set PULSE_CLI_USERNAME and PULSE_CLI_PASSWORD, or store them with `pulse-cli config set <profile> --auth basic --auth-user <name> --auth-password-env <VAR>`; --auth none switches Basic auth off.",
    )
  })

  it("lists only the missing value, with the profile keys", () => {
    const error = failure(() => resolveAuth({}, {}, profile({ username: "demo" })))
    expect(error.message).toBe("Basic auth is selected but the password is missing")
    expect(error.details.hint).toMatch(
      /^Basic auth was selected by a username \(auth\.username of profile "prod"\) without an auth type\. Looked up the password in --auth-password-stdin, PULSE_CLI_PASSWORD and the auth\.passwordEnv or auth\.password of profile "prod"\. /,
    )
    const user = failure(() =>
      resolveAuth({}, { PULSE_CLI_AUTH: "basic", PULSE_CLI_PASSWORD: "pw" }, profile({})),
    )
    expect(user.message).toBe("Basic auth is selected but the username is missing")
    expect(user.details.hint).toMatch(
      /^Basic auth was selected by PULSE_CLI_AUTH=basic\. Looked up the username in --auth-user, PULSE_CLI_USERNAME and the auth\.username of profile "prod"\. /,
    )
    const env = failure(() => resolveAuth({}, { PULSE_CLI_USERNAME: "demo" }, NO_PROFILE))
    expect(env.details.hint).toMatch(
      /^Basic auth was selected by a username \(from PULSE_CLI_USERNAME\) without an auth type\. /,
    )
    const flag = failure(() => resolveAuth({ authUser: "demo" }, {}, NO_PROFILE))
    expect(flag.details.hint).toMatch(
      /^Basic auth was selected by a username \(from --auth-user\) /,
    )
    const stored = failure(() => resolveAuth({}, {}, profile({ type: "basic" })))
    expect(stored.details.hint).toMatch(
      /^Basic auth was selected by the auth\.type of profile "prod"\. /,
    )
  })
})

describe("resolveAuth with a profile without auth settings", () => {
  const plain: SelectedProfile = { name: "plain", profile: { url: "http://x" } }

  it("looks up the credentials of the profile and reports them missing", () => {
    const error = failure(() => resolveAuth({ auth: "basic" }, {}, plain))
    expect(error.message).toBe(
      "Basic auth is selected but the username and the password are missing",
    )
    expect(error.details.hint).toContain(
      'Looked up the username in --auth-user, PULSE_CLI_USERNAME and the auth.username of profile "plain"; the password in --auth-password-stdin, PULSE_CLI_PASSWORD and the auth.passwordEnv or auth.password of profile "plain".',
    )
  })

  it("takes the credentials from flags and environment", () => {
    expect(resolveAuth({ authUser: "demo" }, { PULSE_CLI_PASSWORD: "pw" }, plain).auth).toEqual({
      type: "basic",
      username: "demo",
      password: "pw",
      sources: { username: "flag", password: "env" },
    })
    expect(resolveAuth({}, {}, plain)).toEqual({ auth: { type: "none" }, source: "default" })
  })
})

describe("resolveAuth validation", () => {
  it.each([
    [{ authUser: "a:b", authPassword: "p" }, {}, {}, "from --auth-user"],
    [{ authPassword: "p" }, { PULSE_CLI_USERNAME: "a:b" }, {}, "from PULSE_CLI_USERNAME"],
    [{ authPassword: "p" }, {}, { username: "a:b" }, 'auth.username of profile "prod"'],
  ] as const)('names the source of a username with ":"', (flags, env, auth, label) => {
    const error = failure(() => resolveAuth(flags, env, profile(auth)))
    expect(error.message).toBe(`The username (${label}) must not contain ":"`)
  })

  it.each([
    [{ authPassword: "a\rb" }, {}, {}, "from --auth-password-stdin"],
    [{}, { PULSE_CLI_PASSWORD: "a\0b" }, {}, "from PULSE_CLI_PASSWORD"],
    [{}, { PW: "a\nb" }, { passwordEnv: "PW" }, 'from PW, auth.passwordEnv of profile "prod"'],
    [{}, {}, { password: "a\tb" }, 'auth.password of profile "prod"'],
  ] as const)(
    "names the source of a password with control characters",
    (flags, env, auth, label) => {
      const error = failure(() => resolveAuth({ authUser: "demo", ...flags }, env, profile(auth)))
      expect(error.message).toBe(
        `The password (${label}) must not contain control characters (line breaks, NUL, tab, ...)`,
      )
    },
  )

  it("trims usernames like other values", () => {
    const { auth } = resolveAuth({ authUser: " demo ", authPassword: "p" }, {}, NO_PROFILE)
    expect(auth).toMatchObject({ username: "demo" })
  })
})
