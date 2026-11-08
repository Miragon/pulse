import { describe, expect, it } from "vitest"
import { viewDocument, viewResourceConfig, viewResultMeta } from "./view-resource.js"

const request = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers })

describe("viewResourceConfig: the origin a view's CSP and fonts name", () => {
  const config = (env: NodeJS.ProcessEnv = {}) =>
    viewResourceConfig("demo_show_x", { description: "Demo" }, env)

  it("takes MCP_URL's origin over the request's", () => {
    const { readMeta, publicBase } = config({ MCP_URL: "https://mcp.example.com/" })
    const forwarded = request("http://10.0.0.7:8400/mcp", { "x-forwarded-host": "other.example" })
    expect(publicBase(forwarded)).toBe("https://mcp.example.com/")
    expect(readMeta(forwarded)).toMatchObject({
      ui: { csp: { connectDomains: ["https://mcp.example.com"] } },
    })
  })

  it("reads the first Forwarded entry that names proto and host, quotes stripped", () => {
    const { publicBase } = config()
    const forwarded = request("http://10.0.0.7:8400/mcp", {
      forwarded: 'for=1.2.3.4, for=5.6.7.8;proto=https;host="mcp.example.com", proto=http;host=x',
    })
    expect(publicBase(forwarded)).toBe("https://mcp.example.com/")
  })

  it("falls back to X-Forwarded-Proto and -Host (their first values), then the request URL", () => {
    const { publicBase } = config()
    const xForwarded = request("http://10.0.0.7:8400/mcp", {
      forwarded: "for=1.2.3.4",
      "x-forwarded-proto": "https, http",
      "x-forwarded-host": "mcp.example.com, proxy.internal",
    })
    expect(publicBase(xForwarded)).toBe("https://mcp.example.com/")
    const halfForwarded = request("http://10.0.0.7:8400/mcp", { "x-forwarded-host": "a.example" })
    expect(publicBase(halfForwarded)).toBe("http://10.0.0.7:8400/")
  })

  it("names no origin without MCP_URL or a request", () => {
    const { readMeta, publicBase } = config()
    expect(publicBase(undefined)).toBe("")
    expect(readMeta(undefined)).toEqual({
      ui: {
        csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] },
        prefersBorder: true,
      },
      "openai/widgetDescription": "Demo",
      "openai/ui": { availableDisplayModes: ["inline", "fullscreen"] },
    })
  })

  it("keeps what the binding tool declares and adds the origin once", () => {
    const { readMeta, config: resource } = viewResourceConfig(
      "demo_show_x",
      {
        csp: {
          connectDomains: ["https://api.example", "http://localhost"],
          resourceDomains: ["https://cdn.example"],
          frameDomains: ["https://embed.example"],
        },
      },
      {},
    )
    expect(readMeta(request("http://localhost/mcp"))).toEqual({
      ui: {
        csp: {
          connectDomains: ["https://api.example", "http://localhost"],
          resourceDomains: ["https://cdn.example", "http://localhost"],
          frameDomains: ["https://embed.example"],
          baseUriDomains: [],
        },
        prefersBorder: true,
      },
      "openai/ui": { availableDisplayModes: ["inline", "fullscreen"] },
    })
    // Without the binding tool's title the resource carries no description at all.
    expect(resource).toEqual({ mimeType: "text/html;profile=mcp-app" })
  })
})

describe("the view document and a view tool's result", () => {
  it("inlines the bundle, its config and its style without letting either close its tag", () => {
    const html = viewDocument(
      {
        kind: "inline",
        js: 'x("</script><script>alert(1)</script>"); <!-- y',
        css: "a{}</style><b>",
      },
      "https://mcp.example.com/</script>",
    )
    expect(html).toContain(
      'globalThis.__pulseViewConfig={"publicBase":"https://mcp.example.com/\\u003c/script>"};',
    )
    expect(html).toContain('x("<\\/script><script>alert(1)<\\/script>"); \\x3C!-- y')
    expect(html).toContain("<style>a{}<\\/style><b></style>")
    expect(html.match(/<\/script>/g)).toHaveLength(2)
  })

  it("writes no style tag for a bundle without CSS", () => {
    const html = viewDocument({ kind: "inline", js: "", css: "" }, "")
    expect(html.match(/<style>/g)).toHaveLength(1)
  })

  // Every view read serves the whole bundle: it is escaped once, then only publicBase changes.
  it("escapes a bundle once, not on every read", () => {
    let reads = 0
    const bundle = {
      kind: "inline" as const,
      get js() {
        reads += 1
        return 'x("</script>")'
      },
      css: "a{}",
    }
    const first = viewDocument(bundle, "https://a.example/")
    const second = viewDocument(bundle, "https://b.example/")
    expect(reads).toBe(1)
    expect(first).toContain('x("<\\/script>")')
    expect(second).toContain('{"publicBase":"https://b.example/"}')
    expect(second.replace("b.example", "a.example")).toBe(first)
  })

  it("stamps the view's resource in both spellings on a result", () => {
    expect(viewResultMeta("ui://views/demo_show_x.html")).toEqual({
      ui: { resourceUri: "ui://views/demo_show_x.html" },
      "ui/resourceUri": "ui://views/demo_show_x.html",
    })
  })
})
