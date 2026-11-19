import { CompactEncrypt, decodeProtectedHeader } from "jose"
import { describe, expect, it } from "vitest"
import { createSealer, sealKeyOf } from "./seal.js"

const key = (fill: number, bytes = 32) => new Uint8Array(bytes).fill(fill)
const NEW = key(1)
const OLD = key(2)
const OTHER = key(3)
const NOW = 1_800_000_000_000
const HOUR = 3_600_000
const SESSION = "__Host-pulse-session"
const VALUE = { accessToken: "token-value", name: "Alice" }

/** Flips one character in the middle of a part of a compact JWE. */
function tampered(sealed: string, part: number): string {
  const parts = sealed.split(".")
  const text = parts[part]
  const at = Math.floor(text.length / 2)
  parts[part] = `${text.slice(0, at)}${text[at] === "A" ? "B" : "A"}${text.slice(at + 1)}`
  return parts.join(".")
}

describe("sealKeyOf", () => {
  it("derives a 256-bit content key and a key id from a configured key, the same on every replica", () => {
    const derived = sealKeyOf(key(0))
    expect(derived.kid).toBe("eYNiomIW-fBg")
    expect(Buffer.from(derived.key).toString("base64url")).toBe(
      "BNRtZzuqBEzhh5vTUGpMWpBo20tUkfaHUM30SX2goyA",
    )
    expect(sealKeyOf(key(0))).toEqual(derived)
  })

  it("gives each configured key its own content key and id, neither the key itself", () => {
    const one = sealKeyOf(NEW)
    const two = sealKeyOf(OLD)
    expect(one.kid).not.toBe(two.kid)
    expect(one.key).not.toEqual(two.key)
    expect(one.key).not.toEqual(NEW)
    expect(one.kid).toMatch(/^[A-Za-z0-9_-]{12}$/)
  })
})

describe("createSealer", () => {
  it("needs a key", () => {
    expect(() => createSealer([])).toThrow("The seal needs at least one key")
  })

  it("opens what it sealed, with the value and the expiry it was sealed with", async () => {
    const sealer = createSealer([NEW])
    const sealed = await sealer.seal(SESSION, VALUE, NOW + HOUR)
    expect(await sealer.open(SESSION, sealed, NOW)).toEqual({
      ok: true,
      value: VALUE,
      expiresAt: NOW + HOUR,
    })
  })

  it("seals a compact JWE, dir and A256GCM under the first key's id, the cookie in its protected header", async () => {
    const sealed = await createSealer([NEW, OLD]).seal(SESSION, VALUE, NOW + HOUR)
    const parts = sealed.split(".")
    expect(parts).toHaveLength(5)
    expect(parts[1]).toBe("")
    expect(sealed).toMatch(/^[A-Za-z0-9._-]+$/)
    expect(decodeProtectedHeader(sealed)).toEqual({
      alg: "dir",
      enc: "A256GCM",
      kid: sealKeyOf(NEW).kid,
      cookie: SESSION,
    })
    expect(sealed).not.toContain(Buffer.from("token-value").toString("base64url"))
  })

  it("refuses a value altered in any part", async () => {
    const sealer = createSealer([NEW])
    const sealed = await sealer.seal(SESSION, VALUE, NOW + HOUR)
    for (const part of [0, 2, 3, 4]) {
      expect(await sealer.open(SESSION, tampered(sealed, part), NOW), `part ${part}`).toEqual({
        ok: false,
        reason: "invalid",
      })
    }
    for (const garbage of ["", "a.b.c.d.e", "not sealed", `${sealed}.x`]) {
      expect((await sealer.open(SESSION, garbage, NOW)).ok, garbage).toBe(false)
    }
  })

  it("refuses a value sealed with another key, or with a key it no longer holds", async () => {
    const sealed = await createSealer([OLD]).seal(SESSION, VALUE, NOW + HOUR)
    expect(await createSealer([OTHER]).open(SESSION, sealed, NOW)).toEqual({
      ok: false,
      reason: "invalid",
    })
    expect(await createSealer([NEW]).open(SESSION, sealed, NOW)).toEqual({
      ok: false,
      reason: "invalid",
    })
  })

  it("rotates: a new key first seals, while the old one still opens what it sealed", async () => {
    const before = await createSealer([OLD]).seal(SESSION, VALUE, NOW + HOUR)
    const rotated = createSealer([NEW, OLD])
    expect(await rotated.open(SESSION, before, NOW)).toMatchObject({ ok: true, value: VALUE })
    const after = await rotated.seal(SESSION, VALUE, NOW + HOUR)
    expect(decodeProtectedHeader(after).kid).toBe(sealKeyOf(NEW).kid)
    expect(await createSealer([NEW]).open(SESSION, after, NOW)).toMatchObject({ ok: true })
    expect(await createSealer([OLD]).open(SESSION, after, NOW)).toMatchObject({ ok: false })
  })

  // Replicas roll out a new MCP_WEB_SESSION_KEYS one by one, so two settings serve side by side.
  it("rotates across replicas in two steps, the new key last first, each step's pair opening the other's seals", async () => {
    const opensEachOther = async (one: Uint8Array[], other: Uint8Array[]) => {
      const [a, b] = [createSealer(one), createSealer(other)]
      const fromA = await a.seal(SESSION, VALUE, NOW + HOUR)
      const fromB = await b.seal(SESSION, VALUE, NOW + HOUR)
      return (await b.open(SESSION, fromA, NOW)).ok && (await a.open(SESSION, fromB, NOW)).ok
    }
    expect(await opensEachOther([OLD], [OLD, NEW])).toBe(true)
    expect(await opensEachOther([OLD, NEW], [NEW, OLD])).toBe(true)
    // In one step a replica still on the old key opens nothing the new key sealed: signed out.
    expect(await opensEachOther([OLD], [NEW, OLD])).toBe(false)
  })

  it("opens a value sealed for its cookie only: the cookie's name is authenticated with it", async () => {
    const sealer = createSealer([NEW])
    const login = await sealer.seal("__Host-pulse-login", VALUE, NOW + HOUR)
    expect(await sealer.open(SESSION, login, NOW)).toEqual({ ok: false, reason: "invalid" })
    expect(await sealer.open("__Host-pulse-login", login, NOW)).toMatchObject({ ok: true })
  })

  it("refuses a value once its expiry is not after now", async () => {
    const sealer = createSealer([NEW])
    const sealed = await sealer.seal(SESSION, VALUE, NOW + HOUR)
    expect(await sealer.open(SESSION, sealed, NOW + HOUR - 1)).toMatchObject({ ok: true })
    expect(await sealer.open(SESSION, sealed, NOW + HOUR)).toEqual({ ok: false, reason: "expired" })
    expect(await sealer.open(SESSION, sealed, NOW + 2 * HOUR)).toEqual({
      ok: false,
      reason: "expired",
    })
  })

  it("reads the clock when no time is given", async () => {
    const sealer = createSealer([NEW])
    const live = await sealer.seal(SESSION, VALUE, Date.now() + HOUR)
    const gone = await sealer.seal(SESSION, VALUE, Date.now() - 1)
    expect(await sealer.open(SESSION, live)).toMatchObject({ ok: true })
    expect(await sealer.open(SESSION, gone)).toEqual({ ok: false, reason: "expired" })
  })

  it("keeps the expiry a value was opened with across every re-seal", async () => {
    const sealer = createSealer([NEW])
    const first = await sealer.open(SESSION, await sealer.seal(SESSION, VALUE, NOW + HOUR), NOW)
    if (!first.ok) throw new Error("expected the value to open")
    const resealed = await sealer.reseal(SESSION, first, { ...VALUE, accessToken: "renewed" })
    const second = await sealer.open(SESSION, resealed, NOW + HOUR / 2)
    expect(second).toEqual({
      ok: true,
      value: { ...VALUE, accessToken: "renewed" },
      expiresAt: NOW + HOUR,
    })
    if (!second.ok) throw new Error("expected the value to open")
    const again = await sealer.reseal(SESSION, second, VALUE)
    expect(await sealer.open(SESSION, again, NOW + HOUR)).toEqual({ ok: false, reason: "expired" })
  })

  it("seals nothing without a finite expiry", async () => {
    const sealer = createSealer([NEW])
    for (const expiry of [Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(sealer.seal(SESSION, VALUE, expiry)).rejects.toThrow(
        "A sealed value needs a finite expiry",
      )
    }
  })

  it("opens a value an earlier run sealed with the same key, so a restart keeps every session", async () => {
    const pinned =
      "eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIiwia2lkIjoiQjlYRVNTaGFfVmJNIiwiY29va2llIjoiX19Ib3N0LXB1bHNlLXNlc3Npb24ifQ" +
      "..etBHFVeCUE8BF2qU.PcuCXZvUQzJAry50prTLDgf9q-agCQLfX4lPRcRBaU6rvxlLiCD8Ylu7VNsXWr0fFEYud5JjoyPkS3PQ7vz-bMK9NLcLB3p-i1c" +
      ".4XsA0zgX8ya3bhSU8yhCFQ"
    expect(await createSealer([NEW]).open(SESSION, pinned, NOW)).toEqual({
      ok: true,
      value: VALUE,
      expiresAt: NOW + HOUR,
    })
  })

  it("refuses a value encrypted with the right key under another algorithm", async () => {
    const { kid, key: content } = sealKeyOf(NEW)
    const body = new TextEncoder().encode(JSON.stringify({ exp: NOW + HOUR, value: VALUE }))
    const sealer = createSealer([NEW])
    for (const [alg, enc] of [
      ["A256KW", "A256GCM"],
      ["dir", "A128CBC-HS256"],
    ]) {
      const other = await new CompactEncrypt(body)
        .setProtectedHeader({ alg, enc, kid, cookie: SESSION })
        .encrypt(content)
      expect(await sealer.open(SESSION, other, NOW), `${alg} ${enc}`).toEqual({
        ok: false,
        reason: "invalid",
      })
    }
  })
})
