import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { viewBundleWatchPlugin } from "./view-bundle-watch.js"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "view-bundle-watch-"))
  writeFileSync(path.join(dir, "mcp-app.js"), "console.log(1)")
  writeFileSync(path.join(dir, "mcp-app.css"), "a{}")
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** What Vite would write after the plugin ran, in watch mode or a plain build. */
function written(watchMode: boolean, js: string, css: string | Uint8Array) {
  const bundle = {
    "mcp-app.js": { type: "chunk" as const, code: js },
    "mcp-app.css": { type: "asset" as const, source: css },
    "new.js": { type: "chunk" as const, code: "x" },
  }
  viewBundleWatchPlugin().generateBundle.call({ meta: { watchMode } }, { dir }, bundle)
  return Object.keys(bundle).sort()
}

// `pnpm dev` builds once, then the watcher's first build would rewrite the same bytes and
// `tsx watch` would restart the server right after its boot.
describe("viewBundleWatchPlugin", () => {
  it("leaves an output unwritten in watch mode when its bytes equal the file on disk", () => {
    expect(written(true, "console.log(1)", new TextEncoder().encode("a{}"))).toEqual(["new.js"])
  })

  it("writes what changed and what is not on disk yet", () => {
    expect(written(true, "console.log(2)", "a{}")).toEqual(["mcp-app.js", "new.js"])
  })

  it("writes everything in a plain build, or without an output directory", () => {
    expect(written(false, "console.log(1)", "a{}")).toEqual(["mcp-app.css", "mcp-app.js", "new.js"])
    const bundle = { "mcp-app.js": { type: "chunk" as const, code: "console.log(1)" } }
    viewBundleWatchPlugin().generateBundle.call({ meta: { watchMode: true } }, {}, bundle)
    expect(Object.keys(bundle)).toEqual(["mcp-app.js"])
    expect(readFileSync(path.join(dir, "mcp-app.js"), "utf8")).toBe("console.log(1)")
  })

  it("runs on builds only, after the stylesheet is emitted", () => {
    expect(viewBundleWatchPlugin()).toMatchObject({ apply: "build", enforce: "post" })
  })
})
