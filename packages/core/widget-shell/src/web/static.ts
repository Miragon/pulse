/**
 * The web app's build under `/app`: its page (`index.html`), the routes that show it (the build's
 * `pages.json`) and its `assets` folder. The boot reads the build's folder once, regular files
 * inside it alone (a link that leads out of it fails the boot), so no request touches the file
 * system and the router keeps reading the path as sent: an asset answers at exactly the path a
 * browser requests for its name, `%2e` or another escape of a plain character is no alias of it.
 *
 * `pages.json` is `{ "pages": [...] }`, router patterns under `/app` (`/app` itself, then lowercase
 * words and `:params`, the first segment a word that is none of the server's own: `auth`, `api`,
 * `assets`, `signed-out`), so widget-shell knows no app's routes. A page needs a session, else the
 * browser goes on to the sign-in with the page and its query as the target to return to; the
 * signed-out page needs none. The page is never stored (`no-store`), an asset is immutable for a
 * year (its name carries its hash), and anything else under `/app` is 404.
 */
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs"
import path from "node:path"
import type { McpHttpApp } from "../mcp-server.js"
import { WEB_PATHS } from "../protocol/web.js"
import { loginPage, redirect, type WebContext } from "./context.js"
import { isUnder, returnTarget } from "./return-path.js"
import { requestSession } from "./session.js"

type Bytes = Uint8Array<ArrayBuffer>

interface WebAsset {
  readonly body: Bytes
  readonly type: string
}

export interface WebBuild {
  /** The page every page route and the signed-out page answer with. */
  readonly index: Bytes
  /** The page routes, as router patterns. */
  readonly pages: readonly string[]
  /** The files of the `assets` folder, by the path a browser requests (`/app/assets/…`, escaped). */
  readonly assets: ReadonlyMap<string, WebAsset>
}

const INDEX = "index.html"
const PAGES = "pages.json"

const HTML = "text/html; charset=utf-8"
const IMMUTABLE = "public, max-age=31536000, immutable"

const CONTENT_TYPES: ReadonlyMap<string, string> = new Map([
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".html", HTML],
  [".json", "application/json"],
  [".map", "application/json"],
  [".txt", "text/plain; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".avif", "image/avif"],
  [".ico", "image/x-icon"],
  [".woff2", "font/woff2"],
  [".woff", "font/woff"],
  [".ttf", "font/ttf"],
  [".wasm", "application/wasm"],
])

/** The type an asset is served as, by its extension; an unknown one is plain bytes. */
const typeOf = (name: string): string =>
  CONTENT_TYPES.get(path.extname(name).toLowerCase()) ?? "application/octet-stream"

/**
 * The server's own routes under `/app`, every path of `WEB_PATHS` but `/app` itself, by their first
 * segment there, which no page takes: a route the server gains is reserved with it.
 */
const RESERVED_ROUTES = [
  ...new Set(
    Object.values(WEB_PATHS)
      .filter((route) => route !== WEB_PATHS.app)
      .map((route) => route.split("/", 3).join("/")),
  ),
]
const RESERVED: ReadonlySet<string> = new Set(RESERVED_ROUTES.map((route) => route.split("/")[2]))
const WORD = /^[a-z0-9][a-z0-9-]*$/
const PARAM = /^:[a-z][A-Za-z0-9]*$/

/** Whether `page` is a router pattern of a page: `/app`, or words and `:params` below it. */
function isPagePattern(page: string): boolean {
  if (page === WEB_PATHS.app) return true
  if (!page.startsWith(`${WEB_PATHS.app}/`)) return false
  const [first, ...rest] = page.slice(WEB_PATHS.app.length + 1).split("/")
  if (!WORD.test(first) || RESERVED.has(first)) return false
  return rest.every((segment) => WORD.test(segment) || PARAM.test(segment))
}

const buildFailure = (dir: string, what: string): Error =>
  new Error(`The web build in ${dir} ${what}`)

/** The page routes `pages.json` names, each a page's pattern, `/app` among them. */
function pagesOf(text: Bytes, dir: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(text).toString("utf8"))
  } catch {
    throw buildFailure(dir, `holds a ${PAGES} that is no JSON: build the web app again.`)
  }
  const pages = (parsed as { pages?: unknown } | null)?.pages
  if (!Array.isArray(pages) || !pages.every((page) => typeof page === "string")) {
    throw buildFailure(dir, `holds a ${PAGES} without a "pages" list: build the web app again.`)
  }
  const wrong = pages.find((page) => !isPagePattern(page))
  if (wrong !== undefined) {
    throw buildFailure(
      dir,
      `names the page "${wrong}" in ${PAGES}, which is no page route: a page is ${WEB_PATHS.app} ` +
        `or lies below it in lowercase words and :params, outside ${RESERVED_ROUTES.join(", ")}.`,
    )
  }
  if (!pages.includes(WEB_PATHS.app)) {
    throw buildFailure(
      dir,
      `names no page ${WEB_PATHS.app} in ${PAGES}, where a sign-in returns by default: ` +
        `build the web app with a page at ${WEB_PATHS.app}.`,
    )
  }
  return pages
}

/** A file of the build: a regular file inside its folder, or a link to one inside it. */
function readInside(root: string, file: string, name: string, dir: string): Bytes {
  const real = realpathSync(file)
  if (!real.startsWith(`${root}${path.sep}`)) {
    throw buildFailure(dir, `links ${name} to a file outside it: copy the file into the build.`)
  }
  if (!statSync(real).isFile()) {
    throw buildFailure(
      dir,
      `holds ${name}, which is no regular file: the server serves files and folders, never a ` +
        "link to a folder or a device.",
    )
  }
  return readFileSync(real)
}

/** Every file below `folder`, by its name in the build (`assets/app.js`). */
function readFolder(root: string, folder: string, dir: string, files: Map<string, Bytes>): void {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name)
    const name = path.relative(root, file).split(path.sep).join("/")
    if (entry.isDirectory()) readFolder(root, file, dir, files)
    else files.set(name, readInside(root, file, name, dir))
  }
}

const decoded = (target: string): string | undefined => {
  try {
    return decodeURIComponent(target)
  } catch {
    return undefined
  }
}

/** The path a browser requests for the file `name` of the build, escaped as its URL parser does. */
function servedPathOf(name: string, dir: string): string {
  const literal = `${WEB_PATHS.app}/${name}`
  const served = new URL(literal, "http://h").pathname
  if (decoded(served) !== literal) {
    throw buildFailure(
      dir,
      `holds ${name}, whose name no URL reaches as it is (a ?, #, \\ or %): rename it in the build.`,
    )
  }
  return served
}

function assetsOf(files: ReadonlyMap<string, Bytes>, dir: string): Map<string, WebAsset> {
  const assets = new Map<string, WebAsset>()
  for (const [name, body] of files) {
    if (!isUnder(`${WEB_PATHS.app}/${name}`, WEB_PATHS.assets)) continue
    assets.set(servedPathOf(name, dir), { body, type: typeOf(name) })
  }
  return assets
}

const isFolder = (dir: string): boolean =>
  statSync(dir, { throwIfNoEntry: false })?.isDirectory() === true

/**
 * The web build in `dir`, read once: its page, its page routes and its assets. Fails when the folder
 * holds no `index.html` or no `pages.json`, when `pages.json` names no page routes or no `/app`,
 * and when a file is a link out of the folder, no regular file, or named so no URL reaches it.
 */
export function readWebBuild(dir: string): WebBuild {
  const files = new Map<string, Bytes>()
  if (isFolder(dir)) {
    const root = realpathSync(dir)
    readFolder(root, root, dir, files)
  }
  const index = files.get(INDEX)
  const pages = files.get(PAGES)
  if (index === undefined || pages === undefined) {
    const missing = [INDEX, PAGES].filter((name) => !files.has(name)).join(" and no ")
    throw new Error(
      `MCP_WEB_CLIENT_ID is set, but ${dir} holds no web build (no ${missing}): build the web ` +
        "app into it, or set MCP_WEB_DIR to the folder it was built into.",
    )
  }
  return { index, pages: pagesOf(pages, dir), assets: assetsOf(files, dir) }
}

/** A file of the build as an answer, a fresh `Response` per request. */
const fileAnswer = (body: Bytes, type: string, cacheControl: string): Response =>
  new Response(body, {
    headers: {
      "content-type": type,
      "content-length": String(body.byteLength),
      "cache-control": cacheControl,
    },
  })

/**
 * A page's request without a session: on to the sign-in (302), which returns to the page and its
 * query, the session's cookies cleared when the browser sent one that no longer opens.
 */
async function signInFirst(ctx: WebContext, request: Request): Promise<Response | undefined> {
  const opened = await requestSession(ctx, request)
  if (!(opened instanceof Response)) return undefined
  const { pathname, search } = new URL(request.url)
  const location = loginPage(returnTarget(`${pathname}${search}`))
  return redirect(302, location, opened.headers.getSetCookie())
}

/** The build's routes: its assets, the signed-out page and each page behind the sign-in. */
export function installWebBuild(app: McpHttpApp, build: WebBuild, ctx: WebContext): void {
  const page = (): Response => fileAnswer(build.index, HTML, "no-store")
  app.get(`${WEB_PATHS.assets}/*`, (c) => {
    const asset = build.assets.get(c.req.path)
    return asset === undefined ? c.notFound() : fileAnswer(asset.body, asset.type, IMMUTABLE)
  })
  app.get(WEB_PATHS.signedOut, page)
  for (const pattern of build.pages) {
    app.get(pattern, async (c) => (await signInFirst(ctx, c.req.raw)) ?? page())
  }
}
