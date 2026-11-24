// Screenshots of the page on the fixtures before you publish: `pnpm shot [-- --locale de]`.
//
// Builds the page on the fixtures (`vite build --mode fixtures` into shots/dist, a dist/ the
// repo's stylesheet scans skip), serves it in the skeleton a Claude artifact wraps a page in
// (index.html), and takes full-page screenshots with Playwright's Chromium in light
// (data-theme="light"), dark (data-theme="dark") and with no data-theme and the OS in dark, each
// at 1240 and 390 px, plus one with a failing section, into shots/. The clock and the time zone
// are the recording's and the locale is fixed, so two runs differ only where the page does. Needs
// Chromium once:
// `pnpm exec playwright install --with-deps chromium`.
import { readFileSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { createServer } from "node:http"
import { extname, join } from "node:path"
import { parseArgs } from "node:util"
import { chromium } from "playwright"
import { build } from "vite"
import { pageProcessKey } from "./process-key.ts"

const ROOT = new URL("..", import.meta.url).pathname
const SITE = join(ROOT, "shots/dist")
const OUT = join(ROOT, "shots")

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: { locale: { type: "string", default: "en" } },
})
const language = values.locale.toLowerCase().startsWith("de") ? "de" : "en"
const locale = language === "de" ? "de-DE" : "en-US"

/** Each screenshot: its theme on <html>, the OS's scheme, the width, the fixture's failing tools. */
const SHOTS = [
  { name: "light", theme: "light", os: "light" },
  { name: "dark", theme: "dark", os: "light" },
  { name: "os-dark", theme: null, os: "dark" },
].flatMap((shot) => [1240, 390].map((width) => ({ ...shot, width, fail: "" })))
SHOTS.push({
  name: "failure",
  theme: "light",
  os: "light",
  width: 1240,
  fail: "engine_process_stats",
})

await build({ root: ROOT, mode: "fixtures", logLevel: "warn" })

const skeleton = readFileSync(join(ROOT, "index.html"), "utf8")
const page = readFileSync(join(SITE, "index.html"), "utf8")
const TYPES = { ".js": "text/javascript", ".css": "text/css" }
/**
 * The browser's clock and time zone: the fixture's recording time and zone, as the page's engine
 * reads them, so the chart's days are the recorded ones and its labels name them.
 */
const { asOf, timeZone } = JSON.parse(
  readFileSync(join(ROOT, `fixtures/${pageProcessKey()}.json`), "utf8"),
)

/**
 * The theme a request names, as one of the literals Claude stamps on <html>: null (no theme, the
 * page follows the OS), "light" or "dark"; anything else is undefined, and the request is refused.
 * The page writes the literal, never the request's text.
 */
function themeOf(requested) {
  if (requested === null) return null
  if (requested === "light") return "light"
  if (requested === "dark") return "dark"
  return undefined
}

/** The page in the artifact's skeleton, `data-theme` on <html> as Claude stamps it. */
function documentFor(theme) {
  const html = skeleton.replace("<!-- artifact-page -->", page)
  return theme === null ? html : html.replace("<html>", `<html data-theme="${theme}">`)
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost")
  if (url.pathname === "/") {
    const theme = themeOf(url.searchParams.get("theme"))
    if (theme === undefined) {
      response.writeHead(400).end()
      return
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    response.end(documentFor(theme))
    return
  }
  const type = TYPES[extname(url.pathname)]
  if (type === undefined || url.pathname.includes("..")) {
    response.writeHead(404).end()
    return
  }
  try {
    const body = readFileSync(join(SITE, url.pathname))
    response.writeHead(200, { "content-type": type }).end(body)
  } catch {
    response.writeHead(404).end()
  }
})
await new Promise((ready) => server.listen(0, "127.0.0.1", ready))
const address = server.address()
const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`

await mkdir(OUT, { recursive: true })
const browser = await chromium.launch()
try {
  for (const shot of SHOTS) {
    const context = await browser.newContext({
      viewport: { width: shot.width, height: 900 },
      deviceScaleFactor: 1,
      colorScheme: shot.os,
      locale,
      timezoneId: timeZone,
      reducedMotion: "reduce",
    })
    const tab = await context.newPage()
    const problems = []
    tab.on("pageerror", (error) => problems.push(error.message))
    tab.on("console", (message) => {
      if (message.type() === "error") problems.push(message.text())
    })
    await tab.clock.setFixedTime(new Date(asOf))
    const query = new URLSearchParams({ lang: locale })
    if (shot.theme !== null) query.set("theme", shot.theme)
    if (shot.fail) query.set("fail", shot.fail)
    await tab.goto(`${base}/?${query.toString()}`)
    await tab.waitForSelector(".djs-container svg", { timeout: 15_000 })
    await tab.waitForFunction(() => document.querySelector('[aria-busy="true"]') === null)
    await tab.evaluate(() => document.fonts.ready)
    await tab.waitForTimeout(300)
    const file = join(OUT, `${language}-${shot.name}-${String(shot.width)}.png`)
    await tab.screenshot({ path: file, fullPage: true })
    console.log(`shots/${language}-${shot.name}-${String(shot.width)}.png`)
    for (const problem of problems) console.warn(`  the page logged: ${problem}`)
    await context.close()
  }
} finally {
  await browser.close()
  server.close()
}
