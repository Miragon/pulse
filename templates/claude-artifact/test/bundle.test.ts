import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { Script } from "node:vm"
import { describe, expect, it } from "vitest"
import { PROCESS_KEY } from "../src/page.config.ts"
import { STYLESHEET } from "../vite.config.ts"

/**
 * What `pnpm build` writes, the three files a Claude artifact publishes (`pnpm test` builds
 * first): the page content without a document around it, one classic script, and pulse-ui's
 * stylesheet as it ships (what it holds is pulse-ui's to test). The script holds the page, its kit
 * and widget-shell's page reads with React Query under them, never the MCP client, ext-apps'
 * runtime, the fixtures or their replay.
 */

const DIST = join(import.meta.dirname, "../dist")
/** The recording of the page's own process, whatever it is. */
const FIXTURE = join(import.meta.dirname, `../fixtures/${PROCESS_KEY}.json`)

/**
 * Strings a bundled MCP client or ext-apps runtime holds after minification (protocol methods, a
 * header, a MIME type), where a package's name survives only in comments and import specifiers,
 * which bundling strips: the MCP client's session header and JSON-RPC envelope, ext-apps' handshake
 * and its view resource type.
 */
const MCP_RUNTIME_LITERALS = [
  "ui/initialize",
  "text/html;profile=mcp-app",
  "mcp-session-id",
  "notifications/initialized",
  "jsonrpc",
]
const read = (name: string) => readFileSync(join(DIST, name), "utf8")
const kb = (name: string) => Math.round(statSync(join(DIST, name)).size / 1024)

describe("dist/", () => {
  it("holds exactly index.html, app.js and pulse-ui.css", () => {
    // Any other entry (a split chunk, a hashed name, a source map, a folder of assets) is a file
    // the page loads but nobody publishes, or one published for nothing.
    expect(readdirSync(DIST).sort()).toEqual(["app.js", "index.html", "pulse-ui.css"])
    console.info(
      `dist/: index.html ${String(kb("index.html"))} KB, app.js ${String(kb("app.js"))} KB, pulse-ui.css ${String(kb("pulse-ui.css"))} KB`,
    )
  })

  it("index.html is the page content: its title first, no document around it", () => {
    const html = read("index.html")
    expect(html.trimStart().startsWith("<title>")).toBe(true)
    expect(html).not.toMatch(/<(?:!doctype|html|head|body)\b/i)
    expect(html).toContain('<link rel="stylesheet" href="pulse-ui.css" />')
    expect(html).toContain('<div id="root"></div>')
    // A classic script after the root: it runs as it is parsed, so the root is there.
    expect(html).toContain('<script src="app.js"></script>')
    expect(html).not.toContain('type="module"')
    expect(html.indexOf('<script src="app.js">')).toBeGreaterThan(html.indexOf('id="root"'))
    // No script of its own before the root: pulse-ui's theme follows data-theme, else the OS.
    expect(html.match(/<script/g)).toHaveLength(1)
  })

  it("index.html loads nothing from a host the artifact's CSP refuses: fonts from Google Fonts only", () => {
    const hosts = [...read("index.html").matchAll(/https?:\/\/([^/"'\s]+)/g)].map((m) => m[1])
    expect(new Set(hosts)).toEqual(new Set(["fonts.googleapis.com", "fonts.gstatic.com"]))
  })

  it("app.js is one classic script: no import, no export, no import.meta", () => {
    // `vm.Script` compiles a classic script, which refuses a module's syntax.
    expect(() => new Script(read("app.js"), { filename: "app.js" })).not.toThrow()
  })

  it("a module's syntax fails that compile, so the check above can fail", () => {
    for (const module of ['import a from "a"', "export const a = 1", "const a = import.meta.url"]) {
      expect(() => new Script(module), module).toThrow(SyntaxError)
    }
  })

  it("app.js holds no MCP client, no ext-apps runtime, no fixtures and no replay of them", () => {
    const js = read("app.js")
    for (const literal of MCP_RUNTIME_LITERALS) expect(js, literal).not.toContain(literal)
    expect(js).not.toContain("@modelcontextprotocol")
    expect(js).not.toContain("No recorded answer")
    expect(js).not.toContain("The recording fails")
    const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as { asOf: string }
    expect(js).not.toContain(fixture.asOf)
  })

  it("the MCP client's own build holds its literals, so the check above can fail", () => {
    const dist = join(import.meta.dirname, "../node_modules/@modelcontextprotocol/client/dist")
    const client = readdirSync(dist)
      .filter((name) => name.endsWith(".mjs"))
      .map((name) => readFileSync(join(dist, name), "utf8"))
      .join("\n")
    for (const literal of ["mcp-session-id", "notifications/initialized", "jsonrpc"]) {
      expect(client, literal).toContain(literal)
    }
  })

  it("pulse-ui.css is pulse-ui's stylesheet as it ships, loading nothing from a host the artifact's CSP refuses", () => {
    const css = read("pulse-ui.css")
    expect(css).toBe(readFileSync(STYLESHEET, "utf8"))
    expect(css).not.toMatch(/@import|url\(\s*["']?https?:/)
  })

  it("app.js stays small enough to load fast (the fixtures alone would pass 1 MB)", () => {
    expect(kb("app.js")).toBeLessThan(900)
  })
})
