import { describe, expect, it } from "vitest"
import {
  DEFAULT_MAX_BODY_BYTES,
  describeHttpEdgePolicy,
  edgeRejection,
  hostRejection,
  IN_FLIGHT_BODY_MULTIPLE,
  installHttpEdgeGuard,
  jsonRpcErrorBody,
  originRejection,
  resolveHttpEdgePolicy,
  type EdgeGuardContext,
  type EdgeGuardHost,
  type HttpEdgePolicy,
} from "./http-edge.js"

const LOCAL = ["localhost", "127.0.0.1", "[::1]"]

describe("resolveHttpEdgePolicy", () => {
  it("defaults to localhost-class only, a 4 MiB cap, a 16 MiB in-flight budget and an open /metrics", () => {
    expect(resolveHttpEdgePolicy({})).toEqual({
      allowedHosts: LOCAL,
      allowedOrigins: LOCAL,
      maxBodyBytes: 4 * 1024 * 1024,
      maxInFlightBodyBytes: 16 * 1024 * 1024,
    })
    expect(DEFAULT_MAX_BODY_BYTES).toBe(4194304)
    expect(IN_FLIGHT_BODY_MULTIPLE).toBe(4)
  })

  it("scales the in-flight budget with MCP_MAX_BODY_BYTES", () => {
    expect(resolveHttpEdgePolicy({ MCP_MAX_BODY_BYTES: "1000" }).maxInFlightBodyBytes).toBe(4000)
  })

  it("derives the host and the origin from MCP_URL", () => {
    const policy = resolveHttpEdgePolicy({ MCP_URL: "https://MCP.example.com:8443/base" })
    expect(policy.allowedHosts).toEqual([...LOCAL, "mcp.example.com"])
    expect(policy.allowedOrigins).toEqual([...LOCAL, "https://mcp.example.com:8443"])
  })

  it("adds the comma lists, normalized and de-duplicated", () => {
    const policy = resolveHttpEdgePolicy({
      MCP_URL: "https://mcp.example.com",
      MCP_ALLOWED_HOSTS: " Internal.svc:8400 , mcp.example.com,,https://gw.example.com/x ",
      MCP_ALLOWED_ORIGINS: "https://App.example.com/, app2.example.com",
    })
    expect(policy.allowedHosts).toEqual([
      ...LOCAL,
      "mcp.example.com",
      "internal.svc",
      "gw.example.com",
    ])
    expect(policy.allowedOrigins).toEqual([
      ...LOCAL,
      "https://mcp.example.com",
      "https://app.example.com",
      "app2.example.com",
    ])
  })

  it("treats * as an explicit opt-out of that check", () => {
    const policy = resolveHttpEdgePolicy({ MCP_ALLOWED_HOSTS: "*", MCP_ALLOWED_ORIGINS: "a.com,*" })
    expect(policy.allowedHosts).toBe("*")
    expect(policy.allowedOrigins).toBe("*")
  })

  it("reads the body cap and the metrics token", () => {
    const policy = resolveHttpEdgePolicy({
      MCP_MAX_BODY_BYTES: " 1024 ",
      MCP_METRICS_TOKEN: " s3cret ",
    })
    expect(policy.maxBodyBytes).toBe(1024)
    expect(policy.metricsToken).toBe("s3cret")
    expect(resolveHttpEdgePolicy({ MCP_METRICS_TOKEN: "  " })).not.toHaveProperty("metricsToken")
  })

  it.each([
    [{ MCP_URL: "not a url" }, /MCP_URL "not a url" is not an absolute URL/],
    [{ MCP_URL: "ftp://mcp.example.com" }, /must be an http\(s\) URL/],
    [{ MCP_MAX_BODY_BYTES: "4MB" }, /MCP_MAX_BODY_BYTES "4MB" must be a positive integer/],
    [{ MCP_MAX_BODY_BYTES: "0" }, /must be a positive integer/],
    [{ MCP_MAX_BODY_BYTES: "1.5" }, /must be a positive integer/],
    [{ MCP_ALLOWED_HOSTS: "bad host" }, /MCP_ALLOWED_HOSTS: "bad host" is not a hostname/],
    [{ MCP_ALLOWED_ORIGINS: "https://" }, /MCP_ALLOWED_ORIGINS: "https:\/\/" is not an origin/],
    [{ MCP_ALLOWED_ORIGINS: "data://x" }, /is not an origin/],
  ])("fails the boot on %j", (env, message) => {
    expect(() => resolveHttpEdgePolicy(env)).toThrow(message)
  })
})

describe("describeHttpEdgePolicy", () => {
  it("states hosts, origins, the cap and the metrics protection in one line", () => {
    expect(
      describeHttpEdgePolicy(
        resolveHttpEdgePolicy({ MCP_URL: "https://mcp.example.com", MCP_METRICS_TOKEN: "t" }),
      ),
    ).toBe(
      "HTTP edge: hosts localhost, 127.0.0.1, [::1], mcp.example.com; " +
        "origins localhost, 127.0.0.1, [::1], https://mcp.example.com; " +
        "max body 4 MiB (16 MiB in flight); /metrics token-protected",
    )
    expect(
      describeHttpEdgePolicy(
        resolveHttpEdgePolicy({
          MCP_ALLOWED_HOSTS: "*",
          MCP_ALLOWED_ORIGINS: "*",
          MCP_MAX_BODY_BYTES: "1572864",
        }),
      ),
    ).toBe(
      "HTTP edge: hosts any (validation off); origins any (validation off); " +
        "max body 1.5 MiB (6 MiB in flight); /metrics open",
    )
  })

  it("says that the cap holds on the built server only under mcp-use dev", () => {
    expect(describeHttpEdgePolicy(resolveHttpEdgePolicy({}), { underDevCli: true })).toBe(
      "HTTP edge: hosts localhost, 127.0.0.1, [::1]; origins localhost, 127.0.0.1, [::1]; " +
        "max body 4 MiB (16 MiB in flight) on the built server only; /metrics open",
    )
  })

  it.each([
    ["1048576", "max body 1 MiB (4 MiB in flight);"],
    ["1024", "max body 1 KiB (4 KiB in flight);"],
    ["2560", "max body 2.5 KiB (10 KiB in flight);"],
    ["1023", "max body 1023 bytes (4 KiB in flight);"],
    ["640", "max body 640 bytes (2.5 KiB in flight);"],
    ["255", "max body 255 bytes (1020 bytes in flight);"],
  ])("formats a %s-byte cap readably", (bytes, expected) => {
    expect(describeHttpEdgePolicy(resolveHttpEdgePolicy({ MCP_MAX_BODY_BYTES: bytes }))).toContain(
      expected,
    )
  })
})

const policy = resolveHttpEdgePolicy({
  MCP_URL: "https://mcp.example.com",
  MCP_ALLOWED_ORIGINS: "https://app.example.com,tools.example.com",
})

describe("hostRejection", () => {
  it.each([
    "localhost",
    "localhost:8400",
    "127.0.0.1:1",
    "[::1]:8400",
    "mcp.example.com",
    "MCP.EXAMPLE.COM:443",
  ])("admits %s", (host) => {
    expect(hostRejection(host, policy)).toBeUndefined()
  })

  it("rejects a foreign host (port-agnostic) and points at the remedy", () => {
    const reason = hostRejection("attacker.example:8400", policy)
    expect(reason).toContain('Host "attacker.example" is not allowed')
    expect(reason).toContain("MCP_URL")
    expect(reason).toContain("MCP_ALLOWED_HOSTS")
    // An IP that happens to reach the server is still not "ours".
    expect(hostRejection("10.0.0.7:8400", policy)).toBeDefined()
  })

  it("rejects a missing or unparsable Host", () => {
    expect(hostRejection(undefined, policy)).toBe("missing Host header")
    expect(hostRejection("", policy)).toBe("missing Host header")
    expect(hostRejection("a b", policy)).toBe('invalid Host header "a b"')
  })

  it("admits anything when Host validation is off", () => {
    expect(hostRejection("attacker.example", { ...policy, allowedHosts: "*" })).toBeUndefined()
    expect(hostRejection(undefined, { ...policy, allowedHosts: "*" })).toBeUndefined()
  })
})

describe("originRejection", () => {
  it("admits requests without an Origin (non-browser MCP clients)", () => {
    expect(originRejection(undefined, "POST", policy)).toBeUndefined()
    expect(originRejection("", "POST", policy)).toBeUndefined()
  })

  it("skips the safe methods, whatever the origin", () => {
    expect(originRejection("https://attacker.example", "GET", policy)).toBeUndefined()
    expect(originRejection("null", "HEAD", policy)).toBeUndefined()
  })

  it.each([
    "http://localhost:6274",
    "https://127.0.0.1",
    "http://[::1]:3000",
    "https://mcp.example.com",
    "https://app.example.com",
    "http://tools.example.com:9000",
  ])("admits %s", (origin) => {
    expect(originRejection(origin, "POST", policy)).toBeUndefined()
  })

  it.each([
    "https://attacker.example",
    "http://app.example.com", // exact origin: scheme counts
    "https://app.example.com:8443", // and so does the port
    "https://mcp.example.com.attacker.example",
    "null",
    "not a url",
  ])("rejects %s on a POST", (origin) => {
    const reason = originRejection(origin, "POST", policy)
    expect(reason).toContain(`Origin "${origin}" is not allowed`)
    expect(reason).toContain("MCP_ALLOWED_ORIGINS")
  })

  it("admits anything when Origin validation is off", () => {
    expect(
      originRejection("https://attacker.example", "POST", { ...policy, allowedOrigins: "*" }),
    ).toBeUndefined()
  })
})

describe("edgeRejection", () => {
  const request = (overrides: Partial<Parameters<typeof edgeRejection>[0]> = {}) => ({
    method: "POST",
    path: "/mcp",
    host: "mcp.example.com",
    origin: undefined,
    ...overrides,
  })

  it("passes a request whose Host and Origin are allowed", () => {
    expect(edgeRejection(request({ origin: "https://app.example.com" }), policy)).toBeUndefined()
  })

  it("reports the Host before the Origin", () => {
    const reason = edgeRejection(
      request({ host: "attacker.example", origin: "https://attacker.example" }),
      policy,
    )
    expect(reason).toMatch(/^Host "attacker\.example" is not allowed/)
  })

  it("reports a foreign Origin when the Host passes", () => {
    const reason = edgeRejection(request({ origin: "https://attacker.example" }), policy)
    expect(reason).toMatch(/^Origin "https:\/\/attacker\.example" is not allowed/)
  })

  it("passes the exempt path prefixes whatever their headers", () => {
    const foreign = { host: "10.0.0.7", origin: "https://attacker.example" }
    expect(edgeRejection(request({ path: "/metrics", ...foreign }), policy, ["/metrics"])).toBe(
      undefined,
    )
    expect(
      edgeRejection(request({ path: "/metrics2", ...foreign }), policy, ["/metrics"]),
    ).toBeDefined()
  })
})

describe("jsonRpcErrorBody", () => {
  it("is a JSON-RPC error with a null id", () => {
    expect(JSON.parse(jsonRpcErrorBody("nope"))).toEqual({
      jsonrpc: "2.0",
      error: { code: -32000, message: "nope" },
      id: null,
    })
  })
})

describe("installHttpEdgeGuard", () => {
  type Middleware = Parameters<EdgeGuardHost["use"]>[1]

  function install(edge: HttpEdgePolicy, exemptPaths?: readonly string[]) {
    let middleware: Middleware | undefined
    const host: EdgeGuardHost = {
      use: (path, handler) => {
        expect(path).toBe("*")
        middleware = handler
      },
    }
    installHttpEdgeGuard(host, edge, exemptPaths ? { exemptPaths } : undefined)
    return async (method: string, path: string, headers: Record<string, string>) => {
      const ctx: EdgeGuardContext = {
        req: { method, path, header: (name) => headers[name] },
      }
      let passed = false
      const response = await middleware!(ctx, () => {
        passed = true
        return Promise.resolve()
      })
      return { passed, response: response ?? undefined }
    }
  }

  it("passes allowed requests through", async () => {
    const run = install(policy)
    const result = await run("POST", "/mcp", {
      host: "mcp.example.com",
      origin: "https://app.example.com",
    })
    expect(result).toEqual({ passed: true, response: undefined })
  })

  it("answers 403 with a JSON-RPC body for a foreign Host, before the route runs", async () => {
    const run = install(policy)
    const { passed, response } = await run("POST", "/mcp", { host: "attacker.example" })
    expect(passed).toBe(false)
    expect(response?.status).toBe(403)
    expect(response?.headers.get("content-type")).toBe("application/json")
    const body = (await response!.json()) as { error: { message: string } }
    expect(body.error.message).toMatch(/^Forbidden: Host "attacker\.example" is not allowed/)
  })

  it("answers 403 for a foreign Origin even when the Host is fine", async () => {
    const run = install(policy)
    const { passed, response } = await run("POST", "/mcp", {
      host: "localhost:8400",
      origin: "https://attacker.example",
    })
    expect(passed).toBe(false)
    expect(response?.status).toBe(403)
  })

  it("exempts the listed path prefixes (probes reach the container by IP)", async () => {
    const run = install(policy, ["/health"])
    for (const path of ["/health", "/health/ready"]) {
      expect((await run("GET", path, { host: "10.0.0.7:8400" })).passed, path).toBe(true)
    }
    expect((await run("GET", "/healthz", { host: "10.0.0.7:8400" })).passed).toBe(false)
    expect((await run("GET", "/mcp", { host: "10.0.0.7:8400" })).passed).toBe(false)
  })

  it("guards every path when nothing is exempt", async () => {
    const run = install(policy)
    expect((await run("GET", "/health", { host: "10.0.0.7" })).passed).toBe(false)
  })
})
