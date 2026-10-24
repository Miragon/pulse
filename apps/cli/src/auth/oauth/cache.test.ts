import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { fakeRuntime } from "../../../test/support/fake-runtime.js"
import {
  cachedLogin,
  cacheText,
  loginFile,
  loginKey,
  oauthConfig,
  oauthDeps,
  TOKEN_DIR,
  TOKEN_FILE,
} from "../../../test/support/oauth.js"
import { OperateError } from "../../errors.js"
import type { FileSystem } from "../../runtime.js"
import {
  cacheFileName,
  cachePath,
  clientAuthOf,
  isLockError,
  loginFileName,
  readCache,
  removeCache,
  serializeCache,
  withCacheLock,
  writeCache,
} from "./cache.js"
import { identityOf, sameIdentity } from "./identity.js"
import type { CachedLogin } from "./types.js"

const NOW = 1_700_000_000_000

async function rejection(promise: Promise<unknown>): Promise<OperateError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(OperateError)
    return error as OperateError
  }
  throw new Error("expected an error")
}

function failingFs(method: keyof FileSystem, code: string): FileSystem {
  const fail = () => Promise.reject(Object.assign(new Error(code), { code }))
  const fs = fakeRuntime({ files: { [TOKEN_FILE]: "{}" } }).fs
  return { ...fs, [method]: fail }
}

const text = fc.string({ maxLength: 20 })
const optionalText = fc.option(text, { nil: null })
const optionalNumber = fc.option(fc.integer({ min: 0, max: 2 ** 45 }), { nil: null })
const logins: fc.Arbitrary<CachedLogin> = fc
  .record({
    version: fc.constant(1 as const),
    identity: fc.record({
      issuer: optionalText,
      tokenEndpoint: optionalText,
      clientId: text,
      audience: optionalText,
      scopes: fc.array(text, { maxLength: 4 }),
    }),
    endpoints: fc.record({
      token: text,
      revocation: optionalText,
      clientAuthMethod: fc.constantFrom("none", "client_secret_basic", "client_secret_post"),
    }),
    tokenType: fc.constant("Bearer"),
    accessToken: fc.string({ minLength: 1, maxLength: 40 }),
    expiresAt: optionalNumber,
    refreshToken: fc.option(fc.string({ minLength: 1, maxLength: 40 }), { nil: null }),
    refreshExpiresAt: optionalNumber,
    scope: optionalText,
    subject: optionalText,
    user: optionalText,
    loggedInAt: fc.integer({ min: 0, max: 2 ** 45 }),
    refreshedAt: optionalNumber,
    refreshRejected: fc.option(
      fc.record({ at: fc.integer({ min: 0, max: 2 ** 45 }), error: text }),
      {
        nil: undefined,
      },
    ),
  })
  .map((login) => {
    // an absent rejection is written without the key
    const { refreshRejected, ...rest } = login
    return refreshRejected === undefined ? rest : login
  })

describe("identityOf", () => {
  it("keys a login on issuer, explicit token endpoint, client, audience and sorted scopes", () => {
    expect(identityOf(oauthConfig({ scopes: ["openid", "offline_access", "openid"] }))).toEqual({
      issuer: "https://login.example.com/realms/camunda",
      tokenEndpoint: null,
      clientId: "operate-cli",
      audience: null,
      scopes: ["offline_access", "openid"],
    })
    const explicit = oauthConfig({
      issuer: undefined,
      authorizationEndpoint: "https://as/authorize",
      tokenEndpoint: "https://as/token",
      audience: "engine-rest",
    })
    expect(identityOf(explicit)).toMatchObject({
      issuer: null,
      tokenEndpoint: "https://as/token",
      audience: "engine-rest",
    })
  })

  it("compares every field", () => {
    const base = identityOf(oauthConfig())
    expect(sameIdentity(base, { ...base, scopes: [...base.scopes] })).toBe(true)
    for (const change of [
      { issuer: "https://other" },
      { tokenEndpoint: "https://as/token" },
      { clientId: "other" },
      { audience: "engine-rest" },
      { scopes: ["openid"] },
      { scopes: ["offline_access", "openid", "profile"] },
    ]) {
      expect(sameIdentity(base, { ...base, ...change }), JSON.stringify(change)).toBe(false)
    }
  })
})

describe("cacheFileName", () => {
  it("names the file after the login key, never after the profile", async () => {
    const name = await cacheFileName(oauthConfig({ profile: "con" }))
    expect(name).toMatch(/^login-[0-9a-f]{32}\.json$/)
    expect(`${TOKEN_DIR}/${name}`).toBe(TOKEN_FILE)
    await expect(cacheFileName(oauthConfig({ profile: "other" }))).resolves.toBe(name)
    // only the key decides: the resolved settings are checked when the file is read
    await expect(cacheFileName(oauthConfig({ clientId: "other" }))).resolves.toBe(name)
  })

  it("gives every origin and every stored setting a file of its own", async () => {
    const changes = [
      { origin: "repository:/work/shop/.git" },
      { origin: "config:/home/tester/other.json" },
      { issuer: "https://login.example.com/realms/other" },
      { tokenEndpoint: "https://login.example.com/token" },
      { clientId: "other" },
      { audience: "engine-rest" },
      { scopes: ["openid"] },
    ]
    const names = await Promise.all(changes.map((change) => loginFileName(loginKey(change))))
    expect(new Set([...names, await loginFileName(loginKey())]).size).toBe(changes.length + 1)
    expect(names.map((name) => `${TOKEN_DIR}/${name}`)).toEqual(
      changes.map((change) => loginFile(loginKey(change))),
    )
  })

  it("names every login file in lower-case hex, whatever the origin and settings", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), fc.string(), async (origin, clientId) => {
        const name = await loginFileName(loginKey({ origin, clientId }))
        expect(name).toMatch(/^login-[0-9a-f]{32}\.json$/)
      }),
    )
  })

  it("hashes the identity without a profile, stable and independent of the scope order", async () => {
    const name = await cacheFileName(oauthConfig({ profile: undefined }))
    expect(name).toMatch(/^env-[0-9a-f]{32}\.json$/)
    await expect(
      cacheFileName(oauthConfig({ profile: undefined, scopes: ["offline_access", "openid"] })),
    ).resolves.toBe(name)
    await expect(
      cacheFileName(oauthConfig({ profile: undefined, clientId: "other" })),
    ).resolves.not.toBe(name)
  })

  it("resolves to a path in the token directory", async () => {
    await expect(cachePath(oauthConfig(), oauthDeps(fakeRuntime()))).resolves.toBe(TOKEN_FILE)
  })
})

describe("readCache and writeCache", () => {
  it("round-trips every valid login", async () => {
    await fc.assert(
      fc.asyncProperty(logins, async (login) => {
        const runtime = fakeRuntime()
        const deps = oauthDeps(runtime)
        await writeCache(TOKEN_FILE, login, deps)
        await expect(readCache(TOKEN_FILE, deps, { profile: "p" })).resolves.toEqual(login)
      }),
      { numRuns: 50 },
    )
  })

  it("writes the schema of design §16.5 with mode 0600 and a final newline", async () => {
    const runtime = fakeRuntime()
    const login = cachedLogin(NOW, {
      endpoints: { token: "t", revocation: null, clientAuthMethod: "client_secret_post" },
    })
    await writeCache(TOKEN_FILE, login, oauthDeps(runtime))
    const stored = runtime.files.get(TOKEN_FILE)
    expect(stored?.mode).toBe(0o600)
    expect(new TextDecoder().decode(stored?.data)).toBe(cacheText(login))
    expect(serializeCache(login).endsWith("}\n")).toBe(true)
    expect(Object.keys(JSON.parse(serializeCache(login)) as object)).toEqual([
      "version",
      "identity",
      "endpoints",
      "tokenType",
      "accessToken",
      "expiresAt",
      "refreshToken",
      "refreshExpiresAt",
      "scope",
      "subject",
      "user",
      "loggedInAt",
      "refreshedAt",
    ])
  })

  it("always writes the client authentication method; a refusal only after one", () => {
    for (const clientAuthMethod of ["none", "client_secret_basic", "client_secret_post"] as const) {
      const login = cachedLogin(NOW, {
        endpoints: { token: "t", revocation: null, clientAuthMethod },
      })
      expect(JSON.parse(serializeCache(login))).toMatchObject({
        endpoints: { token: "t", revocation: null, clientAuthMethod },
      })
    }
    expect(serializeCache(cachedLogin(NOW))).not.toContain("refreshRejected")
    const rejected = cachedLogin(NOW, { refreshRejected: { at: NOW, error: "invalid_grant: x" } })
    expect(Object.keys(JSON.parse(serializeCache(rejected)) as object).at(-1)).toBe(
      "refreshRejected",
    )
  })

  it("refreshes and revokes with the method of the login", () => {
    const withMethod = (clientAuthMethod: "none" | "client_secret_basic" | "client_secret_post") =>
      clientAuthOf(
        cachedLogin(NOW, { endpoints: { token: "t", revocation: null, clientAuthMethod } }),
      )
    expect(withMethod("client_secret_post")).toBe("client_secret_post")
    expect(withMethod("client_secret_basic")).toBe("client_secret_basic")
    expect(withMethod("none")).toBe("client_secret_basic")
  })

  it("reads a missing file as no login", async () => {
    await expect(
      readCache(TOKEN_FILE, oauthDeps(fakeRuntime()), { profile: "p" }),
    ).resolves.toBeUndefined()
  })

  it.each([
    ["not JSON", "not json {access-token-123"],
    ["an array", "[]"],
    ["version 2", cacheText({ ...cachedLogin(NOW), version: 2 as 1 })],
    ["a missing field", cacheText(cachedLogin(NOW)).replace('"user": "alice",', "")],
    ["a number access token", cacheText(cachedLogin(NOW)).replace('"cached-access"', "42")],
    ["an empty access token", cacheText(cachedLogin(NOW, { accessToken: "" }))],
    ["an empty refresh token", cacheText(cachedLogin(NOW, { refreshToken: "" }))],
    [
      "a string expiry",
      cacheText(cachedLogin(NOW)).replace(/"expiresAt": \d+/, '"expiresAt": "soon"'),
    ],
    ["scopes that are not strings", cacheText(cachedLogin(NOW)).replace('"offline_access",', "7,")],
    [
      "an unknown auth method",
      cacheText(
        cachedLogin(NOW, {
          endpoints: {
            token: "t",
            revocation: null,
            clientAuthMethod: "x" as "client_secret_post",
          },
        }),
      ),
    ],
    ["no identity", cacheText({ ...cachedLogin(NOW), identity: null as never })],
    [
      "no client authentication method",
      cacheText(cachedLogin(NOW)).replace(',\n    "clientAuthMethod": "none"', ""),
    ],
    [
      "a refusal without its error",
      cacheText(cachedLogin(NOW, { refreshRejected: { at: NOW } as never })),
    ],
  ])("reports %s as an unknown format, without quoting the content", async (_, content) => {
    const runtime = fakeRuntime({ files: { [TOKEN_FILE]: content } })
    const error = await rejection(readCache(TOKEN_FILE, oauthDeps(runtime), { profile: "p" }))
    expect(error.code).toBe("LOGIN_REQUIRED")
    expect(error.exitCode).toBe(4)
    expect(error.message).toBe(`The token cache ${TOKEN_FILE} has an unknown format`)
    expect(error.details.hint).toContain("operate auth login --profile p")
    expect(JSON.stringify(error.details)).not.toContain("access")
  })

  it("reports I/O errors as CONFIG naming the path and the code", async () => {
    const runtime = fakeRuntime({ files: { [TOKEN_FILE]: "{}" } })
    const readFails: FileSystem = {
      ...runtime.fs,
      readFile: () => Promise.reject(Object.assign(new Error("EACCES"), { code: "EACCES" })),
    }
    const error = await rejection(readCache(TOKEN_FILE, { fs: readFails }, { profile: "p" }))
    expect(error.code).toBe("CONFIG")
    expect(error.message).toBe(`Cannot read token cache ${TOKEN_FILE} (EACCES)`)
    const write = await rejection(
      writeCache(TOKEN_FILE, cachedLogin(NOW), { fs: failingFs("writeFile", "EROFS") }),
    )
    expect(write.message).toBe(`Cannot write token cache ${TOKEN_FILE} (EROFS)`)
    const remove = await rejection(removeCache(TOKEN_FILE, { fs: failingFs("remove", "EPERM") }))
    expect(remove.message).toBe(`Cannot write token cache ${TOKEN_FILE} (EPERM)`)
  })

  it("removes the file and tells whether there was one", async () => {
    const runtime = fakeRuntime({ files: { [TOKEN_FILE]: "{}" } })
    const deps = oauthDeps(runtime)
    await expect(removeCache(TOKEN_FILE, deps)).resolves.toBe(true)
    await expect(removeCache(TOKEN_FILE, deps)).resolves.toBe(false)
  })
})

describe("withCacheLock", () => {
  it("creates the token directory with mode 0700, then holds <file>.lock for timeout + 10 s", async () => {
    const runtime = fakeRuntime()
    const deps = oauthDeps(runtime, { timeoutMs: 5_000 })
    await expect(withCacheLock(TOKEN_FILE, deps, () => Promise.resolve("done"))).resolves.toBe(
      "done",
    )
    expect(runtime.dirModes.get(TOKEN_DIR)).toBe(0o700)
    expect(runtime.locks).toEqual([{ path: `${TOKEN_FILE}.lock`, holdMs: 15_000 }])
  })

  it("passes errors of the action through unchanged", async () => {
    const failure = new Error("action failed")
    const deps = oauthDeps(fakeRuntime())
    await expect(withCacheLock(TOKEN_FILE, deps, () => Promise.reject(failure))).rejects.toBe(
      failure,
    )
    expect(isLockError(failure)).toBe(false)
  })

  it("turns a lock that cannot be taken into a recognizable CONFIG error", async () => {
    const runtime = fakeRuntime({ lockTimeout: true })
    let ran = false
    const error = await rejection(
      withCacheLock(TOKEN_FILE, oauthDeps(runtime), () => {
        ran = true
        return Promise.resolve()
      }),
    )
    expect(ran).toBe(false)
    expect(error.code).toBe("CONFIG")
    expect(error.message).toBe(`Cannot lock the token cache ${TOKEN_FILE}`)
    expect(error.details.hint).toBe(
      `Another operate process holds ${TOKEN_FILE}.lock. If no operate process is running, remove ${TOKEN_FILE}.lock; nothing was sent.`,
    )
    expect(isLockError(error)).toBe(true)
    expect(isLockError(new OperateError("CONFIG", "other"))).toBe(false)
  })

  it("counts a lock that never ran the action as not taken", async () => {
    const deps = {
      ...oauthDeps(fakeRuntime()),
      withLock: <T>() => Promise.resolve(undefined as T),
    }
    expect(
      isLockError(await rejection(withCacheLock(TOKEN_FILE, deps, () => Promise.resolve(1)))),
    ).toBe(true)
  })

  it("reports a directory it cannot create as CONFIG", async () => {
    const deps = { ...oauthDeps(fakeRuntime()), fs: failingFs("mkdir", "EACCES") }
    const error = await rejection(withCacheLock(TOKEN_FILE, deps, () => Promise.resolve()))
    expect(error.message).toBe(`Cannot write token cache ${TOKEN_FILE} (EACCES)`)
  })
})
