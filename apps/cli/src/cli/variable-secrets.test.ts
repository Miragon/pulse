/**
 * Property (design §15, §16.2, §18, extends auth-secrets, oauth-secrets and bearer-secrets): a
 * secret typed in place of the name of its variable (`--auth-password-env`,
 * `--oauth-client-secret-env`, `--auth-token-env`, or a hand-edited auth.passwordEnv,
 * auth.clientSecretEnv or auth.tokenEnv) is never stored by `config set` and never appears in
 * any output: not in the profile `config set|unset|use` print, not in `config show`, dry-runs,
 * the verbose trace, `auth status|login|logout` or any error.
 */

import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { opaqueTokens } from "../../test/support/bearer.js"
import { fakeServer, json } from "../../test/support/fake-fetch.js"
import { ISSUER } from "../../test/support/fake-idp.js"
import { CONFIG_PATH, execute, fakeRuntime, fileText } from "../../test/support/fake-runtime.js"
import { cachedLogin, cacheText, TOKEN_FILE } from "../../test/support/oauth.js"
import { isConventionalVariable } from "../config/variable.js"
import { run } from "./run.js"

const T0 = 1_700_000_000_000

interface Family {
  /** The options of `config set` before the variable option. */
  readonly set: readonly string[]
  readonly flag: string
  /** The auth object of a hand-edited profile whose variable key holds `secret`. */
  readonly auth: (secret: string) => Readonly<Record<string, unknown>>
}

const FAMILIES: readonly Family[] = [
  {
    set: ["--auth", "basic", "--auth-user", "demo"],
    flag: "--auth-password-env",
    auth: (secret) => ({ type: "basic", username: "demo", passwordEnv: secret }),
  },
  {
    set: ["--oauth-issuer", ISSUER, "--oauth-client-id", "operate-cli"],
    flag: "--oauth-client-secret-env",
    auth: (secret) => ({
      type: "oauth",
      issuer: ISSUER,
      clientId: "operate-cli",
      clientSecretEnv: secret,
    }),
  },
  {
    set: ["--auth", "bearer"],
    flag: "--auth-token-env",
    auth: (secret) => ({ type: "bearer", tokenEnv: secret }),
  },
]

interface Scenario {
  readonly args: readonly string[]
  readonly files?: Readonly<Record<string, string>>
}

function scenarios(family: Family, secret: string): Scenario[] {
  const files = {
    [CONFIG_PATH]: JSON.stringify({
      defaultProfile: "p",
      profiles: { p: { auth: family.auth(secret) } },
    }),
    // the cached login of the OAuth profile (logout revokes it without the unknown secret)
    [TOKEN_FILE]: cacheText(cachedLogin(T0)),
  }
  return [
    { args: ["config", "set", "p", ...family.set, family.flag, secret] },
    { args: ["config", "set", "p", ...family.set, family.flag, secret, "-o", "table"] },
    { args: ["config", "set", "p", "--url", "http://localhost:8080/engine-rest"], files },
    { args: ["config", "unset", "p", "engine"], files },
    { args: ["config", "use", "p", "-o", "table"], files },
    { args: ["config", "show"], files },
    { args: ["config", "show", "-o", "table"], files },
    { args: ["config", "list"], files },
    { args: ["task", "list"], files },
    { args: ["task", "list", "--verbose"], files },
    { args: ["ping", "--dry-run"], files },
    { args: ["api", "GET", "/task", "--dry-run", "-o", "table"], files },
    { args: ["auth", "status"], files },
    { args: ["auth", "login"], files },
    { args: ["auth", "logout"], files },
  ]
}

async function outcome(scenario: Scenario) {
  const engine = fakeServer()
    .on("GET", "/version", json({ version: "7.24.0" }))
    .on("GET", "/engine", json([{ name: "default" }]))
    .on("GET", "/task", json([]))
  const runtime = fakeRuntime({
    fetch: engine.fetch,
    now: () => T0,
    files: scenario.files ?? {},
  })
  const result = await execute(run, scenario.args, runtime)
  return { ...result, file: fileText(runtime, CONFIG_PATH) }
}

/** Secrets that are valid variable names, but not in the usual upper-case form. */
const secrets = fc
  .oneof(
    fc.stringMatching(/^[A-Za-z0-9_]{6,30}$/).map((value) => `sQ${value}`),
    fc.stringMatching(/^[A-Za-z0-9]{20,36}$/).map((value) => `ghp_${value}`),
    fc.stringMatching(/^[A-Z][A-Z0-9]{24,40}$/),
    opaqueTokens.filter((token) => /^[A-Za-z0-9_]+$/.test(token)),
  )
  .filter((secret) => !isConventionalVariable(secret))

describe("secrets typed in place of the name of their variable", () => {
  it("scenarios reach the outputs they are meant for", async () => {
    const codes = []
    for (const family of FAMILIES) {
      for (const scenario of scenarios(family, "sQhunter2_value")) {
        codes.push((await outcome(scenario)).code)
      }
    }
    // config set x2 refused; config set/unset/use print the profile; config list; every
    // command that resolves the auth fails (auth login of a bearer profile: USAGE); auth logout
    // removes the cached OAuth login, revoked without the secret (a bearer profile has none:
    // USAGE)
    expect(codes).toEqual([
      // Basic auth
      3, 3, 0, 0, 0, 3, 3, 0, 3, 3, 3, 3, 3, 3, 0,
      // OAuth
      3, 3, 0, 0, 0, 3, 3, 0, 3, 3, 3, 3, 3, 3, 0,
      // bearer token
      3, 3, 0, 0, 0, 3, 3, 0, 3, 3, 3, 3, 3, 2, 2,
    ])
  })

  it("are never stored and never appear in any output", async () => {
    await fc.assert(
      fc.asyncProperty(secrets, fc.constantFrom(...FAMILIES), async (secret, family) => {
        for (const scenario of scenarios(family, secret)) {
          const result = await outcome(scenario)
          const args = scenario.args.join(" ")
          expect(`${result.stdout}\n${result.stderr}`, args).not.toContain(secret)
          if (scenario.files === undefined) expect(result.file, args).toBeUndefined()
        }
      }),
      { numRuns: 20 },
    )
  })
})
