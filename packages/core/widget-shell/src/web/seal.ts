/**
 * The seal of the web app's cookies: a value becomes a JWE in compact serialization (`dir`,
 * `A256GCM`, on jose), which only this server reads and nobody alters unseen. Each configured key
 * (`MCP_WEB_SESSION_KEYS`) yields its content key and its key id by HKDF-SHA256; the first key
 * seals and every key opens, so a key is rotated by putting the new one first and dropping the old
 * one a session's lifetime later.
 *
 * The cookie a value is sealed for is named in the protected header, which compact serialization
 * authenticates as the encryption's additional data (RFC 7516 §5.1), so a value sealed for one
 * cookie never opens as another. Every sealed value carries an absolute expiry: `reseal` keeps the
 * one the value was opened with, so no refresh of the session's tokens ever extends the session.
 */
import { hkdfSync } from "node:crypto"
import { CompactEncrypt, compactDecrypt } from "jose"

const ALGORITHM = "dir"
const ENCRYPTION = "A256GCM"
const SALT = "pulse web seal"
const KEY_INFO = "A256GCM content key"
const KID_INFO = "key id"
/** 9 bytes, 12 characters of base64url: enough to tell a handful of keys apart, nothing to guess. */
const KID_BYTES = 9

export interface SealKey {
  readonly kid: string
  readonly key: Uint8Array
}

/** A value that opened: its content and the expiry it was sealed with (milliseconds since epoch). */
interface Opened {
  readonly ok: true
  readonly value: unknown
  readonly expiresAt: number
}

/** Why a value did not open: its expiry passed, or it is no value this server sealed for the cookie. */
export interface Refused {
  readonly ok: false
  readonly reason: "expired" | "invalid"
}

export interface Sealer {
  /** Seals `value` for the cookie `name`, valid until `expiresAt` (milliseconds since epoch). */
  seal(name: string, value: unknown, expiresAt: number): Promise<string>
  /** Seals a new value for the cookie an opened one came from, with the expiry it came with. */
  reseal(name: string, opened: Opened, value: unknown): Promise<string>
  /** Opens a value sealed for the cookie `name`, refusing it once its expiry is not after `now`. */
  open(name: string, sealed: string, now?: number): Promise<Opened | Refused>
}

const derive = (entry: Uint8Array, info: string, bytes: number): Uint8Array =>
  new Uint8Array(hkdfSync("sha256", entry, SALT, info, bytes))

/** One configured key's content key and key id, each derived by HKDF-SHA256 with its own label. */
export function sealKeyOf(entry: Uint8Array): SealKey {
  return {
    kid: Buffer.from(derive(entry, KID_INFO, KID_BYTES)).toString("base64url"),
    key: derive(entry, KEY_INFO, 32),
  }
}

const INVALID: Refused = { ok: false, reason: "invalid" }
const EXPIRED: Refused = { ok: false, reason: "expired" }

/** What a sealed value holds: the value and its absolute expiry. Only this sealer writes it. */
interface Body {
  readonly exp: number
  readonly value: unknown
}

/** A sealer over the configured keys, in their order: the first seals, every one opens. */
export function createSealer(entries: readonly Uint8Array[]): Sealer {
  if (entries.length === 0) throw new TypeError("The seal needs at least one key")
  const keys = entries.map(sealKeyOf)
  const [sealing] = keys
  const byKid = new Map<string | undefined, Uint8Array>(keys.map(({ kid, key }) => [kid, key]))

  const seal = async (name: string, value: unknown, expiresAt: number): Promise<string> => {
    if (!Number.isFinite(expiresAt)) throw new TypeError("A sealed value needs a finite expiry")
    const body = new TextEncoder().encode(JSON.stringify({ exp: expiresAt, value }))
    return new CompactEncrypt(body)
      .setProtectedHeader({ alg: ALGORITHM, enc: ENCRYPTION, kid: sealing.kid, cookie: name })
      .encrypt(sealing.key)
  }

  const open = async (name: string, sealed: string, now = Date.now()) => {
    try {
      const { plaintext, protectedHeader } = await compactDecrypt(
        sealed,
        // An unknown or missing key id finds no key, and jose decrypts nothing without one.
        ({ kid }) => byKid.get(kid) as Uint8Array,
        { keyManagementAlgorithms: [ALGORITHM], contentEncryptionAlgorithms: [ENCRYPTION] },
      )
      if (protectedHeader.cookie !== name) return INVALID
      const { exp, value } = JSON.parse(new TextDecoder().decode(plaintext)) as Body
      if (!(exp > now)) return EXPIRED
      return { ok: true, value, expiresAt: exp } as const
    } catch {
      return INVALID
    }
  }

  return {
    seal,
    reseal: (name, opened, value) => seal(name, value, opened.expiresAt),
    open,
  }
}
