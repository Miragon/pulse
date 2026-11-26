import { mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { type Browser, chromium, type Frame } from "playwright"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  BUNDLE,
  type BrowserBundle,
  buildBrowserBundle,
  RUNTIME,
} from "../scripts/browser-bundle.mjs"

/**
 * A page without a build over the browser bundle, as a Claude artifact runs one: the page's
 * content in a skeleton like claude.ai's, with pulse-ui.css as its own file, on the artifact's
 * origin in a sandboxed frame (origin null) under the artifact's content security policy
 * (scripts inline and from the CDN, stylesheets from the page's files and Google Fonts, no fetch,
 * XHR or WebSocket). Its module imports pulse-ui.js and claude-artifact.js from a CDN's stand-in
 * on another origin with jsDelivr's layout and CORS, and `window.claude` is a frozen stand-in of
 * the artifact runtime as a probe verified it on 2026-11-25 (contract 0.2.99), which records every
 * call. Rendered in Chromium (the Playwright pin CI installs). The README's example ("Use in a page
 * without a build") runs as it stands; a page of the suite's own adds what the example does not
 * show: two sections on one read and a second connector. Set PULSE_WIDGET_SHELL_BROWSER_SHOTS to a
 * folder to keep a screenshot of every case there.
 */

const CHAT = "http://claude.test"
const ARTIFACT = "http://artifact.test"
const NPM = "http://cdn.test/npm/"
const TIMEOUT = { timeout: 60_000 }
const SHOTS = process.env.PULSE_WIDGET_SHELL_BROWSER_SHOTS

/** The artifact's content security policy; the page's own files stand on its origin. */
const CSP = [
  "default-src 'none'",
  `script-src 'unsafe-inline' ${NPM}`,
  `style-src ${ARTIFACT} 'unsafe-inline' https://fonts.googleapis.com`,
  "font-src https://fonts.gstatic.com",
  "img-src data:",
  "connect-src 'none'",
].join("; ")

/** When the stand-in's answers were read. */
const AS_OF = "2026-11-25T09:30:00.000Z"
const ZONE = "Europe/Berlin"
const ENGINE_DOWN = "[503 ServiceUnavailable] The engine did not answer. (engine prod-a)"

/** What the runtime's stand-in does at the page's first call, and on until a case changes it. */
interface Behaviour {
  /** The runtime's refusal code per connector. */
  readonly refuse?: Readonly<Record<string, string>>
  /** The tool error every call answers, per connector. */
  readonly toolError?: Readonly<Record<string, string>>
}

/** A call the stand-in recorded, as the page made it. */
interface RecordedCall {
  readonly server: string
  readonly tool: string
  readonly args: Record<string, unknown>
  readonly options: unknown
}

/** The page's globals the stand-ins add. */
interface Stubbed {
  readonly stub: { readonly calls: RecordedCall[]; readonly behaviour: Behaviour }
  readonly rootWrites: string[]
}

/**
 * The runtime's stand-in, a classic script before the page's content: `window.claude.use("mcp")`
 * resolves a frozen namespace whose `callTool(server, tool, args, options)` resolves the tool's
 * result with `payload` and rejects with a plain object `{ code, message, server }`, a tool's own
 * error as `tool_error` with its result.
 */
const runtimeStub = (behaviour: Behaviour) => `
(() => {
  const calls = []
  const behaviour = ${JSON.stringify(behaviour)}
  const answers = {
    engine_process_stats: { asOf: "${AS_OF}", now: { running: 1284 } },
    crm_count_accounts: { asOf: "${AS_OF}", accounts: 42 },
  }
  const mcp = Object.freeze({
    callTool(server, tool, args, options) {
      calls.push({ server, tool, args, options })
      const code = behaviour.refuse?.[server]
      if (code) return Promise.reject({ code, message: "The runtime refuses the call.", server })
      const text = behaviour.toolError?.[server]
      if (text) {
        const result = { isError: true, content: [{ type: "text", text }] }
        return Promise.reject({ code: "tool_error", message: text, server, result })
      }
      const data = answers[tool]
      const content = [{ type: "text", text: JSON.stringify(data) }]
      return Promise.resolve({ content, structuredContent: data, payload: data })
    },
  })
  const claude = Object.freeze({ use: (capability) => Promise.resolve(capability === "mcp" ? mcp : null) })
  Object.defineProperty(window, "claude", { value: claude, enumerable: true })
  Object.defineProperty(window, "stub", { value: Object.freeze({ calls, behaviour }) })
})()
`

/** Records every write of the page onto the root's theme: claude.ai's to make, never the page's. */
const ROOT_WATCH = `
window.rootWrites = []
new MutationObserver((records) => {
  for (const record of records) window.rootWrites.push(record.attributeName)
}).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-cd-theme", "class"] })
`

interface Case {
  /** The page's content: what a person publishes, wrapped in the skeleton. */
  readonly content: string
  /** The root's data-theme, as claude.ai stamps an explicit choice; none for "system". */
  readonly theme?: "light" | "dark"
  readonly os: "light" | "dark"
  /** The browser's language; default en-US. */
  readonly locale?: string
  /** The runtime's stand-in; none for a page outside an artifact. */
  readonly runtime?: Behaviour
}

/** The page's document: claude.ai's skeleton around its content, the stand-ins first. */
const artifactDocument = ({ content, theme, runtime }: Case) => `<!doctype html>
<html lang="en"${theme === undefined ? "" : ` data-theme="${theme}"`}>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<script>${ROOT_WATCH}</script>
${runtime === undefined ? "" : `<script>${runtimeStub(runtime)}</script>`}
</head>
<body>
${content}
</body>
</html>
`

const CHAT_PAGE = `<!doctype html><html><body style="margin:0">
<iframe title="Artifact" sandbox="allow-scripts" src="${ARTIFACT}/index.html" style="width:1240px;height:900px;border:0"></iframe>
</body></html>`

let bundle: BrowserBundle
let browser: Browser
/** The CDN's files, by their path under /npm/. */
let cdn: Record<string, string>
let stylesheet: string

beforeAll(async () => {
  ;[bundle, browser] = await Promise.all([buildBrowserBundle(), chromium.launch()])
  const { dir, version } = bundle.runtime
  cdn = {
    [`@miragon/pulse-ui@${version}/dist/browser/${RUNTIME}`]: readFileSync(
      join(dir, RUNTIME),
      "utf8",
    ),
    [`@miragon/pulse-widget-shell@${version}/dist/browser/${BUNDLE}`]: bundle.files[BUNDLE] ?? "",
  }
  stylesheet = readFileSync(join(dir, "pulse-ui.css"), "utf8")
}, 60_000)

afterAll(async () => {
  await browser.close()
})

/** The artifact in a fresh context, with what went wrong on it: an error, a request elsewhere. */
async function open(page: Case) {
  const context = await browser.newContext({
    colorScheme: page.os,
    locale: page.locale ?? "en-US",
    timezoneId: ZONE,
    viewport: { width: 1240, height: 900 },
  })
  const tab = await context.newPage()
  const problems: string[] = []
  tab.on("pageerror", (error) => problems.push(error.message))
  tab.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") problems.push(message.text())
  })
  await tab.route("**/*", (route) => {
    const url = route.request().url()
    if (url === `${CHAT}/`) return route.fulfill({ body: CHAT_PAGE, contentType: "text/html" })
    if (url === `${ARTIFACT}/index.html`) {
      const headers = { "content-security-policy": CSP }
      return route.fulfill({ body: artifactDocument(page), contentType: "text/html", headers })
    }
    if (url === `${ARTIFACT}/pulse-ui.css`)
      return route.fulfill({ body: stylesheet, contentType: "text/css" })
    const file = url.startsWith(NPM) ? cdn[url.slice(NPM.length)] : undefined
    if (file === undefined) {
      problems.push(`requested ${url}`)
      return route.abort()
    }
    const headers = { "access-control-allow-origin": "*" }
    return route.fulfill({ body: file, contentType: "text/javascript", headers })
  })
  await tab.goto(`${CHAT}/`)
  const frame = tab.frames().find((each) => each.url() === `${ARTIFACT}/index.html`)
  if (frame === undefined) throw new Error("the chat shows no artifact")
  const shot = async (name: string) => {
    if (!SHOTS) return
    mkdirSync(SHOTS, { recursive: true })
    await tab.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true })
  }
  return { frame, problems, shot, close: () => context.close() }
}

/** The calls the runtime's stand-in recorded. */
const callsOf = (frame: Frame) => frame.evaluate(() => (window as unknown as Stubbed).stub.calls)

/** The page's text, as a reader sees it. */
const textOf = (frame: Frame) => frame.locator("body").innerText()

/** The body's ground and text as the browser computes them, and the root as the page left it. */
const looks = (frame: Frame) =>
  frame.evaluate(() => {
    const body = getComputedStyle(document.body)
    const root = document.documentElement
    return {
      background: body.backgroundColor,
      color: body.color,
      size: body.fontSize,
      theme: root.getAttribute("data-theme"),
      dark: root.classList.contains("dark"),
      scheme: root.style.colorScheme,
      writes: (window as unknown as Stubbed).rootWrites,
    }
  })

const LIGHT = { background: "rgb(249, 247, 247)", color: "rgb(29, 29, 29)" }
const DARK = { background: "rgb(29, 29, 29)", color: "rgb(255, 255, 255)" }

/** The cache a first read and a refreshed read hand the runtime. */
const FIRST = { cache: { staleTime: 30_000, gcTime: 600_000 } }
const REFRESHED = { cache: { staleTime: 0, gcTime: 600_000, refresh: true } }
const STATS = { processDefinitionKey: "orders", bucket: "day", timeZone: ZONE }

/**
 * The README's example ("Use in a page without a build") as the page's content, its modules from
 * the CDN's stand-in at this release's version: the example the README shows is one that runs.
 */
function readmeExample(): string {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8")
  const section = readme.slice(readme.indexOf("## Use in a page without a build"))
  const example = /```html\n([\s\S]*?)```/.exec(section)?.[1] ?? ""
  const jsdelivr = "https://cdn.jsdelivr.net/npm/"
  expect(example).toContain(
    `${jsdelivr}@miragon/pulse-widget-shell@<version>/dist/browser/${BUNDLE}`,
  )
  return example.replaceAll(jsdelivr, NPM).replaceAll("@<version>", `@${bundle.runtime.version}`)
}

/**
 * The suite's own page: two sections on one read of Pulse behind its gate, and a section that
 * reads a second connector, outside that gate.
 */
const TWO_CONNECTORS = `
<link rel="stylesheet" href="pulse-ui.css" />
<div id="root"></div>
<script type="module">
  import * as ui from "${NPM}@miragon/pulse-ui@VERSION/dist/browser/pulse-ui.js"
  import { mountClaudeArtifact, PageGate, useSectionRead } from "${NPM}@miragon/pulse-widget-shell@VERSION/dist/browser/claude-artifact.js"

  const h = ui.createElement
  const stats = (reader) => reader.call("engine_process_stats", { processDefinitionKey: "orders", bucket: "day", timeZone: reader.timeZone })
  const accounts = (reader) => reader.call("crm_count_accounts", {}, { connector: "Acme CRM" })

  function Tile({ name, readKey, read, value }) {
    const section = useSectionRead(readKey, read)
    return h(ui.Panel, { title: name }, h(ui.SectionState, { state: section.state, onRetry: section.retry }, (data) =>
      h("output", { "data-tile": name }, ui.formatCount(value(data)))))
  }

  function App() {
    return h("main", { className: "flex flex-col gap-section p-gutter" },
      h("h1", null, "Orders and accounts"),
      h(ui.SectionStateGroup, null,
        h(PageGate, { connector: "Pulse" },
          h(Tile, { name: "Running", readKey: ["stats", "orders"], read: stats, value: (data) => data.now.running }),
          h(Tile, { name: "Still running", readKey: ["stats", "orders"], read: stats, value: (data) => data.now.running })),
        h(Tile, { name: "Accounts", readKey: ["accounts"], read: accounts, value: (data) => data.accounts })))
  }

  mountClaudeArtifact(App, { connector: "Pulse" })
</script>
`

const twoConnectors = () => TWO_CONNECTORS.replaceAll("@VERSION", `@${bundle.runtime.version}`)

describe("a page without a build in a Claude artifact", () => {
  it(
    "renders the README's example: one call on Pulse, claude.ai's theme followed and never written, Refresh past the runtime's cache",
    TIMEOUT,
    async () => {
      const page = await open({ content: readmeExample(), theme: "light", os: "dark", runtime: {} })
      try {
        const { frame } = page
        await frame.getByText("1,284", { exact: true }).waitFor()
        expect(await callsOf(frame)).toEqual([
          { server: "Pulse", tool: "engine_process_stats", args: STATS, options: FIRST },
        ])
        await frame.locator('[data-slot="freshness-stamp"]').waitFor()
        // claude.ai's light stays on a dark OS, and the page wrote no theme onto the root.
        expect(await looks(frame)).toEqual({
          ...LIGHT,
          size: "13px",
          theme: "light",
          dark: false,
          scheme: "",
          writes: [],
        })
        await page.shot("readme-example-light")

        await frame.getByRole("button", { name: "Refresh" }).click()
        await expect.poll(async () => (await callsOf(frame)).length).toBe(2)
        expect((await callsOf(frame))[1]).toEqual({
          server: "Pulse",
          tool: "engine_process_stats",
          args: STATS,
          options: REFRESHED,
        })

        // claude.ai switches to dark: the stylesheet follows its attribute.
        await frame.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"))
        await expect.poll(async () => (await looks(frame)).background).toBe(DARK.background)
        await page.shot("readme-example-dark")
        expect(page.problems).toEqual([])
      } finally {
        await page.close()
      }
    },
  )

  it(
    "says a refused sign-in once, naming Pulse and claude.ai's place, and reads again on Try again",
    TIMEOUT,
    async () => {
      const page = await open({
        content: readmeExample(),
        os: "light",
        runtime: { refuse: { Pulse: "needs_reauth" } },
      })
      try {
        const { frame } = page
        await frame.getByRole("heading", { level: 2 }).waitFor()
        expect(await frame.getByRole("heading", { level: 2 }).allInnerTexts()).toEqual([
          "Your sign-in to Pulse has expired",
        ])
        expect(await textOf(frame)).toContain(
          "Reconnect to Pulse in claude.ai, in Settings under Connectors, then try again.",
        )
        expect(await frame.locator('[data-slot="section-state"]').count()).toBe(0)
        expect(await frame.locator('[data-slot="freshness-stamp"]').count()).toBe(0)
        expect(await callsOf(frame)).toHaveLength(1)
        await page.shot("needs-reauth")

        await frame.evaluate(() => {
          const { behaviour } = (window as unknown as Stubbed).stub
          ;(behaviour as { refuse?: object }).refuse = {}
        })
        await frame.getByRole("button", { name: "Try again" }).click()
        await frame.getByText("1,284", { exact: true }).waitFor()
        expect((await callsOf(frame)).at(-1)?.options).toEqual(REFRESHED)
        expect(page.problems).toEqual([])
      } finally {
        await page.close()
      }
    },
  )

  it(
    "outside an artifact, in German on a dark OS: one state that Pulse is not connected, and no theme written",
    TIMEOUT,
    async () => {
      const page = await open({ content: readmeExample(), os: "dark", locale: "de-DE" })
      try {
        const { frame } = page
        await frame.getByRole("heading", { level: 2 }).waitFor()
        expect(await frame.getByRole("heading", { level: 2 }).allInnerTexts()).toEqual([
          "Diese Seite ist nicht mit Pulse verbunden",
        ])
        expect(await textOf(frame)).toContain(
          "Richte Pulse in claude.ai in den Einstellungen unter Connectors ein und versuch es dann noch mal.",
        )
        // No attribute on the root (claude.ai's "system"): the stylesheet follows the OS.
        expect(await looks(frame)).toEqual({
          ...DARK,
          size: "13px",
          theme: null,
          dark: false,
          scheme: "",
          writes: [],
        })
        await page.shot("not-connected-de")
        expect(page.problems).toEqual([])
      } finally {
        await page.close()
      }
    },
  )

  it(
    "reads two sections of one key in one call, and a second connector by its name, whose refusal stays in its section",
    TIMEOUT,
    async () => {
      const page = await open({
        content: twoConnectors(),
        os: "light",
        runtime: { refuse: { "Acme CRM": "server_not_connected" } },
      })
      try {
        const { frame } = page
        await frame.locator('[data-tile="Still running"]').waitFor()
        await frame.getByText("This page isn't connected to Acme CRM").waitFor()
        const calls = await callsOf(frame)
        expect(calls.map(({ server, tool }) => `${server} ${tool}`).sort()).toEqual([
          "Acme CRM crm_count_accounts",
          "Pulse engine_process_stats",
        ])
        expect(calls.find(({ server }) => server === "Acme CRM")?.args).toEqual({})
        expect(await frame.locator("[data-tile]").allInnerTexts()).toEqual(["1,284", "1,284"])
        expect(await textOf(frame)).toContain(
          "Set up Acme CRM in claude.ai, in Settings under Connectors, then try again.",
        )
        const accounts = frame.getByRole("region", { name: "Accounts" })
        expect(
          await accounts.locator('[data-slot="section-state"]').getAttribute("data-state"),
        ).toBe("error")
        expect(await textOf(frame)).not.toContain("Pulse")
        await page.shot("two-connectors")
        expect(page.problems).toEqual([])
      } finally {
        await page.close()
      }
    },
  )

  it(
    "words a server's error once, the raw text under Details, the second section of its read the same reason, after the section's retries alone",
    TIMEOUT,
    async () => {
      const page = await open({
        content: twoConnectors(),
        os: "light",
        runtime: { toolError: { Pulse: ENGINE_DOWN } },
      })
      try {
        const { frame } = page
        await frame
          .getByText("Not read, for the same reason as above.")
          .waitFor({ timeout: 30_000 })
        await frame.locator('[data-tile="Accounts"]').waitFor()
        const text = await textOf(frame)
        expect(text).toContain("Engine prod-a is unreachable (HTTP 503)")
        expect(text).toContain(
          "Try again in a moment. If it stays unreachable, ask whoever runs the server.",
        )
        expect(text).not.toContain(ENGINE_DOWN)
        await frame.getByText("Details").first().click()
        expect(await textOf(frame)).toContain(ENGINE_DOWN)
        // The first read and the section's three retries, each one call: none retried inside.
        const stats = (await callsOf(frame)).filter(({ tool }) => tool === "engine_process_stats")
        expect(stats).toHaveLength(4)
        await page.shot("server-error")
        expect(page.problems).toEqual([])
      } finally {
        await page.close()
      }
    },
  )
})
