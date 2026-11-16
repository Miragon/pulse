import { createHash } from "node:crypto"
import { writeFileSync } from "node:fs"
import path from "node:path"
import { brotliDecompressSync, gunzipSync } from "node:zlib"
import { afterEach, describe, expect, it } from "vitest"
import { McpHttpApp } from "../mcp-server.js"
import { createModuleRegistry } from "../tool-registration.js"
import {
  buildWith,
  compressible,
  removeBuilds,
  STYLESHEET,
  STYLESHEET_CSS,
} from "./build.test-support.js"
import type { WebContext } from "./context.js"
import { installWebBuild, readWebBuild } from "./static.js"

/**
 * How an asset answers: in the encoding the request's `Accept-Encoding` takes first of br and gzip,
 * else as the file is, tagged by the bytes it sends, whole whatever `Range` asks, and 304 where the
 * request's `If-None-Match` names the tag of what it would get.
 */

afterEach(removeBuilds)

const SCRIPT = compressible(4096)
const SCRIPT_PATH = "/app/assets/app.js"
const IMAGE_PATH = "/app/assets/logo.png"
const IMMUTABLE = "public, max-age=31536000, immutable"

const etagOf = (bytes: Uint8Array) => `"${createHash("sha256").update(bytes).digest("base64url")}"`

/** The web build's routes on an app of their own; an asset's answer reads no session. */
function assetApp(): McpHttpApp {
  const { build } = buildWith({ "assets/app.js": SCRIPT })
  writeFileSync(path.join(build, "assets", "logo.png"), compressible(4096))
  const registrations = createModuleRegistry(undefined, "static-test")
  const app = new McpHttpApp({ name: "static-test", version: "0.0.0", registrations, log: false })
  installWebBuild(app, readWebBuild(build), {} as WebContext)
  return app
}

const get = (
  app: McpHttpApp,
  target: string,
  headers: Record<string, string> = {},
  method = "GET",
) => app.fetch(new Request(`http://localhost${target}`, { method, headers }))

/** The bytes an answer sent, decoded by its `Content-Encoding`, as text. */
async function decoded(response: Response): Promise<string> {
  const bytes = Buffer.from(await response.arrayBuffer())
  const coding = response.headers.get("content-encoding")
  if (coding === "br") return brotliDecompressSync(bytes).toString("utf8")
  if (coding === "gzip") return gunzipSync(bytes).toString("utf8")
  return bytes.toString("utf8")
}

describe("an asset's encoding, by the request's Accept-Encoding", () => {
  it.each([
    ["gzip, deflate, br, zstd", "br"],
    ["br", "br"],
    ["BR", "br"],
    ["gzip", "gzip"],
    [" gzip ; q=0.5 ", "gzip"],
    ["br;q=0, gzip", "gzip"],
    ["br; q=0.000, gzip", "gzip"],
    ["br;level=11", "br"],
    ["*", "br"],
    ["*, br;q=0", "gzip"],
    ["*;q=0, gzip", "gzip"],
    ["br;q=0, gzip;q=0", null],
    ["*;q=0", null],
    ["identity", null],
    ["deflate, zstd", null],
    ["", null],
  ])("answers %j in %s", async (acceptEncoding, coding) => {
    const response = await get(assetApp(), SCRIPT_PATH, { "accept-encoding": acceptEncoding })
    expect(response.status).toBe(200)
    expect(response.headers.get("content-encoding")).toBe(coding)
    expect(await decoded(response)).toBe(SCRIPT)
  })

  it("answers as the file is without the header", async () => {
    const response = await get(assetApp(), SCRIPT_PATH)
    expect(response.headers.get("content-encoding")).toBeNull()
    expect(await response.text()).toBe(SCRIPT)
  })

  it("answers an asset it keeps no encoding of as it is, whatever the request takes", async () => {
    const app = assetApp()
    for (const target of [STYLESHEET, IMAGE_PATH]) {
      const response = await get(app, target, { "accept-encoding": "br, gzip" })
      expect(response.headers.get("content-encoding"), target).toBeNull()
    }
    expect(await (await get(app, STYLESHEET, { "accept-encoding": "br" })).text()).toBe(
      STYLESHEET_CSS,
    )
  })
})

describe("an asset's answer", () => {
  it("names its length, its tag and its encoding by the bytes it sends, and varies by Accept-Encoding", async () => {
    const app = assetApp()
    const etags = []
    for (const acceptEncoding of ["br", "gzip", "identity"]) {
      const response = await get(app, SCRIPT_PATH, { "accept-encoding": acceptEncoding })
      const bytes = new Uint8Array(await response.arrayBuffer())
      expect(response.headers.get("content-length")).toBe(String(bytes.byteLength))
      expect(response.headers.get("etag")).toBe(etagOf(bytes))
      expect(response.headers.get("vary")).toBe("Accept-Encoding")
      expect(response.headers.get("content-type")).toBe("text/javascript; charset=utf-8")
      expect(response.headers.get("cache-control")).toBe(IMMUTABLE)
      expect(response.headers.get("accept-ranges")).toBe("none")
      etags.push(response.headers.get("etag"))
    }
    expect(new Set(etags).size).toBe(3)
    const image = await get(app, IMAGE_PATH, { "accept-encoding": "br" })
    expect(image.headers.get("vary")).toBe("Accept-Encoding")
  })

  it("answers HEAD with GET's headers and no body", async () => {
    const app = assetApp()
    for (const acceptEncoding of ["br", "gzip", ""]) {
      const headers = { "accept-encoding": acceptEncoding }
      const got = await get(app, SCRIPT_PATH, headers)
      const head = await get(app, SCRIPT_PATH, headers, "HEAD")
      expect([...head.headers], acceptEncoding).toEqual([...got.headers])
      expect(await head.text()).toBe("")
    }
  })

  it("ignores a Range and answers whole, in the encoding the request takes", async () => {
    const headers = { "accept-encoding": "br", range: "bytes=0-9" }
    const response = await get(assetApp(), SCRIPT_PATH, headers)
    expect(response.status).toBe(200)
    expect(response.headers.get("content-range")).toBeNull()
    expect(await decoded(response)).toBe(SCRIPT)
  })
})

describe("an asset the request's cache holds", () => {
  const tagOf = async (app: McpHttpApp, acceptEncoding: string) =>
    String((await get(app, SCRIPT_PATH, { "accept-encoding": acceptEncoding })).headers.get("etag"))

  it("answers 304 where If-None-Match names the tag of what it would send, weak or in a list", async () => {
    const app = assetApp()
    const br = await tagOf(app, "br")
    for (const ifNoneMatch of [br, `W/${br}`, `"other", ${br}`, "*"]) {
      for (const method of ["GET", "HEAD"]) {
        const headers = { "accept-encoding": "br", "if-none-match": ifNoneMatch }
        const response = await get(app, SCRIPT_PATH, headers, method)
        expect(response.status, `${method} ${ifNoneMatch}`).toBe(304)
        expect(Object.fromEntries(response.headers)).toEqual({
          etag: br,
          vary: "Accept-Encoding",
          "cache-control": IMMUTABLE,
        })
        expect(await response.text()).toBe("")
      }
    }
  })

  it("answers whole where it names another tag, an encoding the request no longer takes too", async () => {
    const app = assetApp()
    const br = await tagOf(app, "br")
    const gzip = await tagOf(app, "gzip")
    for (const ifNoneMatch of [`"other"`, br.slice(1, -1), `W/"x", "y"`]) {
      const headers = { "accept-encoding": "br", "if-none-match": ifNoneMatch }
      expect((await get(app, SCRIPT_PATH, headers)).status, ifNoneMatch).toBe(200)
    }
    const response = await get(app, SCRIPT_PATH, { "accept-encoding": "gzip", "if-none-match": br })
    expect([response.status, response.headers.get("etag")]).toEqual([200, gzip])
  })
})
