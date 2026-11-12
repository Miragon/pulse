import fc from "fast-check"
import { describe, expect, it } from "vitest"
import {
  basicCredential,
  bearerCredential,
  bearerToken,
  callerToken,
  CredentialError,
  noCredential,
  staticToken,
  type TokenSource,
} from "../src/index.js"

/** The user and password a Basic header carries, read back as RFC 7617 with UTF-8 says. */
function decodedBasic(header: string): string {
  const binary = atob(header.replace(/^Basic /, ""))
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)))
}

const isControl = (char: string) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f
const printable = fc
  .string({ unit: "grapheme" })
  .filter((text) => !Array.from(text).some(isControl))

describe("basicCredential", () => {
  it("encodes a euro sign as UTF-8 (RFC 7617), where btoa alone would throw", async () => {
    const authorization = await basicCredential("demo", "€uro-secret").authorization()
    expect(authorization).toEqual({
      header: "Basic ZGVtbzrigqx1cm8tc2VjcmV0",
      secrets: ["€uro-secret", "ZGVtbzrigqx1cm8tc2VjcmV0"],
    })
  })

  it("round-trips every user without a colon and every password as UTF-8", async () => {
    await fc.assert(
      fc.asyncProperty(
        printable.filter((user) => !user.includes(":")),
        printable,
        async (u, p) => {
          const authorization = await basicCredential(u, p).authorization()
          expect(decodedBasic(authorization?.header ?? "")).toBe(`${u}:${p}`)
          expect(authorization?.secrets).toContain(p)
        },
      ),
    )
  })

  it.each([
    ["de:mo", "pw", "user-colon"],
    ["demo\n", "pw", "control-character"],
    ["demo", "pw\u0000", "control-character"],
    ["demo", "pw\u007f", "control-character"],
  ])("refuses %j / %j (%s), never naming the value", (user, password, problem) => {
    expect(() => basicCredential(user, password)).toThrow(
      new CredentialError(problem as "user-colon"),
    )
    try {
      basicCredential(user, password)
    } catch (error) {
      expect((error as CredentialError).problem).toBe(problem)
      expect(String(error)).not.toContain("pw")
    }
  })

  it("is never renewed", async () => {
    const credential = basicCredential("demo", "demo")
    expect(credential.scheme).toBe("basic")
    expect(credential.renewable).toBe(false)
    const sent = await credential.authorization()
    expect(sent && (await credential.rejected(sent))).toBe(false)
  })
})

describe("bearer tokens", () => {
  it("trims a trailing line break and a pasted Bearer prefix", () => {
    expect(bearerToken("tok-demo-123\n")).toBe("tok-demo-123")
    expect(bearerToken("  Bearer   tok-demo-123 ")).toBe("tok-demo-123")
    expect(bearerToken("bearer abc==")).toBe("abc==")
  })

  it.each(["tok-demo\n123", "two words", "", "abc=d", "ä-token"])(
    "refuses %j without echoing it",
    (token) => {
      expect(() => bearerToken(token)).toThrow(new CredentialError("token-syntax"))
      expect(() => staticToken(token)).toThrow("credential refused: token-syntax")
    },
  )

  it("takes every RFC 6750 b64token", () => {
    const b64token = fc.stringMatching(/^[A-Za-z0-9\-._~+/]+=*$/)
    fc.assert(
      fc.property(b64token, (token) => {
        expect(bearerToken(`\n ${token}\r\n`)).toBe(token)
      }),
    )
  })

  it("sends a static token, checked when it is made", async () => {
    const credential = bearerCredential(staticToken("tok-demo-123\n"))
    expect(credential.scheme).toBe("bearer")
    expect(credential.renewable).toBe(false)
    const sent = await credential.authorization()
    expect(sent).toEqual({ header: "Bearer tok-demo-123", secrets: ["tok-demo-123"] })
    expect(sent && (await credential.rejected(sent))).toBe(false)
  })

  it("reads the caller's token for every request, and none means no header", async () => {
    let token: string | undefined = "caller-1"
    const credential = bearerCredential(callerToken(() => token))
    expect((await credential.authorization())?.header).toBe("Bearer caller-1")
    token = "caller-2"
    expect((await credential.authorization())?.header).toBe("Bearer caller-2")
    token = undefined
    expect(await credential.authorization()).toBeUndefined()
    token = "  "
    expect(await credential.authorization()).toBeUndefined()
    token = "bad\ntoken"
    await expect(credential.authorization()).rejects.toThrow(CredentialError)
  })

  it("hands a 401 to a renewing source with the token that was sent", async () => {
    const rejected: string[] = []
    const source: TokenSource = {
      renewable: true,
      token: () => Promise.resolve("tok-1"),
      rejected: (sent) => {
        rejected.push(sent)
        return Promise.resolve(true)
      },
    }
    const credential = bearerCredential(source)
    expect(credential.renewable).toBe(true)
    const sent = await credential.authorization()
    expect(sent && (await credential.rejected(sent))).toBe(true)
    expect(rejected).toEqual(["tok-1"])
  })
})

describe("noCredential", () => {
  it("sends no header and never renews", async () => {
    expect(noCredential.scheme).toBe("none")
    expect(noCredential.renewable).toBe(false)
    expect(await noCredential.authorization()).toBeUndefined()
    expect(await noCredential.rejected({ header: "x", secrets: [] })).toBe(false)
  })
})
