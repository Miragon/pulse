import crypto from "node:crypto"
import http from "node:http"
import type { AddressInfo } from "node:net"
import type { ComposedServer } from "@miragon/pulse-widget-shell/server"

/**
 * A loopback Keycloak realm (`platform`) that serves only its key set, for the tests that boot
 * the app under OAuth with passthrough auth (passthrough.e2e.test.ts and the error-path goldens):
 * the boot verifies the caller's bearer token against it, and the engine module forwards that
 * token. `sign` issues its RS256 tokens, valid for an hour of the real clock.
 */
export async function startRealm() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 })
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" }
  const server = http.createServer((_req, res) => {
    res.setHeader("content-type", "application/json")
    res.end(JSON.stringify({ keys: [jwk] }))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const segment = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url")
  return {
    url,
    sign(claims: Record<string, unknown>) {
      const exp = Math.floor(Date.now() / 1000) + 3600
      const body = { iss: `${url}/realms/platform`, exp, ...claims }
      const signed = `${segment({ alg: "RS256", kid: "k1", typ: "JWT" })}.${segment(body)}`
      const signature = crypto.sign("RSA-SHA256", Buffer.from(signed), privateKey)
      return `${signed}.${signature.toString("base64url")}`
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

/**
 * One `tools/call` through the app's own handler with `authorization` as sent, as an MCP host
 * sends it under OAuth.
 */
export function postToolCall(
  composed: ComposedServer,
  authorization: string,
  name: string,
  args: Record<string, unknown>,
): Promise<Response> {
  return composed.app.fetch(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        host: "localhost",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    }),
  )
}
