import { describe, expect, it } from "vitest"
import {
  clearedLogin,
  clearedSession,
  ENDED_COOKIE,
  endedCookie,
  endedId,
  LOGIN_COOKIE,
  LOGIN_SECONDS,
  loginCookie,
  openLogin,
  parseCookies,
  SESSION_CHUNK_BYTES,
  SESSION_COOKIE,
  sessionCookies,
  sessionValue,
} from "./cookies.js"
import { createSealer } from "./seal.js"

const NOW = 1_800_000_000_000
const HOUR = 3_600_000
const FLAGS = "Path=/; HttpOnly; Secure; SameSite=Lax"
const sealer = createSealer([new Uint8Array(32).fill(5)])
const LOGIN = { state: "state-1", verifier: "verifier-1", returnTo: "/app/boards/ops?x=1" }

/** A sealed-looking value of `length` characters. */
const sealedOf = (length: number) => "abc.DEF-_".repeat(Math.ceil(length / 9)).slice(0, length)

/** The name and value of a `Set-Cookie` value. */
const pairOf = (setCookie: string): [string, string] => {
  const [pair] = setCookie.split(";")
  const at = pair.indexOf("=")
  return [pair.slice(0, at), pair.slice(at + 1)]
}

/** The `Cookie` header a browser sends back for `Set-Cookie` values that set something. */
const cookieHeader = (setCookies: readonly string[]) =>
  setCookies
    .map(pairOf)
    .filter(([, value]) => value !== "")
    .map(([name, value]) => `${name}=${value}`)
    .join("; ")

describe("the cookie names", () => {
  it("carry the __Host- prefix, so no other host can set them", () => {
    expect(SESSION_COOKIE).toBe("__Host-pulse-session")
    expect(LOGIN_COOKIE).toBe("__Host-pulse-login")
    expect(ENDED_COOKIE).toBe("__Host-pulse-ended")
  })
})

describe("parseCookies", () => {
  it("reads every cookie by name, values as sent, quotes taken off", () => {
    const jar = parseCookies(' a=1;b = two ; c="quoted";flag; d=x=y; =empty')
    expect([...jar.entries()]).toEqual([
      ["a", ["1"]],
      ["b", ["two"]],
      ["c", ["quoted"]],
      ["d", ["x=y"]],
      ["", ["empty"]],
    ])
  })

  it("takes off only a pair of quotes around the whole value, and keeps a cookie without a name", () => {
    const jar = parseCookies('=nameless; e=x"y"; f="a"b; g=""')
    expect([...jar.entries()]).toEqual([
      ["", ["nameless"]],
      ["e", ['x"y"']],
      ["f", ['"a"b']],
      ["g", [""]],
    ])
  })

  it("keeps both values of a name sent twice, and reads nothing from no header", () => {
    expect(parseCookies("a=1; a=2").get("a")).toEqual(["1", "2"])
    expect(parseCookies(undefined).size).toBe(0)
    expect(parseCookies(null).size).toBe(0)
    expect(parseCookies("").size).toBe(0)
  })
})

describe("sessionCookies", () => {
  it("writes a short session as one HttpOnly, Secure, SameSite=Lax cookie on / until it expires", () => {
    const sealed = sealedOf(100)
    expect(sessionCookies(sealed, NOW + 8 * HOUR, new Map(), NOW)).toEqual({
      fits: true,
      setCookies: [`__Host-pulse-session=${sealed}; Max-Age=28800; ${FLAGS}`],
    })
  })

  it("rounds the lifetime up to whole seconds and never below 0", () => {
    expect(sessionCookies("a.b", NOW + 1500, new Map(), NOW)).toMatchObject({
      setCookies: [expect.stringContaining("; Max-Age=2;")],
    })
    expect(sessionCookies("a.b", NOW - 1000, new Map(), NOW)).toMatchObject({
      setCookies: [expect.stringContaining("; Max-Age=0;")],
    })
  })

  it("splits a session into chunks of 3,800 bytes, at most three", () => {
    expect(SESSION_CHUNK_BYTES).toBe(3800)
    const one = sessionCookies(sealedOf(3800), NOW + HOUR, new Map(), NOW)
    expect(one.fits && one.setCookies.map(pairOf).map(([name]) => name)).toEqual([
      "__Host-pulse-session",
    ])
    const sealed = sealedOf(3 * 3800)
    const three = sessionCookies(sealed, NOW + HOUR, new Map(), NOW)
    if (!three.fits) throw new Error("expected three chunks")
    const pairs = three.setCookies.map(pairOf)
    expect(pairs.map(([name]) => name)).toEqual([
      "__Host-pulse-session",
      "__Host-pulse-session.1",
      "__Host-pulse-session.2",
    ])
    expect(pairs.map(([, value]) => value.length)).toEqual([3800, 3800, 3800])
    expect(pairs.map(([, value]) => value).join("")).toBe(sealed)
    expect(sessionCookies(sealedOf(3801), NOW + HOUR, new Map(), NOW)).toMatchObject({
      fits: true,
      setCookies: [expect.stringContaining("session="), expect.stringContaining("session.1=")],
    })
  })

  it("fails on its own a session that needs a fourth chunk", () => {
    expect(sessionCookies(sealedOf(3 * 3800 + 1), NOW + HOUR, new Map(), NOW)).toEqual({
      fits: false,
      bytes: 11_401,
    })
  })

  it("clears the chunks a request carried when the session falls from three chunks to one", () => {
    const carried = parseCookies(
      "__Host-pulse-session=a; __Host-pulse-session.1=b; __Host-pulse-session.2=c; other=1",
    )
    const written = sessionCookies("short.value", NOW + HOUR, carried, NOW)
    expect(written).toEqual({
      fits: true,
      setCookies: [
        `__Host-pulse-session=short.value; Max-Age=3600; ${FLAGS}`,
        `__Host-pulse-session.1=; Max-Age=0; ${FLAGS}`,
        `__Host-pulse-session.2=; Max-Age=0; ${FLAGS}`,
      ],
    })
    const two = sessionCookies(sealedOf(3801), NOW + HOUR, carried, NOW)
    expect(
      two.fits && two.setCookies.map(pairOf).map(([name, value]) => `${name}=${value.length}`),
    ).toEqual(["__Host-pulse-session=3800", "__Host-pulse-session.1=1", "__Host-pulse-session.2=0"])
  })

  it("clears no chunk the request did not carry", () => {
    const carried = parseCookies("__Host-pulse-session=a")
    expect(sessionCookies("x.y", NOW + HOUR, carried, NOW)).toMatchObject({
      setCookies: [expect.stringMatching(/^__Host-pulse-session=x\.y;/)],
    })
  })

  it("holds a sealed value only, so no value breaks out of its cookie", () => {
    for (const value of ["", "a;b", "a b", 'a"b', "a,b", "a\nb"]) {
      expect(() => sessionCookies(value, NOW + HOUR, new Map(), NOW), value).toThrow(
        "A session cookie holds a sealed value only",
      )
    }
  })
})

describe("sessionValue", () => {
  it("joins the chunks a browser sends back, in order", async () => {
    const sealed = await sealer.seal(SESSION_COOKIE, { big: "x".repeat(6000) }, NOW + HOUR)
    const written = sessionCookies(sealed, NOW + HOUR, new Map(), NOW)
    if (!written.fits) throw new Error("expected the session to fit")
    expect(written.setCookies).toHaveLength(3)
    const reversed = [...written.setCookies].reverse()
    const jar = parseCookies(cookieHeader(reversed))
    expect(sessionValue(jar)).toBe(sealed)
    expect(await sealer.open(SESSION_COOKIE, String(sessionValue(jar)), NOW)).toMatchObject({
      ok: true,
      value: { big: "x".repeat(6000) },
    })
  })

  it("reads no session without its first chunk, or with a chunk sent twice", () => {
    expect(sessionValue(parseCookies("other=1"))).toBeUndefined()
    expect(sessionValue(parseCookies("__Host-pulse-session.1=b"))).toBeUndefined()
    expect(sessionValue(parseCookies("__Host-pulse-session="))).toBeUndefined()
    expect(
      sessionValue(parseCookies("__Host-pulse-session=a; __Host-pulse-session=b")),
    ).toBeUndefined()
    expect(
      sessionValue(
        parseCookies("__Host-pulse-session=a; __Host-pulse-session.1=b; __Host-pulse-session.1=c"),
      ),
    ).toBeUndefined()
  })

  it("stops at the first missing chunk, so a stray later one joins nothing", () => {
    expect(sessionValue(parseCookies("__Host-pulse-session=a; __Host-pulse-session.2=c"))).toBe("a")
    expect(sessionValue(parseCookies("__Host-pulse-session=a; __Host-pulse-session.1=b"))).toBe(
      "ab",
    )
  })
})

describe("clearedSession", () => {
  it("clears all three chunks with the cookie's own attributes", () => {
    expect(clearedSession()).toEqual([
      `__Host-pulse-session=; Max-Age=0; ${FLAGS}`,
      `__Host-pulse-session.1=; Max-Age=0; ${FLAGS}`,
      `__Host-pulse-session.2=; Max-Age=0; ${FLAGS}`,
    ])
  })
})

describe("the login cookie", () => {
  it("holds the sign-in under way, sealed for ten minutes", async () => {
    expect(LOGIN_SECONDS).toBe(600)
    const cookie = await loginCookie(sealer, LOGIN, NOW)
    expect(cookie).toMatch(
      /^__Host-pulse-login=[A-Za-z0-9._-]+; Max-Age=600; Path=\/; HttpOnly; Secure; SameSite=Lax$/,
    )
    const [, sealed] = pairOf(cookie)
    expect(sealed).not.toContain("verifier-1")
    const jar = parseCookies(`other=1; ${cookie.split(";")[0]}`)
    expect(await openLogin(sealer, jar, NOW + 599_999)).toEqual({ ok: true, login: LOGIN })
    expect(await openLogin(sealer, jar, NOW + 600_000)).toEqual({ ok: false, reason: "expired" })
  })

  it("keeps only the sign-in's state, verifier and target", async () => {
    const cookie = await loginCookie(sealer, { ...LOGIN, extra: "dropped" } as typeof LOGIN, NOW)
    const opened = await openLogin(sealer, parseCookies(cookie.split(";")[0]), NOW)
    expect(opened).toEqual({ ok: true, login: LOGIN })
  })

  it("reads the clock when no time is given", async () => {
    const cookie = await loginCookie(sealer, LOGIN)
    expect(await openLogin(sealer, parseCookies(cookie.split(";")[0]))).toEqual({
      ok: true,
      login: LOGIN,
    })
  })

  it("is refused under the session's name, and a session under the login's", async () => {
    const [, login] = pairOf(await loginCookie(sealer, LOGIN, NOW))
    const asSession = parseCookies(`__Host-pulse-session=${login}`)
    expect(await sealer.open(SESSION_COOKIE, String(sessionValue(asSession)), NOW)).toEqual({
      ok: false,
      reason: "invalid",
    })
    const session = await sealer.seal(SESSION_COOKIE, LOGIN, NOW + HOUR)
    expect(await openLogin(sealer, parseCookies(`__Host-pulse-login=${session}`), NOW)).toEqual({
      ok: false,
      reason: "invalid",
    })
  })

  it("opens nothing when the request sends no login cookie, or two", async () => {
    const [, login] = pairOf(await loginCookie(sealer, LOGIN, NOW))
    expect(await openLogin(sealer, parseCookies("other=1"), NOW)).toBeUndefined()
    expect(
      await openLogin(
        sealer,
        parseCookies(`__Host-pulse-login=${login}; __Host-pulse-login=${login}`),
        NOW,
      ),
    ).toBeUndefined()
  })

  it("is cleared with the cookie's own attributes", () => {
    expect(clearedLogin()).toBe(`__Host-pulse-login=; Max-Age=0; ${FLAGS}`)
  })
})

describe("the ended cookie", () => {
  const jarOf = (cookie: string) => parseCookies(`other=1; ${cookie.split(";")[0]}`)

  it("names the signed-out session, sealed until that session would have ended", async () => {
    const cookie = await endedCookie(sealer, "session-1", NOW + 8 * HOUR, NOW)
    expect(cookie).toMatch(
      new RegExp(`^__Host-pulse-ended=[A-Za-z0-9._-]+; Max-Age=28800; ${FLAGS}$`),
    )
    expect(pairOf(cookie)[1]).not.toContain("session-1")
    expect(await endedId(sealer, jarOf(cookie), NOW + 8 * HOUR - 1)).toBe("session-1")
    expect(await endedId(sealer, jarOf(cookie), NOW + 8 * HOUR)).toBeUndefined()
  })

  it("lasts the session's seconds left, rounded up, and none once it passed", async () => {
    expect(await endedCookie(sealer, "s", NOW + 1500, NOW)).toContain("; Max-Age=2; ")
    expect(await endedCookie(sealer, "s", NOW - 1500, NOW)).toContain("; Max-Age=0; ")
  })

  it("reads the clock when no time is given", async () => {
    const cookie = await endedCookie(sealer, "session-1", Date.now() + HOUR)
    expect(cookie).toMatch(/; Max-Age=3600; /)
    expect(await endedId(sealer, jarOf(cookie))).toBe("session-1")
  })

  it("names nothing without one, with two, or with a value sealed for another cookie", async () => {
    const [, ended] = pairOf(await endedCookie(sealer, "session-1", NOW + HOUR, NOW))
    expect(await endedId(sealer, parseCookies("other=1"), NOW)).toBeUndefined()
    const twice = parseCookies(`__Host-pulse-ended=${ended}; __Host-pulse-ended=${ended}`)
    expect(await endedId(sealer, twice, NOW)).toBeUndefined()
    const session = await sealer.seal(SESSION_COOKIE, { id: "session-1" }, NOW + HOUR)
    expect(
      await endedId(sealer, parseCookies(`__Host-pulse-ended=${session}`), NOW),
    ).toBeUndefined()
  })
})
