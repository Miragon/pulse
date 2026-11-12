import { noCredential } from "@miragon/pulse-http"
import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { headersOf } from "../../test/support/credential.js"
import type { BasicAuthConfig, Source } from "../config/types.js"
import { basicAuth, credentialHeaders, credentialSource } from "./basic.js"

function config(username: string, password: string, sources?: BasicAuthConfig["sources"]) {
  return {
    type: "basic",
    username,
    password,
    sources: sources ?? { username: "flag", password: "flag" },
  } satisfies BasicAuthConfig
}

/** Reverses the header: Base64, then UTF-8, split at the first ":" (RFC 7617). */
function decode(header: string): { username: string; password: string } {
  expect(header.startsWith("Basic ")).toBe(true)
  const bytes = Uint8Array.from(atob(header.slice("Basic ".length)), (char) => char.charCodeAt(0))
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  const colon = text.indexOf(":")
  return { username: text.slice(0, colon), password: text.slice(colon + 1) }
}

/** Text without control characters, from the whole Unicode range (also astral characters). */
const text = fc
  .string({ unit: "binary", minLength: 1 })
  .map((value) => value.replace(/\p{Cc}/gu, ""))
const username = text.map((value) => value.replaceAll(":", "")).filter((value) => value !== "")
const password = fc.oneof(
  text,
  text.map((value) => `${value}:${value}`),
)

/** The Authorization header the Basic provider's credential sends. */
async function basicHeader(username: string, password: string): Promise<string | undefined> {
  return (await headersOf(basicAuth(config(username, password)))).Authorization
}

describe("the Basic credential (@miragon/pulse-http's)", () => {
  it("encodes username:password as Base64 of UTF-8", async () => {
    expect(await basicHeader("demo", "demo")).toBe("Basic ZGVtbzpkZW1v")
    expect(await basicHeader("Aladdin", "open sesame")).toBe("Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==")
    // RFC 7617 section 2.1: "test" / "123£" in UTF-8
    expect(await basicHeader("test", "123£")).toBe("Basic dGVzdDoxMjPCow==")
    expect(await basicHeader("josé", "päss:wörd \u{1f511}")).toBe(
      `Basic ${Buffer.from("josé:päss:wörd \u{1f511}", "utf8").toString("base64")}`,
    )
  })

  it('round-trips any username and password, also non-ASCII and ":" in the password', async () => {
    await fc.assert(
      fc.asyncProperty(username, password, async (user, secret) => {
        const header = (await basicHeader(user, secret)) ?? ""
        expect(header).toMatch(/^Basic [A-Za-z0-9+/]+={0,2}$/)
        expect(decode(header)).toEqual({ username: user, password: secret })
        expect(header).toBe(`Basic ${Buffer.from(`${user}:${secret}`, "utf8").toString("base64")}`)
      }),
    )
  })

  it("names the password and the Basic value as the secrets the transport masks", async () => {
    const authorization = await basicAuth(config("demo", "s3cr3t")).credential.authorization()
    expect(authorization?.secrets).toEqual(["s3cr3t", "ZGVtbzpzM2NyM3Q="])
  })
})

describe("credentialSource", () => {
  const sources: readonly Source[] = ["flag", "env", "profile"]

  it("names one source when username and password share it", () => {
    for (const source of sources) {
      expect(credentialSource({ username: source, password: source })).toBe(source)
    }
  })

  it("names both sources when they differ", () => {
    expect(credentialSource({ username: "profile", password: "env" })).toBe(
      "profile for the user, env for the password",
    )
    expect(credentialSource({ username: "flag", password: "profile" })).toBe(
      "flag for the user, profile for the password",
    )
  })
})

describe("basicAuth", () => {
  it("sends the Authorization header with every request", async () => {
    const provider = basicAuth(config("demo", "s3cr3t"))
    expect(provider.type).toBe("basic")
    await expect(headersOf(provider)).resolves.toEqual({
      Authorization: "Basic ZGVtbzpzM2NyM3Q=",
    })
    await expect(headersOf(provider)).resolves.toEqual({
      Authorization: "Basic ZGVtbzpzM2NyM3Q=",
    })
  })

  it("knows its headers without network access, for dry-run previews, without a note", async () => {
    await expect(basicAuth(config("demo", "demo")).preview?.()).resolves.toEqual({
      headers: { Authorization: "Basic ZGVtbzpkZW1v" },
    })
    await expect(credentialHeaders(noCredential)).resolves.toEqual({ headers: {} })
  })

  it("describes the user and the source for the 401 hint, never the password", () => {
    const provider = basicAuth(config("demo", "pw-123", { username: "env", password: "profile" }))
    expect(provider.principal).toEqual({
      user: "demo",
      source: "env for the user, profile for the password",
    })
    expect(JSON.stringify(provider.principal)).not.toContain("pw-123")
  })

  it("cannot refresh credentials", () => {
    expect(basicAuth(config("a", "b")).credential.renewable).toBe(false)
  })
})
