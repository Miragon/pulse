/// <reference types="node" />
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { type Browser, chromium, type Page } from "playwright"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  type BrowserBundle,
  buildBrowserBundle,
  STYLESHEET,
  STYLESHEET_MODULE,
} from "../scripts/browser-bundle.mjs"

/**
 * A page with no file of its own over the browser bundle, as a Claude artifact in a chat runs one:
 * its content in a host's skeleton on its own origin, under the chat's content security policy,
 * importing pulse-ui.js and pulse-ui-css.js from a CDN's stand-in on another origin, rendered in
 * Chromium (the Playwright pin CI installs). The README's example ("Use in a page without a
 * build") runs as it stands; a page of the suite's own proves that pulse-ui-css.js applies the
 * stylesheet, its @property rules included, where a `<link>` to the CDN's pulse-ui.css is refused,
 * and that a style of the page's own wins over the kit's from its content, not from its `<head>`.
 * browser-page.test.ts renders a page that links pulse-ui.css as its own file. Set
 * PULSE_UI_BROWSER_SHOTS to a folder to keep a screenshot of every case there.
 */

const ORIGIN = "http://frame.pulse-ui.test"
/** A CDN's stand-in on another origin, which answers as jsDelivr does: CORS open to every page. */
const CDN_NPM = "http://cdn.pulse-ui.test/npm/"
const CDN = `${CDN_NPM}@miragon/pulse-ui@0.0.0/dist/browser/`
const TIMEOUT = { timeout: 60_000 }
const SHOTS = process.env.PULSE_UI_BROWSER_SHOTS

/**
 * The content security policy of a Claude artifact in a chat, as a probe read it in claude.ai on
 * 2026-11-26 (scripts/browser-bundle.mjs, pulse-ui-css.js), with the frame's origin as 'self' and
 * the CDN's stand-in for jsDelivr's /npm/: stylesheets only from the page's own origin, inline and
 * from Google Fonts, scripts inline and from the CDN, and no request to the CDN but a script's.
 */
const CHAT_CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: ${CDN_NPM}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob:",
  "font-src 'self' data: blob: https://fonts.gstatic.com",
  "connect-src 'self' blob: https://fonts.googleapis.com https://fonts.gstatic.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ")

/**
 * The head of a host's skeleton around a page's content: its reset, as a Claude artifact's sets
 * the body in a 14px system font and the root light, and a listener that keeps every violation of
 * the content security policy, which the page reads as `window.violations`.
 */
const SKELETON_HEAD = `
<meta charset="utf-8" />
<style>:root{color-scheme:light}body{margin:0;font:14px system-ui}</style>
<script>
  window.violations = []
  document.addEventListener("securitypolicyviolation", (event) =>
    window.violations.push({ directive: event.effectiveDirective, blocked: event.blockedURI }))
</script>
`

/** A page's content in that skeleton, and what the page puts into its `<head>`, if anything. */
const inSkeleton = (title: string, content: string, head = "") =>
  `<!doctype html><html lang="en"><head>${SKELETON_HEAD}<title>${title}</title>${head}</head><body>${content}</body></html>`

let bundle: BrowserBundle
let browser: Browser

beforeAll(async () => {
  ;[bundle, browser] = await Promise.all([buildBrowserBundle(), chromium.launch()])
}, 60_000)

afterAll(async () => {
  await browser.close()
})

/**
 * `html` as the page's document under the chat's policy on a dark OS, the bundle's files on the
 * CDN's stand-in, with what went wrong on it: an error, a warning, a request to any other place.
 */
async function open(html: string) {
  const context = await browser.newContext({ colorScheme: "dark" })
  const page = await context.newPage()
  const problems: string[] = []
  page.on("pageerror", (error) => problems.push(error.message))
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) problems.push(message.text())
  })
  await page.route("**/*", (route) => {
    const url = route.request().url()
    if (url === `${ORIGIN}/`) {
      const headers = { "content-security-policy": CHAT_CSP }
      return route.fulfill({ body: html, contentType: "text/html", headers })
    }
    const file = url.startsWith(CDN) ? bundle.files[url.slice(CDN.length)] : undefined
    if (file === undefined) {
      problems.push(`requested ${url}`)
      return route.abort()
    }
    const contentType = url.endsWith(".css") ? "text/css" : "text/javascript"
    const headers = { "access-control-allow-origin": "*" }
    return route.fulfill({ body: file, contentType, headers })
  })
  await page.goto(`${ORIGIN}/`)
  await page.locator("h1").waitFor()
  return { page, problems, close: () => context.close() }
}

/** The ground and the text of the body, `rgb(…)` as the browser computes them. */
const ground = (page: Page) =>
  page.evaluate(() => {
    const style = getComputedStyle(document.body)
    return { background: style.backgroundColor, color: style.color, size: style.fontSize }
  })

const DARK_GROUND = { background: "rgb(29, 29, 29)", color: "rgb(255, 255, 255)" }

/**
 * The README's example ("Use in a page without a build") as a page's content in the skeleton: its
 * modules, pulse-ui.js and pulse-ui-css.js, from the CDN's stand-in on another origin, and no file
 * of its own. The example the README shows is one that renders.
 */
function readmeExample(): string {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8")
  const section = readme.slice(readme.indexOf("## Use in a page without a build"))
  const example = /```html\n([\s\S]*?)```/.exec(section)?.[1] ?? ""
  const jsdelivr = "https://cdn.jsdelivr.net/npm/@miragon/pulse-ui@<version>/dist/browser/"
  expect(example).toContain(`import "${jsdelivr}${STYLESHEET_MODULE}"`)
  expect(example).not.toContain("<link")
  return inSkeleton("Leasing", example.replaceAll(jsdelivr, CDN))
}

/** The violations of the content security policy the skeleton's listener kept. */
const violations = (page: Page) =>
  page.evaluate(() => (window as unknown as { violations: unknown[] }).violations)

/**
 * A page with no file of its own: a primary Button (shadow-1, whose box-shadow is only valid while
 * the stylesheet's @property rules register Tailwind's shadow variables), and an element that sets
 * a variable registered as a <length>, which only a registered one computes to px. It gets the
 * stylesheet by a `<link>` or by the module's import, and `own` puts a style of its own into its
 * `<head>` or first into its content.
 */
const noFilesOfItsOwn = (
  stylesheet: { link: string } | { module: string },
  own: { head?: string; content?: string } = {},
) =>
  inSkeleton(
    "No files",
    `${own.content ?? ""}${"link" in stylesheet ? `<link rel="stylesheet" href="${stylesheet.link}" />` : ""}
<div id="root"></div>
<script type="module">
  import { createElement as h, createRoot, Button } from "${CDN}pulse-ui.js"
  ${"module" in stylesheet ? `import "${stylesheet.module}"` : ""}

  createRoot(document.getElementById("root")).render(
    h("main", { className: "flex flex-col gap-section p-gutter" },
      h("h1", null, "No files"),
      h("div", null, h(Button, null, "Refresh")),
      h("span", { "data-slot": "registered", style: { "--tw-border-spacing-x": "1rem" } }),
    ),
  )
</script>`,
    own.head,
  )

/** What the stylesheet decides on the page, as the browser computes it. */
const applied = (page: Page) =>
  page.evaluate(() => {
    const body = getComputedStyle(document.body)
    const button = getComputedStyle(document.querySelector("button") as Element)
    const registered = document.querySelector('[data-slot="registered"]') as Element
    return {
      size: body.fontSize,
      font: body.fontFamily,
      scheme: body.colorScheme,
      background: body.backgroundColor,
      button: button.backgroundColor,
      // Each shadow of the list, split at the commas outside a colour's parentheses.
      shadows: button.boxShadow === "none" ? [] : button.boxShadow.split(/,(?![^(]*\))/),
      length: getComputedStyle(registered).getPropertyValue("--tw-border-spacing-x"),
      styles: document.querySelectorAll("style[data-pulse-ui]").length,
    }
  })

describe("a page with no file of its own, under a chat's content security policy", () => {
  it("renders the README's example as it stands, without a violation", TIMEOUT, async () => {
    const { page, problems, close } = await open(readmeExample())
    try {
      await expect(page.locator("h1").textContent()).resolves.toBe("Leasing")
      expect(await page.locator('[data-slot="count-figure"] svg.lucide').count()).toBe(1)
      expect(await ground(page)).toEqual({ ...DARK_GROUND, size: "13px" })
      expect(await violations(page)).toEqual([])
      if (SHOTS) await page.screenshot({ path: join(SHOTS, "readme-example.png"), fullPage: true })
      expect(problems).toEqual([])
    } finally {
      await close()
    }
  })

  it(
    "takes the stylesheet from pulse-ui-css.js: the roles, the body over the skeleton's reset, the @property registrations, no violation",
    TIMEOUT,
    async () => {
      const { page, problems, close } = await open(
        noFilesOfItsOwn({ module: `${CDN}${STYLESHEET_MODULE}` }),
      )
      try {
        const looks = await applied(page)
        // The kit's font on the dense step and the OS's dark, over the skeleton's 14px light reset.
        expect(looks).toMatchObject({ size: "13px", scheme: "dark", styles: 1 })
        expect(looks.font).toMatch(/^Geist, /)
        expect(looks.background).toBe(DARK_GROUND.background)
        expect(looks.button).toBe("rgb(51, 93, 229)")
        // Tailwind's inset, inset ring, ring offset and ring shadow at their registered initial
        // value, then shadow-1's own: without the registrations the list is invalid ("none").
        const none = "rgba(0, 0, 0, 0) 0px 0px 0px 0px"
        const [inset, insetRing, offset, ring, ...own] = looks.shadows.map((each) => each.trim())
        expect([inset, insetRing, offset, ring]).toEqual([none, none, none, none])
        expect(own.filter((shadow) => shadow !== none).length).toBeGreaterThan(0)
        expect(looks.length).toBe("16px")
        expect(await violations(page)).toEqual([])
        expect(problems).toEqual([])
      } finally {
        await close()
      }
    },
  )

  /**
   * A page's own style: a role and the body's size on the kit's own selectors, so the order of the
   * two `<style>` elements alone decides which wins.
   */
  const OWN_STYLE = "<style>:root{--primary:rgb(200, 0, 0)}body{font-size:16px}</style>"

  it(
    "lets a page's own style in its content win over the kit's, which comes before it",
    TIMEOUT,
    async () => {
      const module = `${CDN}${STYLESHEET_MODULE}`
      const { page, problems, close } = await open(
        noFilesOfItsOwn({ module }, { content: OWN_STYLE }),
      )
      try {
        expect(await applied(page)).toMatchObject({
          size: "16px",
          button: "rgb(200, 0, 0)",
          styles: 1,
        })
        expect(await violations(page)).toEqual([])
        expect(problems).toEqual([])
      } finally {
        await close()
      }
    },
  )

  it(
    "puts the kit's style after a page's own in <head>, so the kit's rules win there (the README's reason for <body>)",
    TIMEOUT,
    async () => {
      const module = `${CDN}${STYLESHEET_MODULE}`
      const { page, problems, close } = await open(noFilesOfItsOwn({ module }, { head: OWN_STYLE }))
      try {
        const last = await page.evaluate(() =>
          document.head.lastElementChild?.hasAttribute("data-pulse-ui"),
        )
        expect(last).toBe(true)
        expect(await applied(page)).toMatchObject({
          size: "13px",
          button: "rgb(51, 93, 229)",
          styles: 1,
        })
        expect(problems).toEqual([])
      } finally {
        await close()
      }
    },
  )

  it(
    "refuses a <link> to the CDN's pulse-ui.css (style-src-elem), as the probe in claude.ai found",
    TIMEOUT,
    async () => {
      const link = `${CDN}${STYLESHEET}`
      const { page, problems, close } = await open(noFilesOfItsOwn({ link }))
      try {
        await expect
          .poll(() => violations(page))
          .toEqual([{ directive: "style-src-elem", blocked: link }])
        const looks = await applied(page)
        // Nothing of the kit's: the skeleton's reset, no shadow, no registration.
        expect(looks).toMatchObject({ size: "14px", scheme: "light", shadows: [], styles: 0 })
        expect(looks.length).toBe("1rem")
        expect(problems).toEqual([
          expect.stringContaining(`Loading the stylesheet '${link}' violates`),
        ])
      } finally {
        await close()
      }
    },
  )
})
