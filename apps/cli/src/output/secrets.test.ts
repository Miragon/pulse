import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { maskHeaders, maskUrl, maskUrlsInText } from "./secrets.js"

const SCHEMES = [
  "Basic",
  "Bearer",
  "Digest",
  "DPoP",
  "HOBA",
  "Mutual",
  "Negotiate",
  "NTLM",
  "Token",
  "AWS4-HMAC-SHA256",
]

const SECRET_NAMES = [
  "Authorization",
  "authorization",
  "Proxy-Authorization",
  "Cookie",
  "Set-Cookie",
  "X-Auth-Token",
  "TOKEN",
  "X-Client-Secret",
  "X-Password",
  "X-Api-Key",
  "x-apikey",
]

const PLAIN_NAMES = ["Accept", "Content-Type", "X-Request-Id", "X-Auth", "Api_Key", "X-Pass"]

describe("maskHeaders", () => {
  it("masks the values of secret header names in any case", () => {
    for (const name of SECRET_NAMES) {
      expect(maskHeaders({ [name]: "abc123" }, false)).toEqual({ [name]: "***" })
    }
  })

  it("keeps non-secret headers unchanged", () => {
    for (const name of PLAIN_NAMES) {
      expect(maskHeaders({ [name]: "Bearer abc" }, false)).toEqual({ [name]: "Bearer abc" })
    }
  })

  it("keeps well-known auth schemes in front of the masked credential", () => {
    for (const scheme of SCHEMES) {
      expect(maskHeaders({ Authorization: `${scheme} c2VjcmV0` }, false)).toEqual({
        Authorization: `${scheme} ***`,
      })
    }
  })

  it("matches schemes case-insensitively and keeps their spelling", () => {
    expect(maskHeaders({ Authorization: "bearer abc" }, false)).toEqual({
      Authorization: "bearer ***",
    })
    expect(maskHeaders({ Authorization: "BASIC dXNlcjpwdw==" }, false)).toEqual({
      Authorization: "BASIC ***",
    })
  })

  it("accepts any whitespace between scheme and credential", () => {
    expect(maskHeaders({ Authorization: "Bearer   abc" }, false).Authorization).toBe("Bearer ***")
    expect(maskHeaders({ Authorization: "Bearer\tabc" }, false).Authorization).toBe("Bearer ***")
  })

  it("masks everything when there is no credential after the scheme or no known scheme", () => {
    const cases = [
      "Bearer",
      "Bearer   ",
      " Bearer abc",
      "xBearer abc",
      "Custom abc",
      "a=b; c=d",
      "",
    ]
    for (const value of cases) {
      expect(maskHeaders({ Authorization: value }, false).Authorization).toBe("***")
    }
  })

  it("masks only the secret headers of a mixed set", () => {
    expect(
      maskHeaders(
        { Accept: "application/json", Authorization: "Bearer abc", Cookie: "JSESSIONID=1" },
        false,
      ),
    ).toEqual({ Accept: "application/json", Authorization: "Bearer ***", Cookie: "***" })
  })

  it("returns all values unchanged in a new object with show", () => {
    const headers = { Authorization: "Bearer abc", Accept: "text/plain" }
    const shown = maskHeaders(headers, true)
    expect(shown).toEqual(headers)
    expect(shown).not.toBe(headers)
  })

  it("never leaks a credential of a secret header (property)", () => {
    const scheme = fc.option(fc.constantFrom(...SCHEMES), { nil: undefined })
    const credential = fc.stringMatching(/^[A-Za-z0-9+/=._~-]{1,40}$/)
    fc.assert(
      fc.property(fc.constantFrom(...SECRET_NAMES), scheme, credential, (name, prefix, secret) => {
        const value = prefix === undefined ? secret : `${prefix} ${secret}`
        const masked = maskHeaders({ [name]: value }, false)[name]
        expect(masked).toBe(prefix === undefined ? "***" : `${prefix} ***`)
      }),
    )
  })

  it("reduces any secret value to *** or a scheme prefix of it (property)", () => {
    fc.assert(
      fc.property(fc.constantFrom(...SECRET_NAMES), fc.string(), (name, value) => {
        const masked = maskHeaders({ [name]: value }, false)[name]!
        if (value.length > 0 && !"***".includes(value)) expect(masked).not.toBe(value)
        if (masked === "***") return
        const scheme = masked.slice(0, -" ***".length)
        expect(masked.endsWith(" ***")).toBe(true)
        expect(value.startsWith(scheme)).toBe(true)
        expect(SCHEMES.map((known) => known.toLowerCase())).toContain(scheme.toLowerCase())
      }),
    )
  })

  it("leaves non-secret headers unchanged (property)", () => {
    const name = fc
      .string()
      .filter((text) => !/authorization|cookie|token|secret|password|api-?key/i.test(text))
    fc.assert(
      fc.property(fc.dictionary(name, fc.string()), (headers) => {
        expect(maskHeaders(headers, false)).toEqual(headers)
      }),
    )
  })
})

describe("maskUrl", () => {
  it("masks the userinfo password", () => {
    expect(maskUrl("https://user:pw@host/x", false)).toBe("https://user:***@host/x")
    expect(maskUrl("http://admin:secret@localhost:8080/engine-rest?a=1#f", false)).toBe(
      "http://admin:***@localhost:8080/engine-rest?a=1#f",
    )
    expect(maskUrl("https://user:pw@host", false)).toBe("https://user:***@host")
  })

  it("masks a password that contains @ and : up to the last @ of the authority", () => {
    expect(maskUrl("https://u:p@ss:w@host/", false)).toBe("https://u:***@host/")
  })

  it("masks a password with an empty user name", () => {
    expect(maskUrl("https://:pw@host", false)).toBe("https://:***@host")
  })

  it("splits the userinfo at the first colon and ends it at the last @", () => {
    expect(maskUrl("http://a@b:c@host/x", false)).toBe("http://a@b:***@host/x")
    expect(maskUrl("http://u:p@h:8080@x/y", false)).toBe("http://u:***@x/y")
    expect(maskUrl("http://u:p@host:8080/a@b", false)).toBe("http://u:***@host:8080/a@b")
  })

  it("keeps URLs without a password unchanged", () => {
    const urls = [
      "https://user@host/x",
      "https://user:@host/x",
      "http://localhost:8080/engine-rest",
      "http://host/a:b@c",
      "http://host?x=a:b@c",
      "http://host#a:b@c",
      "http://host\\a:b@c",
      "http://host",
      "not a url",
      "mailto:a:b@c",
      "1http://u:p@h",
      "see http://u:p@h",
      "",
    ]
    for (const url of urls) expect(maskUrl(url, false)).toBe(url)
  })

  it("accepts any scheme letters, digits, +, . and -", () => {
    expect(maskUrl("HTTPS://u:p@h", false)).toBe("HTTPS://u:***@h")
    expect(maskUrl("git+ssh.v2-x://u:p@h", false)).toBe("git+ssh.v2-x://u:***@h")
  })

  it("returns the URL unchanged with show", () => {
    expect(maskUrl("https://user:pw@host/x", true)).toBe("https://user:pw@host/x")
  })

  it("never leaks the userinfo password (property)", () => {
    const user = fc.stringMatching(/^[A-Za-z0-9._~%!$&'()*+,;=-]{0,12}$/)
    const password = fc.stringMatching(/^[^@/?#\\]{1,20}$/)
    const rest = fc.stringMatching(/^(?:[/?#][^@]{0,20})?$/)
    fc.assert(
      fc.property(user, password, rest, (name, secret, tail) => {
        const masked = maskUrl(`https://${name}:${secret}@example.com${tail}`, false)
        expect(masked).toBe(`https://${name}:***@example.com${tail}`)
        expect(masked.slice(0, masked.indexOf("@"))).toBe(`https://${name}:***`)
      }),
    )
  })
})

describe("maskUrlsInText", () => {
  it("masks every URL password in a text, as quoted by fetch and network errors", () => {
    const url = "http://demo:s3cret@localhost:1/engine-rest/x"
    const text = `Cannot reach ${url} (Request cannot be constructed from a URL that includes credentials: ${url})`
    const masked = "http://demo:***@localhost:1/engine-rest/x"
    expect(maskUrlsInText(text, false)).toBe(
      `Cannot reach ${masked} (Request cannot be constructed from a URL that includes credentials: ${masked})`,
    )
  })

  it("ends URLs at whitespace, double quotes and angle brackets", () => {
    expect(maskUrlsInText('"http://u:p@h" <https://a:b@c>', false)).toBe(
      '"http://u:***@h" <https://a:***@c>',
    )
    expect(maskUrlsInText("see http://u:p@h, then x@y", false)).toBe("see http://u:***@h, then x@y")
    const unchanged = [
      "http://u:p q@h",
      "http://u:p\tq@h",
      'http://u:p"q@h',
      "http://u:p<q@h",
      "http://u:p>q@h",
      "http://u q:p@h",
      'http://u"q:p@h',
      "http://u<q:p@h",
      "http://u>q:p@h",
      "http://host:8080 mail me@example.com",
      "http://host/a:b@c",
      "http://host?a:b@c",
      "http://host#a:b@c",
      "http://host\\a:b@c",
      "http://u:@h",
      "mailto:a:b@c",
      "no url here",
      "",
    ]
    for (const text of unchanged) expect(maskUrlsInText(text, false)).toBe(text)
  })

  it("masks up to the last @ of the authority and keeps the user name", () => {
    expect(maskUrlsInText("x http://u:p@ss@host/a@b y", false)).toBe("x http://u:***@host/a@b y")
    expect(maskUrlsInText("http://a@b:c@host", false)).toBe("http://a@b:***@host")
    expect(maskUrlsInText("http://:pw@host", false)).toBe("http://:***@host")
  })

  it("finds URLs right after other characters and with any scheme", () => {
    expect(maskUrlsInText("(1http://u:p@h)", false)).toBe("(1http://u:***@h)")
    expect(maskUrlsInText("url=git+ssh.v2-x://u:p@h", false)).toBe("url=git+ssh.v2-x://u:***@h")
    expect(maskUrlsInText(`${"w".repeat(40)}http://u:p@h`, false)).toBe(
      `${"w".repeat(40)}http://u:***@h`,
    )
  })

  it("masks schemes that end with a digit, +, . or - but needs a letter to start one", () => {
    for (const scheme of ["s3", "x+", "x.", "x-", "a1.+-"]) {
      expect(maskUrlsInText(`${scheme}://u:p@h`, false)).toBe(`${scheme}://u:***@h`)
    }
    for (const text of ["3://u:p@h", "+://u:p@h", " ://u:p@h", "://u:p@h"]) {
      expect(maskUrlsInText(text, false)).toBe(text)
    }
  })

  it("returns the text unchanged with show", () => {
    expect(maskUrlsInText("http://u:p@h", true)).toBe("http://u:p@h")
  })

  it("scans long texts in linear time", () => {
    const text = `${"a".repeat(200_000)} ${"b.".repeat(100_000)}`
    const start = performance.now()
    expect(maskUrlsInText(text, false)).toBe(text)
    expect(performance.now() - start).toBeLessThan(1000)
  })

  it("never leaks a URL password in a text (property)", () => {
    const user = fc.stringMatching(/^[^\s"<>:/?#\\]{0,12}$/)
    const password = fc.stringMatching(/^[^\s"<>/?#\\]{1,20}$/)
    const tail = fc
      .stringMatching(/^(?:[/?#][^\s]{0,20})?$/)
      .filter((text) => !text.includes("://"))
    const words = fc.string().filter((text) => !text.includes("://"))
    const parts = fc.record({
      before: words,
      name: user,
      secret: password,
      rest: tail,
      after: words,
    })
    fc.assert(
      fc.property(parts, ({ before, name, secret, rest, after }) => {
        const text = `${before} https://${name}:${secret}@example.com${rest} ${after}`
        expect(maskUrlsInText(text, false)).toBe(
          `${before} https://${name}:***@example.com${rest} ${after}`,
        )
      }),
    )
  })
})
