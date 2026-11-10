import { describe, expect, it, vi } from "vitest"
import * as transport from "@miragon/pulse-http"
import { createEngineConnection } from "./engine-connection.js"

vi.mock("@miragon/pulse-http", async (importOriginal) => {
  const actual = await importOriginal<typeof transport>()
  return { ...actual, createHttp: vi.fn(actual.createHttp) }
})

/**
 * The module's transport keeps no trace and never reveals a secret: only the CLI's
 * --show-secrets does (owner decision 2026-11-10). scripts/trace-secrets.test.mjs keeps the
 * option's name out of the server's sources; this holds what the connection hands the transport,
 * however its platform is built.
 */
describe("the platform of an engine connection", () => {
  it("is the fetch and the clock only: no trace, no revealed secret", () => {
    const auth = { type: "basic", username: "demo", password: "demo-secret" } as const
    createEngineConnection({ id: "prod-a", baseUrl: "http://engine.test/engine-rest" }, auth)
    const platforms = vi.mocked(transport.createHttp).mock.calls.map(([, platform]) => platform)
    expect(platforms.map((platform) => Object.keys(platform).sort())).toEqual([["fetch", "now"]])
  })
})
