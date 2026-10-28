import { describe, expect, it } from "vitest"
import { withAuthNote } from "./note.js"
import type { AuthProvider, Principal } from "./types.js"

const NOTE = "A bearer token is set (from PULSE_CLI_TOKEN) but not used."

/** A provider like the token command one: a class with a getter and methods that use `this`. */
class FakeCommand implements AuthProvider {
  readonly type = "bearer"
  user: string | undefined

  get principal(): Principal | undefined {
    return this.user === undefined ? undefined : { user: this.user, source: "login" }
  }

  headers() {
    this.user = "alice"
    return Promise.resolve({ Authorization: "Bearer t" })
  }

  refresh() {
    return Promise.resolve(true)
  }

  preview() {
    return Promise.resolve({ headers: {}, note: "The command runs when the request is sent." })
  }

  rejectedHint(status: number) {
    return `${this.type} ${status}`
  }
}

describe("withAuthNote", () => {
  it("returns the provider itself without a note", () => {
    const provider = new FakeCommand()
    expect(withAuthNote(provider, undefined)).toBe(provider)
  })

  it("appends the note to the dry-run note and exposes it", async () => {
    const noted = withAuthNote(new FakeCommand(), NOTE)
    expect(noted.note).toBe(NOTE)
    await expect(noted.preview?.()).resolves.toEqual({
      headers: {},
      note: `The command runs when the request is sent. ${NOTE}`,
    })
  })

  it("keeps getters and methods of the provider as they are", async () => {
    const provider = new FakeCommand()
    const noted = withAuthNote(provider, NOTE)
    expect(noted.principal).toBeUndefined()
    await expect(noted.headers()).resolves.toEqual({ Authorization: "Bearer t" })
    expect(noted.principal).toEqual({ user: "alice", source: "login" })
    await expect(noted.refresh?.()).resolves.toBe(true)
    expect(noted.rejectedHint?.(401)).toBe("bearer 401")
    expect(noted).toMatchObject({ type: "bearer" })
  })

  it("adds no method the provider lacks and keeps a preview without a note", async () => {
    const basic: AuthProvider = {
      type: "basic",
      off: "off",
      headers: () => Promise.resolve({}),
    }
    const noted = withAuthNote(basic, NOTE)
    expect("refresh" in noted).toBe(false)
    expect("rejectedHint" in noted).toBe(false)
    expect(noted.off).toBe("off")
    await expect(noted.preview?.()).resolves.toEqual({ headers: {} })
  })
})
