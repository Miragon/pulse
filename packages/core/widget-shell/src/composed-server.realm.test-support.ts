import crypto from "node:crypto"
import http from "node:http"
import type { AddressInfo } from "node:net"

export interface Realm {
  serverUrl: string
  /** Answer the key set with a 500 from now on. */
  fail(): void
  /**
   * An RS256 access token from this realm: its issuer, an hour's `exp`, a signed-in user's session
   * `sid` and sign-in `auth_time`, then `claims`.
   */
  sign(claims: Record<string, unknown>): string
  close(): Promise<void>
}

/**
 * A loopback Keycloak realm that serves only its JWKS, so the Keycloak provider the env names runs
 * the real JWT verifier against tokens this test signs.
 */
export async function startRealm(): Promise<Realm> {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 })
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" }
  let failing = false
  const server = http.createServer((_req, res) => {
    if (failing) {
      res.statusCode = 500
      return res.end("down")
    }
    res.setHeader("content-type", "application/json")
    res.end(JSON.stringify({ keys: [jwk] }))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const segment = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url")
  return {
    serverUrl,
    fail: () => {
      failing = true
    },
    sign(claims) {
      const now = Math.floor(Date.now() / 1000)
      const signedIn = { sid: "session-1", auth_time: now - 60 }
      const body = { iss: `${serverUrl}/realms/platform`, exp: now + 3600, ...signedIn, ...claims }
      const signed = `${segment({ alg: "RS256", kid: "k1", typ: "JWT" })}.${segment(body)}`
      const signature = crypto.sign("RSA-SHA256", Buffer.from(signed), privateKey)
      return `${signed}.${signature.toString("base64url")}`
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
