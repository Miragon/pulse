import { describe, expect, it } from "vitest"
import { runWithMcpRequestInfo } from "@miragon/pulse-widget-shell/server"
import { CREDENTIALS, credentialFor, unauthorizedHint } from "./credentials.js"

/** The Authorization header a credential sends, or undefined for none. */
async function header(engineId: string, auth: Parameters<typeof credentialFor>[1]) {
  return (await credentialFor(engineId, auth).authorization())?.header
}

describe("the credential of each auth type", () => {
  it("sends Basic as UTF-8, a bearer token trimmed, nothing for none or an incomplete one", async () => {
    const basic = await header("a", { type: "basic", username: "demo", password: "pässw€rd" })
    expect(basic).toBe(`Basic ${Buffer.from("demo:pässw€rd", "utf8").toString("base64")}`)
    expect(await header("a", { type: "bearer", token: " tok-1\n" })).toBe("Bearer tok-1")
    expect(await header("a", { type: "none" })).toBeUndefined()
    expect(await header("a", { type: "basic", username: "demo" })).toBeUndefined()
    expect(await header("a", { type: "bearer" })).toBeUndefined()
  })

  it("passes the MCP caller's token through, read per request, never renewed", async () => {
    const credential = CREDENTIALS.passthrough({ type: "passthrough" })
    expect(credential.renewable).toBe(false)
    expect(await credential.authorization()).toBeUndefined()
    const sent = await runWithMcpRequestInfo({ authorization: "Bearer tok-caller" }, () =>
      credential.authorization(),
    )
    expect(sent?.header).toBe("Bearer tok-caller")
  })

  it("fails the boot on one it cannot send, naming the engine and the setting, never the value", () => {
    const cases = [
      [{ type: "bearer", token: "tok-demo-123\nsecond-line" }, /ENGINE_TOKEN/],
      [{ type: "basic", username: "de:mo", password: "secret-1" }, /colon.*ENGINE_USERNAME/],
      [{ type: "basic", username: "demo", password: "secret-1\n" }, /control character/],
    ] as const
    for (const [auth, says] of cases) {
      const boot = () => credentialFor("prod-a", auth)
      expect(boot).toThrow(/^Engine "prod-a" cannot send its credentials: /)
      expect(boot).toThrow(says)
      expect(boot).toThrow(/the value is not shown\.$/)
      let message = ""
      try {
        boot()
      } catch (error) {
        message = (error as Error).message
      }
      expect(message).not.toMatch(/second-line|de:mo|secret-1/)
    }
  })
})

describe("the remedy a 401 names", () => {
  it("depends on where the credential came from", () => {
    expect(unauthorizedHint("none")()).toBe(
      "The engine requires authentication, but none is configured.",
    )
    expect(unauthorizedHint("basic")()).toBe("The engine rejected the configured credentials.")
    expect(unauthorizedHint("bearer")()).toBe("The engine rejected the configured credentials.")
    const passthrough = unauthorizedHint("passthrough")
    expect(passthrough()).toBe("The MCP request carried no bearer token to pass through.")
    expect(runWithMcpRequestInfo({ authorization: "Bearer t" }, passthrough)).toBe(
      "The engine rejected the forwarded bearer token.",
    )
  })
})
