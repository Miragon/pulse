import { createHash } from "node:crypto"
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import path from "node:path"
import { brotliDecompressSync, gunzipSync } from "node:zlib"
import { afterEach, describe, expect, it } from "vitest"
import {
  buildWith,
  compressible,
  FIXTURE_BUILD,
  incompressible,
  INDEX_HTML,
  removeBuilds,
  STYLESHEET,
  STYLESHEET_CSS,
} from "./build.test-support.js"
import { WEB_PATHS } from "../protocol/web.js"
import { readWebBuild } from "./static.js"

afterEach(removeBuilds)

const text = (bytes: Uint8Array) => Buffer.from(bytes).toString("utf8")

const refusalOf = (dir: string): string => {
  try {
    readWebBuild(dir)
  } catch (error) {
    return (error as Error).message
  }
  throw new Error("expected the build to be refused")
}

/** A copy of the fixture whose pages.json holds `json`. */
const pagesFile = (json: string) => buildWith({ "pages.json": json }).build

describe("readWebBuild: what the boot reads of the web build", () => {
  it("reads the page, its routes and its assets, by the path a browser requests", () => {
    const build = readWebBuild(FIXTURE_BUILD)
    expect(text(build.index)).toBe(INDEX_HTML)
    expect(build.pages).toEqual(["/app", "/app/cockpit", "/app/boards/:id"])
    expect([...build.assets.keys()]).toEqual([STYLESHEET])
    const css = build.assets.get(STYLESHEET)
    expect(css?.type).toBe("text/css; charset=utf-8")
    expect(text(css?.identity.body ?? new Uint8Array())).toBe(STYLESHEET_CSS)
  })

  it("serves the assets folder alone, its subfolders too, nothing else of the build", () => {
    const { build } = buildWith({
      "favicon.svg": "<svg/>",
      ".vite/manifest.json": "{}",
      "assetsx/a.js": "",
      "assets/fonts/geist.woff2": "w",
    })
    expect([...readWebBuild(build).assets.keys()].sort()).toEqual([
      STYLESHEET,
      "/app/assets/fonts/geist.woff2",
    ])
  })

  it("names each asset's type by its extension, plain bytes for one it does not know", () => {
    const types = {
      "a.js": "text/javascript; charset=utf-8",
      "a.MJS": "text/javascript; charset=utf-8",
      "a.css": "text/css; charset=utf-8",
      "a.html": "text/html; charset=utf-8",
      "a.json": "application/json",
      "a.js.map": "application/json",
      "a.txt": "text/plain; charset=utf-8",
      "a.svg": "image/svg+xml",
      "a.png": "image/png",
      "a.jpg": "image/jpeg",
      "a.jpeg": "image/jpeg",
      "a.gif": "image/gif",
      "a.webp": "image/webp",
      "a.avif": "image/avif",
      "a.ico": "image/x-icon",
      "a.woff2": "font/woff2",
      "a.woff": "font/woff",
      "a.ttf": "font/ttf",
      "a.wasm": "application/wasm",
      a: "application/octet-stream",
      "a.xyz": "application/octet-stream",
    }
    const names = Object.keys(types)
    const { build } = buildWith(Object.fromEntries(names.map((name) => [`assets/${name}`, ""])))
    const { assets } = readWebBuild(build)
    expect(
      Object.fromEntries(names.map((name) => [name, assets.get(`/app/assets/${name}`)?.type])),
    ).toEqual(types)
  })

  it("keys an asset whose name needs escaping by the escape a browser sends", () => {
    const { build } = buildWith({ "assets/a b.js": "", "assets/grüße (1).css": "" })
    expect([...readWebBuild(build).assets.keys()].sort()).toEqual([
      "/app/assets/a%20b.js",
      STYLESHEET,
      "/app/assets/gr%C3%BC%C3%9Fe%20(1).css",
    ])
  })

  it.each(["a?b.js", "a#b.js", "a\\b.js", "%41.js", "50%.js", "%2e"])(
    "refuses an asset named %s, which no URL reaches as it is",
    (name) => {
      const { build } = buildWith({ [`assets/${name}`]: "" })
      expect(refusalOf(build)).toBe(
        `The web build in ${build} holds assets/${name}, whose name no URL reaches as it is (a ?, #, \\ or %): rename it in the build.`,
      )
    },
  )

  it("follows a link inside the build, to the file it names", () => {
    const { build } = buildWith()
    symlinkSync("app-3f9a1c.css", path.join(build, "assets", "linked.css"))
    const linked = readWebBuild(build).assets.get("/app/assets/linked.css")
    expect(text(linked?.identity.body ?? new Uint8Array())).toBe(STYLESHEET_CSS)
  })

  it("reads a build whose folder is itself a link", () => {
    const { build, folder } = buildWith()
    const link = path.join(folder, "current")
    symlinkSync(build, link)
    expect(readWebBuild(link).pages).toContain("/app")
  })
})

describe("readWebBuild: what fails the boot", () => {
  it.each([
    ["a folder that does not exist", (folder: string) => path.join(folder, "missing")],
    [
      "a file",
      (folder: string) => {
        writeFileSync(path.join(folder, "file"), "")
        return path.join(folder, "file")
      },
    ],
    [
      "an empty folder",
      (folder: string) => {
        mkdirSync(path.join(folder, "empty"))
        return path.join(folder, "empty")
      },
    ],
  ])("a web build that is %s", (_case, make) => {
    const dir = make(buildWith().folder)
    expect(refusalOf(dir)).toBe(
      `MCP_WEB_CLIENT_ID is set, but ${dir} holds no web build (no index.html and no pages.json): build the web app into it, or set MCP_WEB_DIR to the folder it was built into.`,
    )
  })

  it.each(["index.html", "pages.json"])(
    "a build without its %s, or a folder in its place",
    (name) => {
      const { build: without } = buildWith()
      rmSync(path.join(without, name))
      const { build: folder } = buildWith()
      rmSync(path.join(folder, name))
      mkdirSync(path.join(folder, name))
      for (const build of [without, folder]) {
        expect(refusalOf(build)).toBe(
          `MCP_WEB_CLIENT_ID is set, but ${build} holds no web build (no ${name}): build the web app into it, or set MCP_WEB_DIR to the folder it was built into.`,
        )
      }
    },
  )

  it("a file that links out of the build, or a folder that does", () => {
    const { build, folder } = buildWith()
    writeFileSync(path.join(folder, "secret.txt"), "not the build's")
    symlinkSync(path.join(folder, "secret.txt"), path.join(build, "assets", "app.js"))
    expect(refusalOf(build)).toBe(
      `The web build in ${build} links assets/app.js to a file outside it: copy the file into the build.`,
    )
    const { build: linked, folder: other } = buildWith()
    mkdirSync(path.join(other, "outside"))
    writeFileSync(path.join(other, "outside", "x.js"), "")
    symlinkSync(path.join(other, "outside"), path.join(linked, "assets", "more"))
    expect(refusalOf(linked)).toContain(`links assets/more to a file outside it`)
  })

  it("a link to a folder inside the build, which is no regular file", () => {
    const { build } = buildWith({ "assets/fonts/a.woff2": "" })
    symlinkSync(path.join(build, "assets", "fonts"), path.join(build, "assets", "type"))
    expect(refusalOf(build)).toBe(
      `The web build in ${build} holds assets/type, which is no regular file: the server serves files and folders, never a link to a folder or a device.`,
    )
  })
})

describe("readWebBuild: the page routes of pages.json", () => {
  it("takes /app, words and :params below it", () => {
    const build = pagesFile('{"pages":["/app","/app/a-1/b","/app/boards/:boardId/x"]}')
    expect(readWebBuild(build).pages).toEqual(["/app", "/app/a-1/b", "/app/boards/:boardId/x"])
  })

  it.each(["", "{", "pages"])("refuses a pages.json that is no JSON: %j", (json) => {
    const build = pagesFile(json)
    expect(refusalOf(build)).toBe(
      `The web build in ${build} holds a pages.json that is no JSON: build the web app again.`,
    )
  })

  it.each(["null", "[]", "{}", '{"pages":"/app"}', '{"pages":["/app",1]}'])(
    "refuses a pages.json without a list of routes: %s",
    (json) => {
      const build = pagesFile(json)
      expect(refusalOf(build)).toBe(
        `The web build in ${build} holds a pages.json without a "pages" list: build the web app again.`,
      )
    },
  )

  it.each([
    "/app/",
    "/apple",
    "app",
    "/app/Boards",
    "/app/-x",
    "/app/:id",
    "/app/boards/",
    "/app/boards/..",
    "/app/boards/*",
    "/app/boards/:Id",
    "/app/a.b",
    "/app/boards/X:id",
    "/app/boards/:id_x",
    "/app/auth",
    "/app/api/x",
    "/app/assets/:file",
    "/app/signed-out",
  ])("refuses the page %s, which is no page route or one of the server's", (page) => {
    const build = pagesFile(JSON.stringify({ pages: ["/app", page] }))
    expect(refusalOf(build)).toBe(
      `The web build in ${build} names the page "${page}" in pages.json, which is no page route: a page is /app or lies below it in lowercase words and :params, outside /app/auth, /app/api, /app/signed-out, /app/assets.`,
    )
  })

  it.each(Object.values(WEB_PATHS).filter((route) => route !== WEB_PATHS.app))(
    "refuses the server's own route %s as a page, every path of WEB_PATHS reserved",
    (route) => {
      for (const page of [route, `${route.split("/", 3).join("/")}/x`]) {
        const build = pagesFile(JSON.stringify({ pages: ["/app", page] }))
        expect(refusalOf(build), page).toContain(`names the page "${page}" in pages.json`)
      }
    },
  )

  it("refuses routes without /app, where a sign-in returns by default", () => {
    const build = pagesFile('{"pages":["/app/cockpit"]}')
    expect(refusalOf(build)).toBe(
      `The web build in ${build} names no page /app in pages.json, where a sign-in returns by default: build the web app with a page at /app.`,
    )
  })
})

describe("readWebBuild: the encodings the boot keeps of an asset", () => {
  const assetIn = (files: Record<string, string>, name: string) => {
    const asset = readWebBuild(buildWith(files).build).assets.get(`/app/assets/${name}`)
    if (asset === undefined) throw new Error(`no asset ${name}`)
    return asset
  }

  it.each(["a.js", "a.mjs", "a.css", "a.svg", "a.json", "a.html", "a.JS"])(
    "compresses the text asset %s over 1 KiB with brotli, then gzip, each to the file's bytes",
    (name) => {
      const body = compressible(1025)
      const asset = assetIn({ [`assets/${name}`]: body }, name)
      expect(asset.encoded.map(({ coding }) => coding)).toEqual(["br", "gzip"])
      const [br, gzip] = asset.encoded
      expect(text(brotliDecompressSync(br.body))).toBe(body)
      expect(text(gunzipSync(gzip.body))).toBe(body)
      expect(asset.identity).toMatchObject({ coding: "identity" })
      expect(text(asset.identity.body)).toBe(body)
    },
  )

  it.each(["a.js.map", "a.txt", "a.png", "a.woff2", "a.wasm", "a"])(
    "keeps %s as it is, which is no text asset the boot compresses",
    (name) => {
      expect(assetIn({ [`assets/${name}`]: compressible(4096) }, name).encoded).toEqual([])
    },
  )

  it("keeps an asset of 1 KiB or less as it is", () => {
    expect(assetIn({ "assets/a.js": compressible(1024) }, "a.js").encoded).toEqual([])
    expect(assetIn({ "assets/a.js": compressible(1025) }, "a.js").encoded).toHaveLength(2)
  })

  it("keeps no encoding that is larger than the file", () => {
    const { build } = buildWith()
    writeFileSync(path.join(build, "assets", "a.js"), incompressible(4096))
    expect(readWebBuild(build).assets.get("/app/assets/a.js")?.encoded).toEqual([])
  })

  it("keeps no encoding as large as the file, around the size where brotli starts to save", () => {
    const { build } = buildWith()
    const tails = Array.from({ length: 61 }, (_, tail) => tail)
    for (const tail of tails) {
      const body = Buffer.concat([incompressible(1100), Buffer.alloc(tail, "a")])
      writeFileSync(path.join(build, "assets", `a${tail}.js`), body)
    }
    const { assets } = readWebBuild(build)
    const kept = tails.map((tail) => assets.get(`/app/assets/a${tail}.js`))
    for (const asset of kept) {
      for (const { body } of asset?.encoded ?? []) {
        expect(body.byteLength).toBeLessThan(asset?.identity.body.byteLength ?? 0)
      }
    }
    expect(kept.map((asset) => asset?.encoded.length)).toContain(0)
    expect(kept.map((asset) => asset?.encoded.length)).toContain(1)
  })

  it("tags each encoding by exactly the bytes it sends, so no two share a tag", () => {
    const asset = assetIn({ "assets/a.css": compressible(2048) }, "a.css")
    const all = [asset.identity, ...asset.encoded]
    for (const { body, etag } of all) {
      expect(etag).toBe(`"${createHash("sha256").update(body).digest("base64url")}"`)
    }
    expect(new Set(all.map(({ etag }) => etag)).size).toBe(3)
  })
})
