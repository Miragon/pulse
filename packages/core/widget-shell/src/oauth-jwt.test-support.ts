import crypto from "node:crypto"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { CompactSign } from "jose"

/**
 * A loopback IdP for the JWT verifier's suites: it serves only key sets, which a test sets per path
 * or for every path, and tokens this file signs with the keys below.
 */

export type Mode = "ok" | "500" | "html" | "malformed" | "silent"

export interface Idp {
  url: string
  issuer: string
  mode: Mode
  /** The key set every path serves unless `sets` names the path. */
  keys: unknown[]
  /** A key set per path (`/a/keys`), before `keys`. */
  sets: Record<string, unknown>
  /** An answer every path gets instead, as sent. */
  answer: { status: number; body: string } | undefined
  hits: number
  /** The paths asked for, in order. */
  paths: string[]
  close(): Promise<void>
}

export const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 })
export const rsa2 = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 })
export const rsa3 = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 })
export const ec = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" })
export const ed = crypto.generateKeyPairSync("ed25519")

export const jwk = (key: crypto.KeyObject, extra: Record<string, unknown>) => ({
  ...key.export({ format: "jwk" }),
  use: "sig",
  ...extra,
})

export const JWK_RSA = jwk(rsa.publicKey, { kid: "k1", alg: "RS256" })
export const JWK_RSA2 = jwk(rsa2.publicKey, { kid: "k2", alg: "RS256" })
export const JWK_EC = jwk(ec.publicKey, { kid: "e1", alg: "ES256" })

export async function startIdp(): Promise<Idp> {
  const state = {
    mode: "ok" as Mode,
    keys: [JWK_RSA, JWK_EC] as unknown[],
    sets: {} as Record<string, unknown>,
    answer: undefined as Idp["answer"],
    hits: 0,
    paths: [] as string[],
  }
  const server = http.createServer((req, res) => {
    state.hits += 1
    const path = String(req.url)
    state.paths.push(path)
    if (state.mode === "silent") return
    if (state.answer !== undefined) {
      res.statusCode = state.answer.status
      res.setHeader("content-type", "application/json")
      return res.end(state.answer.body)
    }
    if (state.mode === "500") {
      res.statusCode = 500
      return res.end("boom")
    }
    if (state.mode === "html") {
      res.setHeader("content-type", "text/html")
      return res.end("<html></html>")
    }
    res.setHeader("content-type", "application/json")
    const set = state.sets[path] ?? { keys: state.keys }
    res.end(JSON.stringify(state.mode === "malformed" ? { keys: "nope" } : set))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return Object.assign(state, {
    url,
    issuer: `${url}/realms/platform`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  })
}

/** Back to its first state: every path serves the RSA and the EC key. */
export function resetIdp(idp: Idp): void {
  idp.mode = "ok"
  idp.keys = [JWK_RSA, JWK_EC]
  idp.sets = {}
  idp.answer = undefined
  idp.hits = 0
  idp.paths = []
}

const segment = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url")

export interface SignOptions {
  key?: crypto.KeyObject | string
  alg?: string
  kid?: string | null
  typ?: string | null
  header?: Record<string, unknown>
}

function signature(input: string, alg: string, key: crypto.KeyObject | string): Buffer {
  const data = Buffer.from(input)
  if (alg === "RS256") return crypto.sign("RSA-SHA256", data, key)
  if (alg === "RS512") return crypto.sign("RSA-SHA512", data, key)
  if (alg === "PS256") {
    return crypto.sign("sha256", data, {
      key: key as crypto.KeyObject,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: 32,
    })
  }
  if (alg === "ES256") {
    return crypto.sign("sha256", data, { key: key as crypto.KeyObject, dsaEncoding: "ieee-p1363" })
  }
  if (alg === "Ed25519") return crypto.sign(null, data, key)
  return Buffer.alloc(0)
}

export function sign(claims: Record<string, unknown>, options: SignOptions = {}): string {
  const { key = rsa.privateKey, alg = "RS256", kid = "k1", typ = "JWT", header = {} } = options
  const head = {
    alg,
    ...(typ === null ? {} : { typ }),
    ...(kid === null ? {} : { kid }),
    ...header,
  }
  const input = `${segment(head)}.${segment(claims)}`
  return `${input}.${signature(input, alg, key).toString("base64url")}`
}

/** A token signed with a shared secret (HS256), the forgery a verifier must refuse whatever the secret. */
export async function signWithSecret(
  claims: Record<string, unknown>,
  secret: string,
  kid = "k1",
): Promise<string> {
  return new CompactSign(new TextEncoder().encode(JSON.stringify(claims)))
    .setProtectedHeader({ alg: "HS256", typ: "JWT", kid })
    .sign(new TextEncoder().encode(secret))
}

export const now = () => Math.floor(Date.now() / 1000)
