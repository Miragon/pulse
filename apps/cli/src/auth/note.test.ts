import { bearerCredential, type Credential, noCredential } from "@miragon/pulse-http"
import { describe, expect, it } from "vitest"
import { headersOf, renewalOf } from "../../test/support/credential.js"
import { PulseCliError } from "../errors.js"
import { withAuthNote } from "./note.js"
import type { AuthProvider, Principal } from "./types.js"

const NOTE = "A bearer token is set (from PULSE_CLI_TOKEN) but not used."

/** A provider like the OAuth one: a class with a getter and a credential whose methods use `this`. */
class FakeOAuth implements AuthProvider {
  readonly type = "oauth"
  readonly loginStatusCommand = "pulse auth status"
  readonly credential: Credential = bearerCredential({
    renewable: true,
    token: () => this.token(),
    rejected: () => this.refresh(),
  })
  user: string | undefined
  constructor(private readonly failure: PulseCliError | undefined) {}

  get principal(): Principal | undefined {
    return this.user === undefined ? undefined : { user: this.user, source: "login" }
  }

  private token() {
    this.user = "alice"
    return this.failure === undefined ? Promise.resolve("t") : Promise.reject(this.failure)
  }

  private refresh() {
    return this.failure === undefined ? Promise.resolve(true) : Promise.reject(this.failure)
  }

  preview() {
    return Promise.resolve({ headers: {}, note: "Not logged in." })
  }

  rejectedHint(status: number) {
    return `${this.type} ${status}`
  }
}

const loginRequired = new PulseCliError("LOGIN_REQUIRED", "Not logged in", { hint: "Log in." })

describe("withAuthNote", () => {
  it("returns the provider itself without a note", () => {
    const provider = new FakeOAuth(undefined)
    expect(withAuthNote(provider, undefined)).toBe(provider)
  })

  it("appends the note to LOGIN_REQUIRED and the dry-run note, and exposes it", async () => {
    const noted = withAuthNote(new FakeOAuth(loginRequired), NOTE)
    expect(noted.note).toBe(NOTE)
    await expect(headersOf(noted)).rejects.toMatchObject({
      code: "LOGIN_REQUIRED",
      message: "Not logged in",
      details: { hint: `Log in. ${NOTE}` },
    })
    await expect(renewalOf(noted)).rejects.toMatchObject({ details: { hint: `Log in. ${NOTE}` } })
    await expect(noted.preview?.()).resolves.toEqual({
      headers: {},
      note: `Not logged in. ${NOTE}`,
    })
    const bare = withAuthNote(new FakeOAuth(new PulseCliError("LOGIN_REQUIRED", "x")), NOTE)
    await expect(headersOf(bare)).rejects.toMatchObject({ details: { hint: NOTE } })
  })

  it("keeps other failures, getters and methods of the provider as they are", async () => {
    const other = new PulseCliError("NETWORK", "down")
    await expect(headersOf(withAuthNote(new FakeOAuth(other), NOTE))).rejects.toBe(other)
    const provider = new FakeOAuth(undefined)
    const noted = withAuthNote(provider, NOTE)
    expect(noted.principal).toBeUndefined()
    await expect(headersOf(noted)).resolves.toEqual({ Authorization: "Bearer t" })
    expect(noted.principal).toEqual({ user: "alice", source: "login" })
    await expect(renewalOf(noted)).resolves.toBe(true)
    expect(noted.rejectedHint?.(401)).toBe("oauth 401")
    expect(noted).toMatchObject({ type: "oauth", loginStatusCommand: "pulse auth status" })
  })

  it("adds no method the provider lacks and keeps a preview without a note", async () => {
    const basic: AuthProvider = { type: "basic", off: "off", credential: noCredential }
    const noted = withAuthNote(basic, NOTE)
    expect(noted.credential.renewable).toBe(false)
    expect(noted.credential.scheme).toBe("none")
    expect("rejectedHint" in noted).toBe(false)
    expect(noted.off).toBe("off")
    await expect(noted.preview?.()).resolves.toEqual({ headers: {} })
  })
})
