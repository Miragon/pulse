import { afterEach, describe, expect, it, vi } from "vitest"
import {
  FONT_CACHE_CONTROL,
  fontAssetsCsp,
  fontResponse,
  installFontAssets,
  loadServedFonts,
  servedFontPaths,
  type FontAsset,
} from "./font-assets.js"
import type { HttpRouteHost } from "./health.js"
import { SERVED_FONT_FILES } from "./protocol/served-fonts.js"

/** A woff2 file starts with the signature `wOF2`. */
const WOFF2_SIGNATURE = [0x77, 0x4f, 0x46, 0x32]

/** Records `server.get(path, handler)` like the health suite's fake host. */
function fakeHost() {
  const routes = new Map<string, (ctx: unknown) => Response | Promise<Response>>()
  const host: HttpRouteHost = {
    get: (path, handler) => {
      routes.set(path, handler)
    },
  }
  return { host, routes }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("loadServedFonts", () => {
  it("reads Geist and Geist Mono (latin, variable) from the fontsource packages", () => {
    const fonts = loadServedFonts()
    expect(fonts.map((font) => font.file)).toEqual([
      "geist-latin-wght-normal.woff2",
      "geist-mono-latin-wght-normal.woff2",
    ])
    for (const { file, body } of fonts) {
      expect([...body.subarray(0, 4)], file).toEqual(WOFF2_SIGNATURE)
      // Latin subsets, not the full families: tens of KB, not hundreds.
      expect(body.byteLength, file).toBeGreaterThan(10_000)
      expect(body.byteLength, file).toBeLessThan(60_000)
    }
  })

  it("finds each served file in its fontsource package under the name the views load", () => {
    const paths = servedFontPaths()
    expect(Object.keys(paths)).toEqual(Object.values(SERVED_FONT_FILES))
    expect(paths[SERVED_FONT_FILES.sans]).toMatch(
      /@fontsource-variable\/geist\/files\/geist-latin-wght-normal\.woff2$/,
    )
    expect(paths[SERVED_FONT_FILES.mono]).toMatch(
      /@fontsource-variable\/geist-mono\/files\/geist-mono-latin-wght-normal\.woff2$/,
    )
  })

  it("reads the files it is pointed at and fails loudly on a missing one", () => {
    expect(() => loadServedFonts(() => ({ "x.woff2": "/nonexistent/x.woff2" }))).toThrow(/ENOENT/)
  })
})

describe("fontResponse", () => {
  it("answers woff2, cached immutable for a year, readable from any origin", async () => {
    const body = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 1, 2])
    const res = fontResponse(body)
    expect(res.status).toBe(200)
    expect(Object.fromEntries(res.headers)).toEqual({
      "content-type": "font/woff2",
      "content-length": "6",
      "cache-control": "public, max-age=31536000, immutable",
      "access-control-allow-origin": "*",
      "cross-origin-resource-policy": "cross-origin",
      "x-content-type-options": "nosniff",
    })
    expect(FONT_CACHE_CONTROL).toBe("public, max-age=31536000, immutable")
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(body)
  })
})

describe("installFontAssets", () => {
  it("registers one GET route per file under the versioned font path", async () => {
    const { host, routes } = fakeHost()
    const installed = installFontAssets(host)
    expect(installed).toEqual([
      "/fonts/geist-5.3.0/geist-latin-wght-normal.woff2",
      "/fonts/geist-5.3.0/geist-mono-latin-wght-normal.woff2",
    ])
    expect([...routes.keys()]).toEqual(installed)
    // A fresh Response per request: a body can be read only once.
    const handler = routes.get(installed[0])!
    const first = await handler({})
    const second = await handler({})
    expect(first).not.toBe(second)
    expect((await first.arrayBuffer()).byteLength).toBe((await second.arrayBuffer()).byteLength)
  })

  it("serves what the loader returns under the path it is given", async () => {
    const { host, routes } = fakeHost()
    const fonts: FontAsset[] = [{ file: "x.woff2", body: new Uint8Array([1, 2, 3]) }]
    expect(installFontAssets(host, { path: "/assets", load: () => fonts })).toEqual([
      "/assets/x.woff2",
    ])
    const res = await routes.get("/assets/x.woff2")!({})
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
  })

  it("boots on without the route when the files cannot be read — the views use the host's font", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { host, routes } = fakeHost()
    const failure = new Error("ENOENT")
    const installed = installFontAssets(host, {
      label: "edge",
      load: () => {
        throw failure
      },
    })
    expect(installed).toEqual([])
    expect(routes.size).toBe(0)
    expect(warn).toHaveBeenCalledWith(
      "[edge] Geist is not served (views use the host's font):",
      failure,
    )
  })

  it("labels its warning `fonts` by default", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    installFontAssets(fakeHost().host, {
      load: () => {
        throw new Error("x")
      },
    })
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[fonts\] /), expect.any(Error))
  })
})

describe("fontAssetsCsp", () => {
  it("admits MCP_URL's origin in resourceDomains — the origin the views load fonts from", () => {
    expect(fontAssetsCsp({ MCP_URL: "https://mcp.example.com/mcp" })).toEqual({
      resourceDomains: ["https://mcp.example.com"],
    })
    expect(fontAssetsCsp({ MCP_URL: "  http://10.0.0.7:8400/  " })).toEqual({
      resourceDomains: ["http://10.0.0.7:8400"],
    })
  })

  it("declares nothing without MCP_URL: mcp-use appends the request-resolved origin itself", () => {
    expect(fontAssetsCsp({})).toBeUndefined()
    expect(fontAssetsCsp({ MCP_URL: "  " })).toBeUndefined()
  })
})
