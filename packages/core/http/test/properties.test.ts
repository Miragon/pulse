/**
 * Properties over random secrets and random answers: no failure and no trace ever shows a secret
 * of its request, and a 401 earns at most one second attempt.
 */
import fc from "fast-check"
import { describe, expect, it } from "vitest"
import {
  basicCredential,
  bearerCredential,
  type Credential,
  createHttp,
  decodeText,
  HttpFailure,
  type HttpRequest,
  noCredential,
  staticToken,
  type TokenSource,
} from "../src/index.js"
import { failWith, networkError, platformOf, type Step } from "./fake-fetch.js"

const ROOT = "http://engine.test/engine-rest"

const isControl = (char: string) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f

/**
 * A password: printable, its own marker first, so no text of the transport's own holds it, and
 * at least four characters, as masking needs; any grapheme, or ASCII with the characters each
 * encoding writes its own way (a space, @, !, +).
 */
const password = fc
  .oneof(
    fc.string({ unit: "grapheme", minLength: 2, maxLength: 16 }),
    fc.stringMatching(/^[A-Za-z0-9 @!+]{2,16}$/),
  )
  .map((text) => text.trim())
  .filter((text) => text.length >= 2 && !Array.from(text).some(isControl) && !text.includes("*"))
  .map((text) => `Qz${text}`)

const token = fc.stringMatching(/^[A-Za-z0-9\-._~+/]{2,24}$/).map((text) => `Qz${text}`)

/** How a server may quote a secret back: as is, encoded, escaped, form-encoded, reflowed. */
const quoted = fc.constantFrom(
  (secret: string) => secret,
  (secret: string) => encodeURIComponent(secret),
  (secret: string) => JSON.stringify(secret).slice(1, -1),
  (secret: string) => new URLSearchParams({ p: secret }).toString().slice(2),
  (secret: string) => secret.replace(/\s+/g, "\n  "),
)

/** Headers, a reason phrase and a Location carry bytes: anything else goes percent-encoded. */
const headerSafe = (text: string) => (/^[\x20-\x7e]*$/.test(text) ? text : encodeURIComponent(text))

type Quote = (secret: string) => string

/** Answers that each quote a secret where a failure or its answer shows it. */
const echoes = (said: string): Step[] => [
  new Response(JSON.stringify({ type: "X", message: `sent ${said} back` }), {
    status: 500,
    headers: { "Content-Type": "application/json" },
  }),
  new Response(`token ${said}`, { status: 401, headers: { "Content-Type": "text/plain" } }),
  new Response(`<p>${said}</p>`, { status: 403, headers: { "Content-Type": "text/html" } }),
  new Response(null, {
    status: 404,
    statusText: `no ${headerSafe(said)}`,
    headers: { "X-Said": headerSafe(said) },
  }),
  new Response(null, {
    status: 302,
    headers: { Location: headerSafe(`https://sso.test/${said}/x?t=${said}`) },
  }),
  failWith(networkError("ECONNRESET")),
  failWith(new Error(`socket ${said}`)),
]

/** Everything a failure shows: its message, details and answer. */
function shownBy(failure: HttpFailure): string {
  const answer = failure.answer
  return [
    failure.message,
    failure.target,
    failure.location ?? "",
    JSON.stringify(failure.problem ?? {}),
    answer === undefined ? "" : decodeText(answer),
    answer === undefined ? "" : JSON.stringify(answer.headers) + answer.statusText,
  ].join("\n")
}

async function failureOf(promise: Promise<unknown>): Promise<HttpFailure> {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  expect(error).toBeInstanceOf(HttpFailure)
  return error as HttpFailure
}

/**
 * How a secret would show: as it is, as the server quoted it (form-encoded: `+` for a space) and
 * as the URL parser writes it into a redirect target's path (`%20` for a space, `@` kept), each
 * as long as masking needs (the parser resolves `/..` away).
 */
function leaksOf(secret: string, quote: Quote): string[] {
  const url = new URL("http://h/")
  url.pathname = secret
  return [secret, quote(secret), url.pathname.slice(1)].filter((leak) => leak.length >= 4)
}

/** Every text the failures and traces of `secret`'s echoes show. */
async function shownFor(credential: Credential, secret: string, quote: Quote): Promise<string> {
  const shown: string[] = []
  for (const step of echoes(quote(secret))) {
    const { platform, events } = platformOf([step])
    const http = createHttp({ url: ROOT, credential, timeoutMs: 1_000 }, platform)
    const request: HttpRequest = {
      method: "GET",
      url: `${ROOT}/x/${encodeURIComponent(secret)}`,
      intent: "read",
    }
    shown.push(shownBy(await failureOf(http.call(request))), JSON.stringify(events))
  }
  return shown.join("\n")
}

describe("no failure and no trace shows a secret", () => {
  it("of Basic: the password and the Basic value, however the server quotes them", async () => {
    await fc.assert(
      fc.asyncProperty(password, quoted, async (secret, quote) => {
        const credential = basicCredential("demo", secret)
        const value = (await credential.authorization())?.secrets[1] ?? ""
        const shown = await shownFor(credential, secret, quote)
        for (const leak of [...leaksOf(secret, quote), value]) expect(shown).not.toContain(leak)
        const echoed = await shownFor(credential, value, quote)
        for (const leak of leaksOf(value, quote)) expect(echoed).not.toContain(leak)
      }),
      { numRuns: 40 },
    )
  })

  it("of a bearer token, however the server quotes it", async () => {
    await fc.assert(
      fc.asyncProperty(token, quoted, async (secret, quote) => {
        const shown = await shownFor(bearerCredential(staticToken(secret)), secret, quote)
        for (const leak of leaksOf(secret, quote)) expect(shown).not.toContain(leak)
      }),
      { numRuns: 40 },
    )
  })

  it("of a secret header the connection names", async () => {
    await fc.assert(
      fc.asyncProperty(token, async (secret) => {
        const { platform, events } = platformOf(echoes(secret).slice(0, 1))
        const http = createHttp(
          {
            url: ROOT,
            credential: noCredential,
            timeoutMs: 1_000,
            headers: { "X-Key": secret },
            secretHeaders: ["x-key"],
          },
          platform,
        )
        const failure = await failureOf(
          http.call({ method: "GET", url: `${ROOT}/x`, intent: "read" }),
        )
        expect(`${shownBy(failure)}${JSON.stringify(events)}`).not.toContain(secret)
      }),
      { numRuns: 20 },
    )
  })
})

describe("a 401 earns at most one second attempt", () => {
  const status = fc.constantFrom(200, 204, 400, 401, 403, 404, 500)

  it("exactly when the credential is renewable and says it renewed", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(status, { minLength: 1, maxLength: 4 }),
        fc.boolean(),
        fc.array(fc.boolean(), { minLength: 1, maxLength: 4 }),
        async (statuses, renewable, decisions) => {
          let asked = 0
          const source: TokenSource = {
            renewable,
            token: () => Promise.resolve(`tok-${String(asked)}`),
            rejected: () => Promise.resolve(decisions[asked++] ?? true),
          }
          const steps = statuses.map((code) => new Response(null, { status: code }))
          const { platform, calls } = platformOf(steps)
          const http = createHttp(
            { url: ROOT, credential: bearerCredential(source), timeoutMs: 1_000 },
            platform,
          )
          const answer = await http.send({ method: "GET", url: `${ROOT}/x`, intent: "read" })
          const retried = statuses[0] === 401 && renewable && decisions[0] === true
          expect(calls).toHaveLength(retried ? 2 : 1)
          expect(asked).toBe(statuses[0] === 401 && renewable ? 1 : 0)
          expect(answer.status).toBe(statuses[retried ? Math.min(1, statuses.length - 1) : 0])
        },
      ),
    )
  })
})
