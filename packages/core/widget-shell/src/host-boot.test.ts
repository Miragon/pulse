import { describe, expect, it } from "vitest"
import {
  requestLogLevelWarning,
  resolvePort,
  swallowDevCliViewsPrime,
  toolCallOutcome,
  toolNameOf,
} from "./host-boot.js"

describe("resolvePort", () => {
  it("falls back to the default when PORT is unset", () => {
    expect(resolvePort({ env: {} })).toBe(8400)
  })

  it("falls back on an empty or whitespace-only assignment (env_file `PORT=`)", () => {
    expect(resolvePort({ env: { PORT: "" } })).toBe(8400)
    expect(resolvePort({ env: { PORT: "   " } })).toBe(8400)
  })

  it("parses an explicit port and honors a custom fallback", () => {
    expect(resolvePort({ env: { PORT: "9000" } })).toBe(9000)
    expect(resolvePort({ env: {}, fallback: 1234 })).toBe(1234)
  })

  it.each(["abc", "0", "65536", "-1", "80.5"])("rejects %j", (value) => {
    expect(() => resolvePort({ env: { PORT: value } })).toThrow(
      `invalid PORT "${value}": expected an integer 1-65535`,
    )
  })

  it("prefixes the host label onto the error", () => {
    expect(() => resolvePort({ env: { PORT: "abc" }, label: "test-app" })).toThrow(
      `[test-app] invalid PORT "abc": expected an integer 1-65535`,
    )
  })
})

describe("swallowDevCliViewsPrime", () => {
  it("does nothing outside the dev CLI", () => {
    const server = {}
    swallowDevCliViewsPrime(server, {})
    expect("__primeViews" in server).toBe(false)
  })

  it("replaces __primeViews with a no-op under the dev CLI", () => {
    const server: { __primeViews?: () => void } = {
      __primeViews: () => {
        throw new Error("double prime")
      },
    }
    swallowDevCliViewsPrime(server, { MCP_USE_DEV_CLI: "1" })
    expect(() => server.__primeViews?.()).not.toThrow()
  })
})

describe("requestLogLevelWarning", () => {
  it("stays silent at mcp-use's default level or when unset", () => {
    expect(requestLogLevelWarning({})).toBeUndefined()
    expect(requestLogLevelWarning({ MCP_USE_LOG_LEVEL: "info" })).toBeUndefined()
  })

  it("warns that debug logs tool inputs and outputs", () => {
    expect(requestLogLevelWarning({ MCP_USE_LOG_LEVEL: " DEBUG " })).toMatch(
      /^MCP_USE_LOG_LEVEL=debug: mcp-use logs tool inputs and outputs/,
    )
  })

  it("warns that trace logs full requests, bearer tokens included", () => {
    expect(requestLogLevelWarning({ MCP_USE_LOG_LEVEL: "trace" })).toContain("bearer tokens")
  })
})

describe("toolCallOutcome / toolNameOf", () => {
  it("reads an isError result as error and a missing tool name as unknown", () => {
    expect(toolCallOutcome({ isError: true })).toBe("error")
    expect(toolCallOutcome({ content: [] })).toBe("ok")
    expect(toolCallOutcome(undefined)).toBe("ok")
    expect(toolNameOf({ params: { name: "notes_list_notes" } })).toBe("notes_list_notes")
    expect(toolNameOf({})).toBe("unknown")
  })
})
