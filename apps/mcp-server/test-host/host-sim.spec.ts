import AxeBuilder from "@axe-core/playwright"
import { expect, test, type FrameLocator, type Locator, type Page } from "@playwright/test"
import { themeStylesheets } from "@miragon/pulse-ui/testing"
import { SERVED_FONT_PATH } from "@miragon/pulse-widget-shell/server"
import {
  BROKEN_ENGINE,
  ENGINE_CONTROL_ENV,
  HEALTHY_ENGINE,
  REALISTIC_ENGINE,
  REALISTIC_HOST_ENV,
} from "./engines.js"

/**
 * Host-simulation gate for the built widget bundle (see test-host/README.md).
 *
 * Every scenario renders the view document the server ACTUALLY serves
 * (`resources/read` of `ui://views/<tool>.html` from the real `createApp`,
 * embedding `dist/mcp-app.{js,css}`) in a sandboxed srcdoc iframe, behind a
 * minimal SEP-1865 host whose tool calls go to that same server. The
 * rendering tool is the real `engine_open_cockpit` against a stub engine,
 * opened on the route a scenario names, so the view receives the real
 * structuredContent and data shape.
 *
 * Scenarios titled "pinned …" assert the CURRENT behaviour of a known defect
 * that lives outside this repo's fix scope; each names its issue. When the
 * fix lands, the pin fails on purpose. Flip it to the expected behaviour
 * stated in its assertion message.
 */

const RENDER_TOOL = "engine_open_cockpit"
/** The cockpit opened on its engine-wide jobs (the stub's twelve failed jobs). */
const JOBS_ARGS = { engine: HEALTHY_ENGINE, view: "jobs" }
/**
 * How long every re-execution count waits after the last lifecycle event
 * (delivery, recovered render), so a duplicate call lands before the check.
 * The view re-runs its tool only on an OBSERVED stripped result, never on a
 * timer, so nothing may fire in this window.
 */
const OUTLAST_MS = 3_500
const HOST_THEME_ISSUE = "https://github.com/Miragon/pulse/issues/339"
/** The view frame's English chrome (widget-shell's kit labels). */
const CHROME = {
  loading: "Loading view…",
  cancelled: "Cancelled. Ask in the chat to open this view again.",
  retry: "Try again",
  enterFullscreen: "Fullscreen",
  exitFullscreen: "Exit fullscreen",
  /** The quiet line over a payload the view loaded itself ("Reloaded at 2:32 PM"). */
  reloadedAt: /^Reloaded at \d{1,2}:\d{2}/,
}

/**
 * The Miragon corporate-design tokens as pulse-ui vendors them
 * (`--cd-blau: #335DE5` …), colour values only, from the top-level `:root`
 * (the dark and high-contrast scopes switch only under `data-cd-theme` and
 * `data-cd-kontrast`): the drift guard's reference for what the BUILT
 * stylesheet must carry.
 */
function vendoredColourTokens(): [string, string][] {
  const [css] = themeStylesheets()
  const rootStart = css.indexOf(":root {")
  const root = css.slice(rootStart, css.indexOf("\n}", rootStart))
  return [...root.matchAll(/(--cd-[\w-]+):\s*(#[0-9a-fA-F]{3,8});/g)].map(([, name, value]) => [
    name,
    value,
  ])
}

interface HostLog {
  initializeRequested: boolean
  initialized: boolean
  /** Host Date.now() when the view sent `initialized`; the result is held `resultDelayMs` from here. */
  initializedAt: number | null
  delivered: "result" | "cancelled" | null
  originalResult: { isError?: boolean; content?: { type: string; text?: string }[] } | null
  toolCalls: { name: string; arguments: Record<string, unknown> }[]
  displayModeRequests: string[]
  sizeChanges: { width?: number; height?: number; at: number }[]
  methods: string[]
  errors: string[]
}

interface Scenario {
  /** The view-bound tool the "model" invoked (default: {@link RENDER_TOOL}). */
  tool?: string
  /** The host page's deployment env var (default: `HOST_SIM_URL`). */
  hostEnv?: string
  args?: Record<string, unknown>
  structuredContent?: "keep" | "strip"
  resultDelayMs?: number
  cancel?: boolean
  theme?: "light" | "dark"
  /** hostContext.locale (the host sim's default: en-US). */
  locale?: string
  /** The host's SEP-1865 `--font-sans` style variable. */
  fontSans?: string
  /** hostContext.containerDimensions.maxHeight. */
  maxHeight?: number
  displayModes?: string[]
  /** Answer `ui/initialize` this many ms late (a slow handshake). */
  initDelayMs?: number
  /** Build the frame's CSP without the resource's resourceDomains (a host that ignores them). */
  ignoreResourceDomains?: boolean
  /** The frame's width in px (the host sim's default: 960). */
  width?: number
}

async function openView(page: Page, scenario: Scenario = {}): Promise<FrameLocator> {
  const hostEnv = scenario.hostEnv ?? "HOST_SIM_URL"
  const base = process.env[hostEnv]
  if (!base) throw new Error(`${hostEnv} is unset. Run via \`playwright test -c test-host\``)
  const query = new URLSearchParams({
    tool: scenario.tool ?? RENDER_TOOL,
    args: JSON.stringify(scenario.args ?? { engine: HEALTHY_ENGINE }),
    structuredContent: scenario.structuredContent ?? "keep",
    resultDelayMs: String(scenario.resultDelayMs ?? 0),
    theme: scenario.theme ?? "light",
  })
  if (scenario.cancel) query.set("cancel", "1")
  if (scenario.locale) query.set("locale", scenario.locale)
  if (scenario.fontSans) query.set("fontSans", scenario.fontSans)
  if (scenario.maxHeight !== undefined) query.set("maxHeight", String(scenario.maxHeight))
  if (scenario.displayModes) query.set("displayModes", scenario.displayModes.join(","))
  if (scenario.initDelayMs) query.set("initDelayMs", String(scenario.initDelayMs))
  if (scenario.ignoreResourceDomains) query.set("resourceDomains", "ignore")
  if (scenario.width) query.set("width", String(scenario.width))
  await page.goto(`${base}/?${query.toString()}`)
  return page.frameLocator("#app")
}

/**
 * The stub engine's scenario control (stub-engine.ts): `hold` makes its
 * answers to the search `term` wait, `release` sends them.
 */
async function engineControl(action: "hold" | "release", term: string): Promise<void> {
  const base = process.env[ENGINE_CONTROL_ENV]
  if (!base)
    throw new Error(`${ENGINE_CONTROL_ENV} is unset. Run via \`playwright test -c test-host\``)
  const query = new URLSearchParams({ term })
  const res = await fetch(`${base}/__control/${action}?${query.toString()}`, { method: "POST" })
  expect(res.ok, `stub engine ${action} "${term}"`).toBe(true)
}

async function hostLog(page: Page): Promise<HostLog> {
  return await page.evaluate(() => (window as unknown as { __hostLog: HostLog }).__hostLog)
}

/** tools/call requests the VIEW sent for the rendering tool: re-executions. */
async function reExecutions(page: Page): Promise<HostLog["toolCalls"]> {
  return (await hostLog(page)).toolCalls.filter((c) => c.name === RENDER_TOOL)
}

async function waitForDelivery(page: Page, expected: HostLog["delivered"]): Promise<void> {
  await expect.poll(async () => (await hostLog(page)).delivered, { timeout: 15_000 }).toBe(expected)
}

/** Console errors + uncaught exceptions of the page AND the view frame. */
function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text())
  })
  page.on("pageerror", (err) => errors.push(err.message))
  return errors
}

const DEFINITIONS_TABLE =
  "Deployed process definitions with running instances, jobs without retries and incidents"

function definitionsTable(app: FrameLocator): Locator {
  return app.getByRole("table", { name: DEFINITIONS_TABLE })
}

function germanDefinitionsTable(app: FrameLocator): Locator {
  return app.getByRole("table", {
    name: "Bereitgestellte Prozessdefinitionen mit laufenden Instanzen, Jobs ohne Versuche und Incidents",
  })
}

const STUB_DEFINITIONS = ["Customer Onboarding", "Invoice Receipt", "Order Fulfillment"]

/**
 * The stub's three definitions in `table`, issues then running instances first (the stub's
 * order): inline exactly the `shown` rows the host's budget leaves room for under the cockpit's
 * head (#396), and a cut list says how many of the three in its footer row (`shownLine`).
 *
 * Under the compact look (28 px heads, 33 px rows: their 28 px row actions and the cells' 2 px
 * padding; the cockpit's 40 px head and the view's 40 px bar from edge to edge, each route's
 * content in the 12 px gutter) the overview with all three rows is 471 px high at 960 px (472 px
 * at the inline width of 760 px), English and German alike: the unstated budget (fitted as
 * 600 px) fits all three, with 129 px to spare. A host that adds a line above the view (a
 * recovered render's "Reloaded at", the fullscreen toggle's bar) adds 40 px: all three still fit
 * (511 px). Under that line one row and the 44 px footer row are 489 px and two rows and the
 * footer 522 px, so a 500 px budget fits exactly one, 11 px either side of what one and all three
 * need. Where even one row would not fit (a 220 px budget) the fit cuts nothing and the view
 * scrolls instead, and fullscreen fits nothing.
 */
async function expectDefinitions(
  table: Locator,
  shown: 1 | 2 | 3,
  shownLine: (shown: number) => string,
): Promise<void> {
  await expect(table).toBeVisible({ timeout: 15_000 })
  const rows = table.getByRole("row")
  const cut = shown < STUB_DEFINITIONS.length
  // The head, the rows and, in a cut list, its footer row.
  await expect(rows).toHaveCount(shown + 1 + (cut ? 1 : 0))
  for (const [index, name] of STUB_DEFINITIONS.slice(0, shown).entries()) {
    await expect(rows.nth(index + 1)).toContainText(name)
  }
  if (cut) await expect(rows.last()).toContainText(shownLine(shown))
  else await expect(table.locator("tfoot")).toHaveCount(0)
}

/** The cockpit's overview in English: the definitions as {@link expectDefinitions} says. */
async function expectOverview(app: FrameLocator, shown: 1 | 2 | 3 = 3): Promise<void> {
  await expectDefinitions(definitionsTable(app), shown, (count) => `${count} of 3 shown`)
  await expect(app.getByText("3 deployed · counts span all versions")).toBeVisible()
}

/** The same in German. */
async function expectGermanOverview(app: FrameLocator, shown: 1 | 2 | 3 = 3): Promise<void> {
  await expectDefinitions(germanDefinitionsTable(app), shown, (count) => `${count} von 3 angezeigt`)
  await expect(app.getByText("3 bereitgestellt · Zahlen über alle Versionen")).toBeVisible()
}

/**
 * A budget that fits exactly one of the overview's three rows at 960 px under the fullscreen
 * toggle's bar, 11 px either side.
 */
const ONE_DEFINITION_BUDGET = 500

const STUB_JOBS = [
  "Card declined",
  "Card expired",
  "Billing address unknown",
  "Insufficient funds",
  "Issuer unavailable",
  "Limit exceeded",
  "Card blocked",
  "Currency not supported",
  "Gateway timeout",
  "Fraud check failed",
  "Security code mismatch",
  "Account closed",
]

/**
 * The cockpit's jobs route rendered the stub engine's twelve failed jobs, the first job first:
 * inline exactly the `shown` rows the host's budget leaves room for under the cockpit's head
 * and the KPI strip (#396), and the count line says how many of the twelve. Under the compact
 * look (33 px rows with their 28 px row actions, ids in one line, the cockpit's 40 px head and the
 * view's 40 px bar from edge to edge, the content in the 12 px gutter, the KPI strip's 12 px
 * tiles) a 600 px budget (and the unstated one, fitted as 600 px) leaves room for ten at 960 px
 * and at 760 px (589 px; an eleventh row would need 22 px more); 800 px fits all twelve (655 px).
 * A head section shows no trail inline, so the head is the only row above the view.
 */
async function expectJobs(app: FrameLocator, shown: 10 | 12) {
  const region = app.getByRole("region", { name: "Jobs", exact: true })
  await expect(region).toBeVisible({ timeout: 15_000 })
  await expect(region.getByRole("row")).toHaveCount(shown + 1)
  for (const message of STUB_JOBS.slice(0, shown)) {
    await expect(region.getByText(message)).toBeVisible()
  }
  await expect(app.getByText(`Showing ${shown} of ${STUB_JOBS.length} jobs`)).toBeVisible()
}

/** Relative luminance (0 = black, 1 = white) of an element's computed color property. */
async function luminance(
  locator: Locator,
  property: "color" | "backgroundColor" | "stroke" | "fill" = "color",
): Promise<number> {
  return await locator.evaluate((el, prop) => {
    // A canvas normalizes any CSS color syntax (oklch, color-mix …) to sRGB.
    const ctx = document.createElement("canvas").getContext("2d")!
    ctx.fillStyle = getComputedStyle(el)[prop]
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  }, property)
}

const textLuminance = (locator: Locator) => luminance(locator)

/** The document theme on every channel the CSS, the host and native controls read. */
async function documentTheme(app: FrameLocator) {
  return await app.locator("html").evaluate((html) => ({
    dark: html.classList.contains("dark"),
    dataTheme: html.getAttribute("data-theme"),
    colorScheme: getComputedStyle(html).colorScheme,
  }))
}

/** The last height the view reported to the host (the ext-apps `App`'s auto-resize). */
async function reportedHeight(page: Page): Promise<number> {
  return (await hostLog(page)).sizeChanges.at(-1)?.height ?? Number.NaN
}

/**
 * The height the view reported for what it renders NOW. The `App`'s
 * auto-resize reports one frame after a resize (ResizeObserver → rAF →
 * postMessage), so right after the content became visible the last report can
 * still be an earlier state's (the view's loading state), which would
 * satisfy any "small enough" bound by itself. Measure the document
 * exactly as the auto-resize does (`<html>` at max-content, rounded up) and
 * wait until the last report equals it.
 */
async function settledHeight(page: Page, app: FrameLocator): Promise<number> {
  const measured = () =>
    app.locator("html").evaluate((html) => {
      const saved = html.style.height
      html.style.height = "max-content"
      const height = Math.ceil(html.getBoundingClientRect().height)
      html.style.height = saved
      return height
    })
  let settled = Number.NaN
  await expect
    .poll(async () => {
      settled = await reportedHeight(page)
      return settled === (await measured())
    })
    .toBe(true)
  return settled
}

type DomNode = { nodeId: number; children?: DomNode[]; contentDocument?: DomNode }

/**
 * The fonts Chromium actually drew the text directly inside `locator` with
 * (CDP `CSS.getPlatformFontsForNode`), not the computed stack, which names
 * Geist first whether or not it loaded. The srcdoc view shares the page's
 * CDP session, so the probe pierces into the frame's document.
 */
async function renderedFonts(page: Page, locator: Locator): Promise<string[]> {
  const probe = `font-probe-${Math.random().toString(36).slice(2)}`
  await locator.evaluate((el, id) => el.setAttribute("data-font-probe", id), probe)
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send("DOM.enable")
    await cdp.send("CSS.enable")
    const { root } = (await cdp.send("DOM.getDocument", { depth: -1, pierce: true })) as {
      root: DomNode
    }
    const viewDocument = (node: DomNode): DomNode | undefined =>
      node.contentDocument ?? node.children?.map(viewDocument).find(Boolean)
    const view = viewDocument(root)
    if (!view) throw new Error("the view frame's document is not in the page's DOM tree")
    const { nodeId } = await cdp.send("DOM.querySelector", {
      nodeId: view.nodeId,
      selector: `[data-font-probe="${probe}"]`,
    })
    const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId })
    return fonts.map((font) => font.familyName)
  } finally {
    await cdp.detach()
  }
}

/** The view's Geist faces by family, with their load status (`loaded`, `error`, …). */
async function servedFaces(app: FrameLocator): Promise<Record<string, string>> {
  return await app
    .locator("html")
    .evaluate(() =>
      Object.fromEntries(
        [...document.fonts]
          .filter((face) => face.family.replaceAll('"', "").startsWith("Geist"))
          .map((face) => [face.family.replaceAll('"', ""), face.status]),
      ),
    )
}

/** Font loads the view sends to the server's font route, recorded from now on. */
function fontRequests(page: Page): string[] {
  const urls: string[] = []
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith(`${SERVED_FONT_PATH}/`)) urls.push(request.url())
  })
  return urls
}

/** What a font swap could move: the list's box, its first row, the document's overflow. */
async function listLayout(page: Page, app: FrameLocator) {
  const table = definitionsTable(app)
  const box = await table.boundingBox()
  const row = await table.getByRole("row").nth(1).boundingBox()
  const overflow = await app.locator("html").evaluate((html) => html.scrollWidth - html.clientWidth)
  return { table: box!, row: row!, overflow, reported: await settledHeight(page, app) }
}

/**
 * Shows every one-line NamedId of the view whole (its floor, `--named-id-floor`, at its text), so a
 * font probe reads the id's own glyphs, not the ellipsis a cut line draws in the line's font.
 */
async function wholeIdLines(app: FrameLocator): Promise<void> {
  await app
    .locator("body")
    .evaluate((body) =>
      body
        .querySelectorAll<HTMLElement>("[data-named-id='inline']")
        .forEach((line) => line.style.setProperty("--named-id-floor", "max-content")),
    )
}

/** `actual` within `tolerance` (a share, e.g. 0.05) of `expected`. */
function expectWithin(actual: number, expected: number, tolerance: number, label: string): void {
  expect(Math.abs(actual - expected), `${label}: ${actual} vs ${expected}`).toBeLessThanOrEqual(
    expected * tolerance,
  )
}

test.describe("real engine view (engine_open_cockpit, the overview)", () => {
  test("compliant host (structuredContent kept): renders from the notification, never re-executes", async ({
    page,
  }) => {
    const errors = collectErrors(page)
    const app = await openView(page)

    await expectOverview(app)
    // The tool's own view, picked by the name the document's prelude sets.
    // The server never titles a view (#322 U3): the widget's own heading is
    // the view's one title, in the host's language.
    await expect(app.getByRole("heading", { name: "All processes", exact: true })).toHaveCount(1)
    // Harness self-checks: the frame runs the served document
    // (its inline view config) with the view's name from the prelude,
    // sandboxed to an opaque origin, under the host's CSP (the first element
    // of <head>, ahead of every script).
    expect(
      await app.locator("html").evaluate(() => ({
        viewConfig: "__pulseViewConfig" in globalThis,
        view: (globalThis as { __pulseView?: unknown }).__pulseView,
        origin: window.origin,
        csp: document.head.firstElementChild?.getAttribute("http-equiv") ?? null,
      })),
    ).toEqual({
      viewConfig: true,
      view: RENDER_TOOL,
      origin: "null",
      csp: "Content-Security-Policy",
    })
    await waitForDelivery(page, "result")
    // Outlast the re-execution window: a conforming host never triggers a re-run.
    await page.waitForTimeout(OUTLAST_MS)

    const log = await hostLog(page)
    expect(await reExecutions(page)).toHaveLength(0)
    // The chat's own answer carries no "Reloaded at" line.
    await expect(app.getByText(CHROME.reloadedAt)).toHaveCount(0)
    // The provider stack works in the real bundle: the `App`'s auto-resize
    // reports the rendered height to the host.
    expect(await settledHeight(page, app)).toBeGreaterThan(200)
    expect(log.errors).toEqual([])
    // Nothing the served document needs is blocked by its own declared CSP,
    // and nothing throws …
    expect(errors).toEqual([])
    // … and that CSP is in force, so the empty list measured something: a
    // load it does not allow is refused (and logged, after the check above).
    expect(
      await app.locator("html").evaluate(
        () =>
          new Promise<string | null>((resolve) => {
            document.addEventListener(
              "securitypolicyviolation",
              (event) => resolve(event.effectiveDirective),
              { once: true },
            )
            new Image().src = "https://csp-probe.invalid/pixel.png"
            setTimeout(() => resolve(null), 2_000)
          }),
      ),
    ).toBe("img-src")
  })

  test("in-widget query: the server-side search refetches through the app-only feed", async ({
    page,
  }) => {
    // The path the vite `dedupe` (VIEW_BUNDLE_DEDUPE, CLAUDE.md invariant 4) protects: the
    // widget package's useToolQuery must see the shell's CallToolContext, or
    // every in-widget query hangs on its skeleton. The cockpit opens on the
    // realistic engine's instance list (160 instances, business keys to search).
    const app = await openView(page, {
      hostEnv: REALISTIC_HOST_ENV,
      args: { engine: REALISTIC_ENGINE, view: "process-instances" },
    })
    const rows = app.locator("tbody > tr")
    await expect(rows.first()).toBeVisible({ timeout: 15_000 })

    // Named by the placeholder's words, never the kit's generic "Filter".
    const search = app.getByRole("searchbox", { name: "Search by business key or ID" })
    const before = await rows.count()
    // The stub engine holds its answer to this search until the in-flight
    // state has been looked at: no timing window to race.
    const term = "CUST-120"
    await engineControl("hold", term)
    try {
      await search.fill(term)

      // While the search is in flight the list stays mounted with the
      // previous rows, and the operator keeps typing into the same, still
      // focused box (#341 N123) …
      const searched = async () =>
        (await hostLog(page)).toolCalls.some(
          (c) => c.name === "engine_process_instances_data" && c.arguments.search === term,
        )
      await expect.poll(searched, { timeout: 15_000 }).toBe(true)
      await expect(search).toBeFocused()
      await expect(search).toHaveValue(term)
      await expect(rows).toHaveCount(before)
      // … and SHOWS that they are not its answer yet: the rows are marked (an
      // info bar, no dimming) and busy, "Updating…" is visible, and no
      // "Showing … of" sits beside the new search.
      await expect(app.locator("[data-stale]")).toHaveAttribute("aria-busy", "true")
      await expect(app.locator('[data-stale] > [data-tone="info"]')).toHaveCount(1)
      await expect(app.getByText("Updating…")).toBeVisible()
      await expect(app.getByText(/Showing \d+ of/)).toHaveCount(0)
    } finally {
      await engineControl("release", term)
    }

    // Only the matching rows remain: every business key holds the term.
    await expect(app.locator("[data-stale]")).toHaveCount(0)
    await expect.poll(async () => (await rows.allTextContents()).length).toBeGreaterThan(0)
    await expect
      .poll(async () => (await rows.allTextContents()).every((text) => text.includes(term)))
      .toBe(true)
    // The count line states the filtered total, never the unfiltered one: the realistic engine
    // holds five CUST-120… business keys, and it counts the rows on screen.
    const countLine = app.getByText(/^Showing \d+ of 5 instances$/)
    await expect(countLine).toBeVisible()
    await expect
      .poll(
        async () =>
          (await countLine.textContent()) === `Showing ${await rows.count()} of 5 instances`,
      )
      .toBe(true)
    const feedCalls = (await hostLog(page)).toolCalls.filter(
      (c) => c.name === "engine_process_instances_data",
    )
    expect(feedCalls.at(-1)?.arguments).toMatchObject({ engine: REALISTIC_ENGINE, search: term })
  })

  test("stripping host (claude.ai behaviour): recovers via exactly one re-execution with the invocation's arguments", async ({
    page,
  }) => {
    const app = await openView(page, { structuredContent: "strip" })

    // With the "Reloaded at" line above it the view (545 px) still fits all three rows into the
    // unstated budget.
    await expectOverview(app)
    // The view loaded these figures itself, so they can differ from the
    // chat's answer: the frame's "Reloaded at" line says so.
    await expect(app.getByText(CHROME.reloadedAt)).toBeVisible()
    // The recovered render is the last event: a second recovery would land
    // inside this window.
    await page.waitForTimeout(OUTLAST_MS)
    expect(await reExecutions(page)).toEqual([
      { name: RENDER_TOOL, arguments: { engine: HEALTHY_ENGINE } },
    ])
  })

  test("a slow tool on a compliant host is never re-executed: the view waits for the host's result", async ({
    page,
  }) => {
    // The host holds the result for seconds: the check below runs at a
    // fixed point on the HOST's clock, so Playwright's poll lag cannot push
    // it past the delivery.
    const checkAfterMs = 3_000
    const app = await openView(page, { resultDelayMs: checkAfterMs + 3_500 })

    // The host is still running the tool: the view keeps waiting (the call
    // observer saw no stripped result) instead of loading the view itself.
    await expect(app.getByText(CHROME.loading)).toBeVisible({ timeout: 15_000 })
    const { initializedAt } = await hostLog(page)
    expect(initializedAt).not.toBeNull()
    await page.waitForFunction((at) => Date.now() >= at, (initializedAt ?? 0) + checkAfterMs)
    expect((await hostLog(page)).delivered).toBeNull()
    expect(await reExecutions(page)).toHaveLength(0)
    await expect(definitionsTable(app)).toHaveCount(0)

    // Rendered from the host's late delivery, once.
    await waitForDelivery(page, "result")
    await expectOverview(app)
    // The delivery is the last event; outlast a call it could cause.
    await page.waitForTimeout(OUTLAST_MS)
    await expect(definitionsTable(app)).toHaveCount(1)
    expect(await reExecutions(page)).toHaveLength(0)
    // The host's own answer: no "Reloaded at" line, which marks a payload
    // the view loaded itself.
    await expect(app.getByText(CHROME.reloadedAt)).toHaveCount(0)
  })

  test("a tool error is never re-executed: the error state with a retry replaces the skeleton", async ({
    page,
  }) => {
    const app = await openView(page, { args: { engine: BROKEN_ENGINE } })
    // The kit's words for the engine's 503 (describeError, U1): what
    // happened and what to do; the raw engine text only under "Details".
    const described = app.getByRole("heading", {
      name: `Engine ${BROKEN_ENGINE} is unreachable (HTTP 503)`,
    })

    await waitForDelivery(page, "result")
    const log = await hostLog(page)
    // A genuine isError result from the real server (engine 503).
    expect(log.originalResult?.isError).toBe(true)
    // Outlast the window twice over: a recovery that fired on an error
    // result would show as a re-execution.
    await page.waitForTimeout(2 * OUTLAST_MS)

    expect(await reExecutions(page)).toHaveLength(0)
    await expect(described).toBeVisible()
    await expect(
      app.getByText("Check that the engine is running, or pick another engine."),
    ).toBeVisible()
    const raw = app.getByText(/^\[503 ProcessEngineException\] Engine is shutting down/)
    await expect(raw).toBeHidden()
    await app.getByText("Details", { exact: true }).click()
    await expect(raw).toBeVisible()
    await expect(app.getByText("Loading view…")).toHaveCount(0)
    await expect(definitionsTable(app)).toHaveCount(0)

    // The retry is the user's: one call with the invocation's arguments, and
    // the engine still down brings the error state back, not a skeleton.
    await app.getByRole("button", { name: CHROME.retry }).click()
    await expect
      .poll(() => reExecutions(page))
      .toEqual([{ name: RENDER_TOOL, arguments: { engine: BROKEN_ENGINE } }])
    await expect(described).toBeVisible()
    await page.waitForTimeout(OUTLAST_MS)
    expect(await reExecutions(page)).toHaveLength(1)
  })

  test("cancelled call: shows the cancellation and never re-executes", async ({ page }) => {
    const app = await openView(page, { cancel: true })

    await waitForDelivery(page, "cancelled")
    await expect(app.getByText(CHROME.cancelled)).toBeVisible()
    await page.waitForTimeout(OUTLAST_MS)
    expect(await reExecutions(page)).toHaveLength(0)
    await expect(app.getByText(CHROME.cancelled)).toBeVisible()
  })

  test("dark host on a dark OS: dark theme tokens (light text)", async ({ page }) => {
    // The control for the pin below: proves the luminance probe sees dark mode.
    await page.emulateMedia({ colorScheme: "dark" })
    const app = await openView(page, { theme: "dark" })

    await expectOverview(app)
    expect(await textLuminance(definitionsTable(app).getByRole("row").nth(2))).toBeGreaterThan(0.5)
  })

  test(
    "dark host on a light OS: the host theme wins on every channel (#339, K41)",
    { annotation: { type: "issue", description: HOST_THEME_ISSUE } },
    async ({ page }, testInfo) => {
      const app = await openView(page, { theme: "dark" })

      await expectOverview(app)
      await testInfo.attach("dark-host-light-os", {
        body: await page.screenshot(),
        contentType: "image/png",
      })
      // One effective theme drives the tokens (`.dark`), what the host reads
      // (`data-theme`) and native controls (`color-scheme`) …
      expect(await documentTheme(app)).toEqual({
        dark: true,
        dataTheme: "dark",
        colorScheme: "dark",
      })
      // … so the text is light on the host's dark canvas, the view's title included.
      expect(await textLuminance(definitionsTable(app).getByRole("row").nth(2))).toBeGreaterThan(
        0.5,
      )
      expect(
        await textLuminance(app.getByRole("heading", { name: "All processes" }).first()),
      ).toBeGreaterThan(0.5)
    },
  )

  test("light host on a dark OS: the host theme wins the other way too", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" })
    const app = await openView(page, { theme: "light" })

    await expectOverview(app)
    expect(await documentTheme(app)).toEqual({
      dark: false,
      dataTheme: "light",
      colorScheme: "light",
    })
    expect(await textLuminance(definitionsTable(app).getByRole("row").nth(2))).toBeLessThan(0.5)
  })

  test("host without fullscreen: no Fullscreen button (the view gates it on availableDisplayModes)", async ({
    page,
  }) => {
    for (const displayModes of [["inline"], undefined]) {
      const app = await openView(page, { displayModes })

      await expectOverview(app)
      // The view itself stays.
      await expect(app.getByRole("heading", { name: "All processes" }).first()).toBeVisible()
      await expect(app.getByRole("button", { name: CHROME.enterFullscreen })).toHaveCount(0)
      expect((await hostLog(page)).displayModeRequests).toEqual([])
    }
  })

  test("host locale de-DE: a German view (#339)", async ({ page }) => {
    // The host's locale decides the view's language.
    const app = await openView(page, {
      locale: "de-DE",
      displayModes: ["inline", "fullscreen"],
      maxHeight: ONE_DEFINITION_BUDGET,
    })

    // The budget leaves room for one of the three (#396): the head, its row and the footer row
    // that says so in German.
    await expectGermanOverview(app, 1)
    // One German title and no English toolbar title over it: the server
    // never titles a view (#322 U3).
    await expect(app.getByRole("heading", { name: "Alle Prozesse", exact: true })).toHaveCount(1)
    await expect(app.getByRole("heading", { name: /All processes/i })).toHaveCount(0)
    // The view chrome (the frame's toolbar) follows the same locale.
    await expect(app.getByRole("button", { name: "Vollbild" })).toBeVisible()
    expect(await app.locator("html").getAttribute("lang")).toBe("de")
  })

  test("a slow handshake: nothing paints before the host context arrives, no English or OS-theme flash (#339)", async ({
    page,
  }) => {
    const app = await openView(page, { initDelayMs: 3_000, theme: "dark", locale: "de-DE" })

    await expect.poll(async () => (await hostLog(page)).initializeRequested).toBe(true)
    // Two seconds in, the host has not answered yet: the gate waits for the
    // host context, so the shell's document layer is still empty instead of
    // painting English on the OS theme, to flip a moment later.
    await page.waitForTimeout(2_000)
    const documentLayer = await app.locator("#root").evaluate((root) => ({
      children: root.firstElementChild?.childElementCount,
      text: root.textContent,
    }))
    expect(documentLayer).toEqual({ children: 0, text: "" })
    // Once the host answers: the German view on the host's dark theme, all three rows in the
    // unstated budget.
    await expectGermanOverview(app)
    expect(await documentTheme(app)).toEqual({ dark: true, dataTheme: "dark", colorScheme: "dark" })
  })

  test("host font: Geist first, then the host's --font-sans in the fallback slot", async ({
    page,
  }) => {
    const app = await openView(page, { fontSans: '"Host Sim Sans", serif' })

    await expectOverview(app)
    const fonts = await app.locator("body").evaluate((body) => {
      const mono = document.createElement("code")
      mono.className = "font-mono"
      mono.textContent = "a1b2c3"
      body.appendChild(mono)
      const result = {
        body: getComputedStyle(body).fontFamily,
        mono: getComputedStyle(mono).fontFamily,
        // The host's value moved off the role name (adoptHostFontVariables).
        roleInline: document.documentElement.style.getPropertyValue("--font-sans"),
        hostSlot: document.documentElement.style.getPropertyValue("--host-font-sans"),
      }
      mono.remove()
      return result
    })
    // The Miragon stack: Geist, then the host's font in the fallback slot,
    // then the system. The host no longer replaces the whole stack …
    expect(fonts.roleInline).toBe("")
    expect(fonts.hostSlot).toBe('"Host Sim Sans", serif')
    expect(fonts.body).toMatch(/^"?Geist"?,/)
    expect(fonts.body.indexOf("Host Sim Sans")).toBeGreaterThan(fonts.body.indexOf("Geist"))
    // … and ids name Geist Mono first, then a monospace stack.
    expect(fonts.mono).toMatch(/^"?Geist Mono"?,.*monospace/)
  })

  test("the served stylesheet inlines no font, sets no height floor and carries the vendored tokens (#339)", async ({
    page,
  }) => {
    const app = await openView(page)
    await expectOverview(app)

    const { css, faces } = await app.locator("html").evaluate(() => {
      const styles = [...document.querySelectorAll("style")]
      const served = styles.find((s) => s.id === "__miragon-served-fonts")
      return {
        css: styles
          .filter((s) => s !== served)
          .map((s) => s.textContent)
          .join("\n"),
        faces: served?.textContent ?? "",
      }
    })
    expect(css).not.toMatch(/font-family:[^;}]*!important/)
    expect(css).not.toMatch(/@font-face|data:font\/woff2/)
    expect(css).not.toMatch(/min-height:\s*600px/)
    // Geist arrives by URL from the server's font route, swap, never inlined.
    expect(faces.match(/@font-face/g)).toHaveLength(2)
    expect(faces).toContain(`${SERVED_FONT_PATH}/geist-latin-wght-normal.woff2`)
    expect(faces).toContain(`${SERVED_FONT_PATH}/geist-mono-latin-wght-normal.woff2`)
    expect(faces.match(/font-display: swap/g)).toHaveLength(2)
    expect(faces).not.toContain("data:")

    // Drift guard on the BUILT bundle: every Miragon colour token resolves to
    // the value pulse-ui vendors (normalized by a canvas, so a minified
    // `#fff` equals `#FFFFFF`): no fork, no stale copy.
    const tokens = vendoredColourTokens()
    expect(tokens.length).toBeGreaterThan(15)
    const drift = await app.locator("html").evaluate((html, expected) => {
      const ctx = document.createElement("canvas").getContext("2d")!
      const normalize = (colour: string) => {
        ctx.fillStyle = "#000000"
        ctx.fillStyle = colour.trim()
        return ctx.fillStyle
      }
      const style = getComputedStyle(html)
      return expected
        .filter(([name, value]) => normalize(style.getPropertyValue(name)) !== normalize(value))
        .map(([name]) => name)
    }, tokens)
    expect(drift).toEqual([])
  })

  test("a host height budget: the view scrolls inside it instead of reporting more", async ({
    page,
  }) => {
    const app = await openView(page, { maxHeight: 220 })

    await expectOverview(app, 3)
    // The shell's document layer is the scroll container, capped at the budget.
    const container = await app.locator("#root").evaluate((root) => {
      const el = root.firstElementChild as HTMLElement
      return {
        maxHeight: getComputedStyle(el).maxHeight,
        scrolls: el.scrollHeight > el.clientHeight,
        height: el.getBoundingClientRect().height,
      }
    })
    expect(container).toMatchObject({ maxHeight: "220px", scrolls: true })
    // The report belongs to the capped list (at least the container) and
    // stays inside the budget.
    const reported = await settledHeight(page, app)
    expect(reported).toBeGreaterThanOrEqual(Math.floor(container.height))
    expect(reported).toBeLessThanOrEqual(220)
  })

  // #396: a list view fits a usual budget as a card. It never turns into one
  // scroll box inside the chat (the 220 px case above is the safety net).
  test("a 600 px budget: the list view fits as a card, without a scroll of its own", async ({
    page,
  }) => {
    const app = await openView(page, { args: JOBS_ARGS, maxHeight: 600 })

    await expectJobs(app, 10)
    const container = await app.locator("#root").evaluate((root) => {
      const el = root.firstElementChild as HTMLElement
      return { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }
    })
    expect(container.scrollHeight).toBeLessThanOrEqual(container.clientHeight)
  })

  test("an inline view reports its own height, below the old 600 px floor (#339, K40)", async ({
    page,
  }) => {
    const app = await openView(page, { args: JOBS_ARGS })

    await expectJobs(app, 10)
    // The old html/body/#root floor reported 600 for every view. `settledHeight`
    // waits for the report that equals the content's max-content height.
    const reported = await settledHeight(page, app)
    expect(reported).toBeLessThan(600)
    expect(reported).toBeGreaterThan(200)
  })

  test("host with fullscreen: the toggle requests it and follows the host's switch", async ({
    page,
  }) => {
    const app = await openView(page, {
      displayModes: ["inline", "fullscreen"],
      maxHeight: ONE_DEFINITION_BUDGET,
    })

    // Inline, the toggle's bar above the view leaves this budget room for one row.
    await expectOverview(app, 1)
    await app.getByRole("button", { name: CHROME.enterFullscreen }).click()

    await expect.poll(async () => (await hostLog(page)).displayModeRequests).toEqual(["fullscreen"])
    await expect(app.getByRole("button", { name: CHROME.exitFullscreen })).toBeVisible()
    // Fullscreen fits nothing: every row shows.
    await expectOverview(app, 3)
  })
})

/**
 * Geist and Geist Mono come from the server's own font route, admitted by the
 * view's CSP (`resourceDomains`). Where they cannot arrive, the host's font
 * renders, at once (`font-display: swap`) and without moving the layout.
 */
test.describe("served fonts (Geist from the server's font route)", () => {
  /** The name of the first definition (body text) and its key (an id, `font-mono`). */
  const nameCell = (app: FrameLocator) => app.getByText("Customer Onboarding", { exact: true })
  const keyCell = (app: FrameLocator) => app.getByText("customer-onboarding", { exact: true })

  /**
   * What the text of `locator` renders in WITHOUT Geist: a twin with the same
   * text and size in the element's stack minus its Geist entries: the host's
   * font where the host sent one, else the system's.
   */
  async function fallbackFonts(page: Page, app: FrameLocator, locator: Locator) {
    const id = await locator.evaluate((el) => {
      const style = getComputedStyle(el)
      const twin = document.createElement("span")
      twin.id = `fallback-${Math.random().toString(36).slice(2)}`
      twin.textContent = el.textContent
      twin.style.fontFamily = style.fontFamily
        .split(",")
        .filter((family) => !/geist/i.test(family))
        .join(",")
      twin.style.fontSize = style.fontSize
      twin.style.fontWeight = style.fontWeight
      // Beside the text in its cell, never inside a line that truncates: an ellipsis there
      // would draw in the line's own font.
      ;(el.closest("td") ?? el.parentElement!).appendChild(twin)
      return twin.id
    })
    const twin = app.locator(`#${id}`)
    try {
      return await renderedFonts(page, twin)
    } finally {
      await twin.evaluate((el) => el.remove())
    }
  }

  test("fonts allowed: body text renders in Geist and ids in Geist Mono, loaded once from the font route", async ({
    page,
  }) => {
    const errors = collectErrors(page)
    const requests = fontRequests(page)
    const app = await openView(page)
    await expectOverview(app)

    await expect
      .poll(() => servedFaces(app), { timeout: 15_000 })
      .toEqual({ Geist: "loaded", "Geist Mono": "loaded" })
    // What Chromium drew the text with, not just the stack it was given (the whole line, so no
    // ellipsis draws in the line's font).
    await wholeIdLines(app)
    expect(await renderedFonts(page, nameCell(app))).toEqual(["Geist"])
    expect(await renderedFonts(page, keyCell(app))).toEqual(["Geist Mono"])
    // Each file once, from the server that served the view, by its versioned URL.
    expect(requests.map((url) => new URL(url).pathname).sort()).toEqual([
      `${SERVED_FONT_PATH}/geist-latin-wght-normal.woff2`,
      `${SERVED_FONT_PATH}/geist-mono-latin-wght-normal.woff2`,
    ])
    expect(errors).toEqual([])
  })

  test("a host that ignores resourceDomains: the host's font renders, and the layout holds", async ({
    page,
  }) => {
    const fontSans = '"Host Sim Sans", serif'
    // A budget every row fits under either font, so the two layouts hold the same rows.
    const allowed = await openView(page, { fontSans, maxHeight: 1000 })
    await expectOverview(allowed, 3)
    await expect
      .poll(() => servedFaces(allowed), { timeout: 15_000 })
      .toEqual({ Geist: "loaded", "Geist Mono": "loaded" })
    const withGeist = await listLayout(page, allowed)

    const errors = collectErrors(page)
    const blocked = await openView(page, { fontSans, ignoreResourceDomains: true, maxHeight: 1000 })
    await expectOverview(blocked, 3)
    // The CSP refuses both files; the faces fail instead of hanging.
    await expect
      .poll(() => servedFaces(blocked), { timeout: 15_000 })
      .toEqual({ Geist: "error", "Geist Mono": "error" })
    const withoutGeist = await listLayout(page, blocked)
    await wholeIdLines(blocked)
    const name = await renderedFonts(page, nameCell(blocked))
    expect(name).not.toContain("Geist")
    expect(name).toEqual(await fallbackFonts(page, blocked, nameCell(blocked)))
    const key = await renderedFonts(page, keyCell(blocked))
    expect(key).not.toContain("Geist Mono")
    expect(key).toEqual(await fallbackFonts(page, blocked, keyCell(blocked)))

    // The fallback moves nothing that matters: same rows, same height within
    // tolerance, no horizontal overflow either way.
    expect(withGeist.overflow).toBeLessThanOrEqual(0)
    expect(withoutGeist.overflow).toBeLessThanOrEqual(0)
    expectWithin(withoutGeist.row.height, withGeist.row.height, 0.05, "first row height")
    expectWithin(withoutGeist.table.height, withGeist.table.height, 0.05, "table height")
    expectWithin(withoutGeist.reported, withGeist.reported, 0.05, "reported view height")
    // The only complaints are the refused font loads.
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.filter((line) => !/font/i.test(line))).toEqual([])
  })

  test("a font route the browser cannot reach: the view paints at once in the fallback (swap)", async ({
    page,
  }) => {
    // Held, never answered: nothing may wait for the files.
    await page.route(`**${SERVED_FONT_PATH}/**`, () => {})
    const app = await openView(page)
    await expectOverview(app)

    expect(await servedFaces(app)).toEqual({ Geist: "loading", "Geist Mono": "loading" })
    const name = await renderedFonts(page, nameCell(app))
    expect(name).not.toContain("Geist")
    expect(name).toEqual(await fallbackFonts(page, app, nameCell(app)))
  })
})

test.describe("real BPMN view (engine_open_cockpit, a process)", () => {
  test("dark host: a light canvas keeps flows and labels readable, the logo clear of the zoom controls (#339, N122/N129)", async ({
    page,
  }, testInfo) => {
    const app = await openView(page, {
      args: { engine: HEALTHY_ENGINE, view: "process-detail", processDefinitionKey: "invoice" },
      theme: "dark",
    })

    const canvas = app.getByRole("img", { name: "BPMN process diagram" })
    // Four sequence flows of the fixture diagram rendered.
    await expect(canvas.locator(".djs-connection")).toHaveCount(4, { timeout: 15_000 })
    await testInfo.attach("bpmn-dark-host", {
      body: await page.screenshot(),
      contentType: "image/png",
    })
    expect((await documentTheme(app)).dark).toBe(true)

    // The canvas is light in a dark theme; bpmn-js's near-black strokes and
    // labels sit on it, not on the dark card.
    expect(await luminance(canvas, "backgroundColor")).toBeGreaterThan(0.95)
    expect(await luminance(canvas.locator(".djs-connection path").first(), "stroke")).toBeLessThan(
      0.25,
    )
    expect(
      await luminance(canvas.locator("text.djs-label").first(), "fill"),
      "external labels (events, gateway, flow names) must stay dark on the light canvas",
    ).toBeLessThan(0.25)

    // The bpmn.io logo stays (a bpmn-js licence term) but no longer covers a
    // zoom button: a click on each button's centre reaches the button.
    const logo = app.locator(".bjs-powered-by")
    await expect(logo).toBeVisible()
    for (const name of ["Zoom in", "Fit to viewport", "Zoom out"]) {
      const button = app.getByRole("button", { name })
      const hit = await button.evaluate((el) => {
        const r = el.getBoundingClientRect()
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        return top !== null && el.contains(top)
      })
      expect(hit, `${name} is covered`).toBe(true)
    }
  })

  // The flow's "Running" end to end: the server's real feed against the stub's statistics, its
  // count on the built diagram and the values under it.
  test("the process flow shows what runs at each element now, read from the engine", async ({
    page,
  }) => {
    const app = await openView(page, {
      args: { engine: HEALTHY_ENGINE, view: "process-detail", processDefinitionKey: "invoice" },
    })
    const modes = app.getByRole("radiogroup", { name: "Process flow display" })
    await expect(modes).toBeVisible({ timeout: 15_000 })
    // No other module's mode: the flow offers what the engine reads, nothing to probe.
    await expect(modes.getByRole("radio")).toHaveText([
      "Incidents",
      "Running",
      "Throughput · 30 days",
    ])
    await modes.getByRole("radio", { name: "Running" }).click()

    await expect(
      app.getByText("diagram v3 (latest) · running now, counts span 1 version"),
    ).toBeVisible({
      timeout: 15_000,
    })
    const canvas = app.getByRole("img", { name: "BPMN process diagram" })
    await expect(canvas.locator(".djs-connection")).toHaveCount(4, { timeout: 15_000 })
    // The two instances at approveInvoice, as a badge on that element.
    await expect(app.locator(".bpmn-overlay-badge--instance-count")).toHaveText(["2"])

    await app.getByText("Values per activity").click()
    const values = app.getByRole("region", { name: "Values per activity" })
    await expect(values.getByRole("row")).toHaveCount(2)
    await expect(values.getByRole("row").nth(1)).toContainText("Approve Invoice")
    await expect(values.getByRole("row").nth(1)).toContainText("approveInvoice")
  })

  // The flow's "Throughput" end to end: the real feed's history reads against the stub, the heat
  // painted in the theme's ramp on the built diagram, and the values under it.
  test("the process flow paints what the last 30 days' instances passed, read from the history", async ({
    page,
  }) => {
    const app = await openView(page, {
      args: { engine: HEALTHY_ENGINE, view: "process-detail", processDefinitionKey: "invoice" },
    })
    const modes = app.getByRole("radiogroup", { name: "Process flow display" })
    await expect(modes).toBeVisible({ timeout: 15_000 })
    await modes.getByRole("radio", { name: "Throughput · 30 days" }).click()

    await expect(
      app.getByText(/^diagram v3 \(latest\) · 12 instances started since .+, on 1 version$/),
    ).toBeVisible({ timeout: 15_000 })
    const heat = app.getByRole("img", { name: "BPMN process diagram with the throughput as heat" })
    await expect(heat.locator(".djs-connection")).toHaveCount(4, { timeout: 15_000 })
    await expect(
      app.getByText(/Read from the engine's history \(history level activity or higher\)/),
    ).toBeVisible()
    // The layer took its ramp from the theme's --cd-* variables: something is painted.
    const painted = app.locator("canvas[aria-hidden='true']")
    await expect
      .poll(() =>
        painted.evaluate((canvas: HTMLCanvasElement) => {
          const pixels = canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height)
          return pixels ? pixels.data.some((value, i) => i % 4 === 3 && value > 0) : false
        }),
      )
      .toBe(true)

    await app.getByText("Values per activity").click()
    const values = app.getByRole("region", { name: "Values per activity" })
    // Most passed first: the twelve started; approveInvoice passed ten, and two still wait there.
    await expect(values.getByRole("row").nth(1)).toContainText("Invoice received")
    await expect(values.getByRole("row").nth(1)).toContainText("12")
    await expect(values.getByRole("row").nth(2)).toContainText("Approve Invoice")
    await expect(values.getByRole("row").nth(2).getByRole("cell").nth(1)).toHaveText("10")
    await expect(values.getByRole("row").nth(2).getByRole("cell").nth(2)).toHaveText("2")
  })
})

/**
 * The kit's design-system foundation in the BUILT bundle (#322): the Miragon
 * role variables reach the view (pulse-ui's theme survived Tailwind), Lucide
 * icons draw at the CI stroke through lucide-react's own strokeWidth, never a
 * CSS rule (2.5; 2 in dense rows and the view frame's toolbar, whose
 * dense icon sets it), and a KPI's state is a tinted, edged card around
 * neutral digits, never a coloured number.
 */
test.describe("kit foundation (engine_open_cockpit, the jobs)", () => {
  test("a row holding an id is the row height: 28 px, 40 px comfortable", async ({ page }) => {
    // Wide enough for the Instance column (hidden below 64rem), so a row holds its id's copy button.
    const app = await openView(page, { args: JOBS_ARGS, width: 1100, maxHeight: 900 })
    const region = app.getByRole("region", { name: "Jobs", exact: true })
    await expect(region).toBeVisible({ timeout: 15_000 })
    const heights = await region.evaluate((el) => {
      const row = el.querySelector<HTMLTableRowElement>("tbody tr")!
      const copy = row.querySelector<HTMLElement>("button[aria-label^='Copy']")
      // The row's actions are 28 px controls with the cell's padding around them, which make the
      // row taller on their own: out of the measure, so it reads what the id's cell asks for.
      for (const action of row.lastElementChild!.children) {
        ;(action as HTMLElement).style.display = "none"
      }
      const root = document.documentElement
      const rowHeight = () => ({
        row: row.getBoundingClientRect().height,
        role: parseFloat(getComputedStyle(row).getPropertyValue("--row-h")) * 16,
        copy: copy?.getBoundingClientRect().height,
      })
      const compact = rowHeight()
      root.setAttribute("data-density", "comfortable")
      const comfortable = rowHeight()
      root.removeAttribute("data-density")
      return { shown: !!copy && copy.offsetParent !== null, compact, comfortable }
    })
    expect(heights.shown, "the row holds an id's copy button").toBe(true)
    // The 24 px copy button (32 px comfortable) reaches into the cell's padding: the row keeps
    // the row height, and a one-line row is exactly it.
    expect(heights.compact).toEqual({ row: 28, role: 28, copy: 24 })
    expect(heights.comfortable).toEqual({ row: 40, role: 40, copy: 32 })
  })

  test("role variables, Lucide strokes and the tone model reach the rendered view", async ({
    page,
  }) => {
    const app = await openView(page, {
      args: JOBS_ARGS,
      displayModes: ["inline", "fullscreen"],
    })
    const handOff = app.getByRole("button", { name: "Assess in chat" })
    await expect(handOff).toBeVisible({ timeout: 15_000 })

    const roles = await app.locator("html").evaluate((el) => {
      const style = getComputedStyle(el)
      return [
        "--danger-ink",
        "--warning-ink",
        "--success-ink",
        "--info-ink",
        "--link",
        "--focus",
        "--primary-hover",
        "--scrim",
      ].map((name) => style.getPropertyValue(name).trim())
    })
    for (const value of roles) expect(value).not.toBe("")
    // The Miragon brand, not the shadcn neutrals: links in --cd-blau-link.
    const link = await app.locator("html").evaluate((el) => {
      const ctx = document.createElement("canvas").getContext("2d")!
      ctx.fillStyle = getComputedStyle(el).getPropertyValue("--link").trim()
      return ctx.fillStyle
    })
    expect(link).toBe("#2b50d4")

    const stroke = (locator: Locator) => locator.evaluate((el) => getComputedStyle(el).strokeWidth)
    // The CI stroke at every size: 2.5, the 16 px icons of a row's and the frame's 28 px icon
    // buttons included (no narrower stroke for dense chrome).
    expect(await stroke(handOff.locator("svg.lucide"))).toBe("2.5px")
    const rowMenu = app
      .getByRole("button", { name: /^More actions for / })
      .first()
      .locator("svg.lucide")
    expect(await stroke(rowMenu)).toBe("2.5px")
    expect(await rowMenu.getAttribute("width")).toBe("16")
    const fullscreen = app.locator("svg.lucide-maximize-2")
    expect(await stroke(fullscreen)).toBe("2.5px")
    expect(await fullscreen.getAttribute("width")).toBe("16")
    // No glyph icon anywhere in the view.
    expect(await app.locator("body").innerText()).not.toMatch(/[✦⊡▦↗›⚠⚙⏱⤧▶✓✕▤⊞↻]/)

    const blocked = app.locator('[data-tone="danger"]').first()
    await expect(blocked).toBeVisible()
    const card = await blocked.evaluate((el) => {
      const style = getComputedStyle(el)
      // pulse-ui's KpiGrid: the figure on the type scale's section step (the compact tile).
      const digits = getComputedStyle(el.querySelector(".text-section")!)
      const page = getComputedStyle(document.body)
      return {
        edge: style.borderTopColor,
        tint: style.backgroundColor,
        pageBackground: page.backgroundColor,
        digits: digits.color,
        digitSize: digits.fontSize,
        foreground: page.color,
      }
    })
    expect(card.edge).not.toBe("rgba(0, 0, 0, 0)")
    expect(card.edge).not.toBe(card.foreground)
    expect(card.tint, "the state is the card's tint").not.toBe(card.pageBackground)
    expect(card.digits, "a KPI number stays neutral").toBe(card.foreground)
    expect(card.digitSize, "a KPI figure is the CI section size (21 px), the compact tile").toBe(
      "21px",
    )
  })

  test("forced colours: the current section keeps a Highlight ring, a status dot turns CanvasText, an outline marks focus only", async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors: "active" })
    const app = await openView(page)
    await expectOverview(app)
    await expect(
      app.getByRole("navigation", { name: "Cockpit sections" }).locator('[aria-current="page"]'),
    ).toBeVisible()

    const seen = await app.locator("html").evaluate(() => {
      // The system colours as this browser resolves them, from a probe of each.
      const system = (colour: string) => {
        const probe = document.createElement("i")
        probe.style.color = colour
        document.body.append(probe)
        const value = getComputedStyle(probe).color
        probe.remove()
        return value
      }
      const section = getComputedStyle(document.querySelector('nav button[aria-current="page"]')!)
      const dot = document.querySelector(
        ".bg-success, .bg-warning, .bg-danger, .bg-info, .bg-muted-foreground",
      )!
      return {
        canvas: system("Canvas"),
        canvasText: system("CanvasText"),
        highlight: system("Highlight"),
        ring: `${section.outlineStyle} ${section.outlineColor}`,
        dot: getComputedStyle(dot).backgroundColor,
      }
    })
    // Its fill alone marked the current section; forced colours paint every fill Canvas.
    expect(seen.ring).toBe(`solid ${seen.highlight}`)
    expect(seen.dot).toBe(seen.canvasText)
    expect(seen.dot).not.toBe(seen.canvas)

    // The kit's focus ring is a shadow, which forced colours drop: its outline carries focus
    // there, drawn only while focus is visible, so no control wears a frame at rest.
    const jobs = app
      .getByRole("navigation", { name: "Cockpit sections" })
      .getByRole("button", { name: "Jobs" })
    const outline = () =>
      jobs.evaluate((el) => {
        const style = getComputedStyle(el)
        return {
          style: style.outlineStyle,
          width: parseFloat(style.outlineWidth),
          color: style.outlineColor,
        }
      })
    expect((await outline()).style, "a control at rest draws no outline").toBe("none")
    await jobs.focus()
    await page.keyboard.press("Shift+Tab")
    await page.keyboard.press("Tab")
    await expect(jobs).toBeFocused()
    const focused = await outline()
    expect(focused.style, "a control keyboard focus reaches draws an outline").not.toBe("none")
    expect(focused.width).toBeGreaterThanOrEqual(2)
    expect(focused.color, "in a system colour, never transparent").not.toBe("rgba(0, 0, 0, 0)")
  })

  test("high contrast (data-cd-kontrast): no shadows, a 3 px focus ring", async ({ page }) => {
    const app = await openView(page, { args: JOBS_ARGS })
    await expectJobs(app, 10)
    const current = app
      .getByRole("navigation", { name: "Cockpit sections" })
      .getByRole("button", { name: "Jobs" })
    /**
     * The focused section's ring: a line tab of the head's bar draws it inside (the kit's inset
     * ring, so the bar's edge never cuts it), its spread the focus width alone.
     */
    const ringReach = async () => {
      await current.focus()
      return await current.evaluate((el) => {
        const shadow = getComputedStyle(el).boxShadow
        const spreads = [...shadow.matchAll(/0px 0px 0px (\d+)px inset/g)]
        return Math.max(...spreads.map((spread) => Number(spread[1])))
      })
    }

    expect(await ringReach()).toBe(2)
    await app.locator("html").evaluate((html) => html.setAttribute("data-cd-kontrast", "hoch"))
    expect(await ringReach()).toBe(3)
    const shadows = await app
      .locator("html")
      .evaluate((html) =>
        ["--shadow-1", "--shadow-2", "--shadow-3"].map((name) =>
          getComputedStyle(html).getPropertyValue(name).trim(),
        ),
      )
    expect(shadows).toEqual(["0 0 transparent", "0 0 transparent", "0 0 transparent"])
  })
})

/** The inline width a chat column gives a view (the before-shots' 760 px frame). */
const INLINE_WIDTH = 760

/** A frame narrow enough that the job table is wider than its region. */
const NARROW_WIDTH = 420

/**
 * Screenshots of the four 4 px strips just inside an element's box (top,
 * bottom, left, right), each without the corners: a focus indicator drawn
 * inside the box changes them along their whole length; one a clipping
 * wrapper cut away changes none, and one the pinned action column paints
 * over leaves the right side (and that column's stretch of the top and
 * bottom) unchanged (see {@link changedShare}).
 */
async function edgeStrips(page: Page, target: Locator): Promise<Buffer[]> {
  const box = await target.boundingBox()
  const table = await target.locator("table").boundingBox()
  if (!box || !table) throw new Error("the element has no box")
  // The box as the browser paints it: snapped to whole pixels.
  const left = Math.round(box.x)
  const top = Math.round(box.y)
  const right = Math.round(box.x + box.width)
  const bottom = Math.round(box.y + box.height)
  const band = 4
  const corner = 8
  // The sides along the table's rows only: below them a scrollbar may run,
  // which a ring under the pinned column would still change.
  const sideEnd = Math.min(bottom, Math.round(table.y + table.height)) - corner
  const strips = [
    { x: left + corner, y: top, width: right - left - 2 * corner, height: band },
    { x: left + corner, y: bottom - band, width: right - left - 2 * corner, height: band },
    { x: left, y: top + corner, width: band, height: sideEnd - top - corner },
    { x: right - band, y: top + corner, width: band, height: sideEnd - top - corner },
  ]
  return await Promise.all(strips.map((clip) => page.screenshot({ clip })))
}

/**
 * The share of a strip's length the focus changed: of its columns (`"x"`, a
 * top or bottom strip) or rows (`"y"`, a side), those with a pixel that
 * differs clearly between the two shots. The browser decodes the PNGs, so
 * the check needs no image library; a ring a positioned cell covers in part
 * leaves that part unchanged.
 */
async function changedShare(
  page: Page,
  before: Buffer,
  after: Buffer,
  along: "x" | "y",
): Promise<number> {
  return await page.evaluate(
    async ({ a, b, along }) => {
      const decode = async (base64: string) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
        const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }))
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
        const context = canvas.getContext("2d")!
        context.drawImage(bitmap, 0, 0)
        return context.getImageData(0, 0, bitmap.width, bitmap.height)
      }
      const [shotA, shotB] = await Promise.all([decode(a), decode(b)])
      const lines = along === "x" ? shotA.width : shotA.height
      const across = along === "x" ? shotA.height : shotA.width
      let changed = 0
      for (let line = 0; line < lines; line++) {
        for (let step = 0; step < across; step++) {
          const [x, y] = along === "x" ? [line, step] : [step, line]
          const k = (y * shotA.width + x) * 4
          const diff =
            Math.abs(shotA.data[k] - shotB.data[k]) +
            Math.abs(shotA.data[k + 1] - shotB.data[k + 1]) +
            Math.abs(shotA.data[k + 2] - shotB.data[k + 2])
          if (diff > 60) {
            changed++
            break
          }
        }
      }
      return changed / lines
    },
    { a: before.toString("base64"), b: after.toString("base64"), along },
  )
}

/** Whether the view's own document scrolls sideways (a table that widened it). */
async function documentOverflow(app: FrameLocator) {
  return await app.locator("html").evaluate((html) => ({
    scrollWidth: html.scrollWidth,
    clientWidth: html.clientWidth,
  }))
}

test.describe("layout at the inline width (760 px, U2/U20, WCAG 1.4.10)", () => {
  test("the overview: no horizontal document scroll, the table in a named region", async ({
    page,
  }) => {
    const app = await openView(page, { width: INLINE_WIDTH })
    // At 760 px the unstated budget fits all three (472 px).
    await expectOverview(app, 3)
    const { scrollWidth, clientWidth } = await documentOverflow(app)
    expect(scrollWidth, "the document never scrolls sideways").toBeLessThanOrEqual(clientWidth)
    const region = app.getByRole("region", { name: DEFINITIONS_TABLE })
    await expect(region).toBeVisible()
    expect(await region.getAttribute("tabindex")).toBe("0")
    // The shell pads nothing: the head's and the view's bars run from edge to edge, the gutter of
    // the density roles (12 px, --cd-shell-rand) inside the view's bar and around each route's
    // content. The list's filter bar under its heading reaches the card's edges too, its field
    // in the gutter, on the content's edge.
    const frame = await app
      .locator('[data-slot="widget-shell"]')
      .first()
      .evaluate((shell) => {
        const box = shell.getBoundingClientRect()
        const span = (selector: string) =>
          [...shell.querySelectorAll<HTMLElement>(selector)].map((bar) => {
            const own = bar.getBoundingClientRect()
            return { left: own.left - box.left, right: box.right - own.right }
          })
        const pad = (el: Element) => getComputedStyle(el).paddingLeft
        return {
          padding: getComputedStyle(shell).paddingLeft,
          bars: span('[data-slot="cockpit-head"], [data-slot="view-bar"]'),
          barInsets: [...shell.querySelectorAll('[data-slot="view-bar"] > div')].map(pad),
          headInsets: [...shell.querySelectorAll('[data-slot="cockpit-head"]')].map(
            (head) => `${pad(head)} ${getComputedStyle(head).paddingRight}`,
          ),
          contents: [...shell.querySelectorAll('[data-slot="widget-content"].px-gutter')].map(pad),
          toolbars: span('[data-slot="toolbar"]'),
          fields: [
            ...shell.querySelectorAll('[data-slot="toolbar"] [data-slot="search-field"]'),
          ].map((field) => field.getBoundingClientRect().left - box.left),
        }
      })
    expect(frame.padding).toBe("0px")
    expect(frame.bars).toHaveLength(2)
    for (const bar of frame.bars) expect(bar).toEqual({ left: 0, right: 0 })
    expect(frame.barInsets).toEqual(["12px"])
    // The head's tabs start 8 px in, as a view's tab bar does; its end sits in the gutter.
    expect(frame.headInsets).toEqual(["8px 12px"])
    expect(frame.contents.length).toBeGreaterThan(0)
    for (const padding of frame.contents) expect(padding).toBe("12px")
    expect(frame.toolbars).toEqual([{ left: 0, right: 0 }])
    expect(frame.fields).toEqual([12])
  })

  test("the job panel: low-priority columns hide, the row actions stay pinned and reachable", async ({
    page,
  }) => {
    const app = await openView(page, { args: JOBS_ARGS, width: INLINE_WIDTH })
    const region = app.getByRole("region", { name: "Jobs", exact: true })
    await expect(region).toBeVisible({ timeout: 15_000 })
    const { scrollWidth, clientWidth } = await documentOverflow(app)
    expect(scrollWidth, "the document never scrolls sideways").toBeLessThanOrEqual(clientWidth)

    const layout = await region.evaluate((el) => {
      const head = el.querySelectorAll("thead th")
      const last = head[head.length - 1]
      const created = head[head.length - 2]
      const rowAction = el.querySelector("tbody tr > :last-child")
      return {
        createdDisplay: getComputedStyle(created).display,
        stickyHead: getComputedStyle(last).position,
        stickyCell: rowAction ? getComputedStyle(rowAction).position : "",
        actionRight: rowAction ? rowAction.getBoundingClientRect().right : 0,
        regionRight: el.getBoundingClientRect().right,
      }
    })
    expect(layout.createdDisplay, "the Created column hides below 768 px").toBe("none")
    expect(layout.stickyHead).toBe("sticky")
    expect(layout.stickyCell).toBe("sticky")
    // The action column ends inside the region, never past its right edge.
    expect(layout.actionRight).toBeLessThanOrEqual(layout.regionRight + 1)
  })

  test("a hovered row of a table with pinned actions fills from --accent, its pinned cell too", async ({
    page,
  }) => {
    const app = await openView(page, { args: JOBS_ARGS, width: INLINE_WIDTH })
    const region = app.getByRole("region", { name: "Jobs", exact: true })
    await expect(region).toBeVisible({ timeout: 15_000 })
    const hovered = region.locator("tbody tr").nth(1)
    await hovered.hover()
    const paint = () =>
      region.evaluate((el) => {
        const role = (name: string) => {
          const probe = document.createElement("div")
          probe.style.backgroundColor = `var(${name})`
          document.body.append(probe)
          const colour = getComputedStyle(probe).backgroundColor
          probe.remove()
          return colour
        }
        const [first, second] = [...el.querySelectorAll("tbody tr")]
        const fill = (row: Element) => ({
          row: getComputedStyle(row).backgroundColor,
          pinned: getComputedStyle(row.lastElementChild!).backgroundColor,
          position: getComputedStyle(row.lastElementChild!).position,
        })
        return {
          accent: role("--accent"),
          card: role("--card"),
          rest: fill(first),
          hovered: fill(second),
        }
      })
    // The row's colour eases in (transition-colors): read it once it has arrived.
    await expect
      .poll(async () => {
        const now = await paint()
        return now.hovered.row === now.accent
      })
      .toBe(true)
    const settled = await paint()
    expect(settled.accent).not.toBe(settled.card)
    // The hover fill wins over the pinned rows' surface, which sits in a lower cascade layer.
    expect(settled.hovered).toEqual({
      row: settled.accent,
      pinned: settled.accent,
      position: "sticky",
    })
    // A row at rest paints the table's surface, so its pinned cell covers what scrolls under it.
    expect(settled.rest).toEqual({ row: settled.card, pinned: settled.card, position: "sticky" })
  })

  test("a row's menu lies over the next rows' pinned cells: its entries take the clicks (U20)", async ({
    page,
  }) => {
    // The cockpit's head and the KPI strip leave room for seven rows at the default 600 px fit
    // (#396): an 800 px budget fits all twelve jobs, so a middle row has a row under it.
    const app = await openView(page, { args: JOBS_ARGS, width: INLINE_WIDTH, maxHeight: 800 })
    await expectJobs(app, 12)
    // The stub's job-2 (never written), with job-3's row under it.
    const row = app.getByRole("row").filter({ hasText: "Card expired" })
    const next = app.getByRole("row").filter({ hasText: "Billing address unknown" })
    await expect(row).toBeVisible({ timeout: 15_000 })
    const more = row.getByRole("button", { name: /^More actions for / })
    expect(await more.getAttribute("aria-haspopup")).toBe("menu")
    await more.click()
    const menu = app.getByRole("menu")
    const items = menu.getByRole("menuitem")
    await expect(items).toHaveCount(2)

    // It opened downward, over the next row and its pinned action cell.
    const [menuBox, nextBox] = await Promise.all([menu.boundingBox(), next.boundingBox()])
    expect(menuBox && nextBox && menuBox.y + menuBox.height > nextBox.y + 4).toBe(true)
    // Every point of every entry is the entry's own: none is painted under a cell.
    const hits = await menu.evaluate((el) =>
      [...el.querySelectorAll('[role="menuitem"]')].flatMap((item) => {
        const box = item.getBoundingClientRect()
        return [0.1, 0.5, 0.9].map((share) => {
          const hit = document.elementFromPoint(
            box.left + box.width * share,
            box.top + box.height / 2,
          )
          return item.contains(hit) ? "entry" : `${hit?.tagName ?? "nothing"} ${hit?.textContent}`
        })
      }),
    )
    expect(hits, "a click on an entry reaches the entry").toEqual(hits.map(() => "entry"))

    // The keyboard: the focus starts on the first entry, the arrows move it,
    // Escape closes the menu and returns the focus to its button.
    await expect(items.first()).toBeFocused()
    await page.keyboard.press("ArrowDown")
    await expect(items.nth(1)).toBeFocused()
    await page.keyboard.press("Escape")
    await expect(menu).toHaveCount(0)
    await expect(more).toBeFocused()

    // A click runs the entry (the hand-off goes to the chat) and closes the menu.
    await more.click()
    await menu.getByRole("menuitem", { name: "Draft ticket in chat" }).click()
    await expect(menu).toHaveCount(0)
    expect((await hostLog(page)).methods).toContain("ui/message")
  })

  test("a table wider than its region scrolls inside it: its last column comes into view", async ({
    page,
  }) => {
    const app = await openView(page, { args: JOBS_ARGS, width: NARROW_WIDTH })
    const region = app.getByRole("region", { name: "Jobs", exact: true })
    await expect(region).toBeVisible({ timeout: 15_000 })
    const { scrollWidth, clientWidth } = await documentOverflow(app)
    expect(scrollWidth, "the document never scrolls sideways").toBeLessThanOrEqual(clientWidth)
    // The last data column against the pinned row actions, at both ends of
    // the region's scroll: without the region's own scroll it would stay
    // under the actions, out of reach.
    const lastColumn = (at: "start" | "end") =>
      region.evaluate((el, side) => {
        el.scrollLeft = side === "end" ? el.scrollWidth : 0
        const cells = [...el.querySelectorAll("tbody tr:first-child > *")].filter(
          (cell) => getComputedStyle(cell).display !== "none",
        )
        return {
          scrolled: el.scrollLeft,
          right: cells.at(-2)!.getBoundingClientRect().right,
          actionsLeft: cells.at(-1)!.getBoundingClientRect().left,
        }
      }, at)
    const start = await lastColumn("start")
    expect(start.right, "the table really overflows its region").toBeGreaterThan(
      start.actionsLeft + 1,
    )
    const end = await lastColumn("end")
    expect(end.scrolled, "the region itself scrolls").toBeGreaterThan(0)
    expect(end.right, "the last column scrolls into view").toBeLessThanOrEqual(end.actionsLeft + 1)
  })

  test("a job table that overflows: the row actions stay at the region's right edge while it scrolls", async ({
    page,
  }) => {
    const app = await openView(page, { args: JOBS_ARGS, width: NARROW_WIDTH })
    const region = app.getByRole("region", { name: "Jobs", exact: true })
    await expect(region).toBeVisible({ timeout: 15_000 })
    const sizes = await region.evaluate((el) => ({
      scroll: el.scrollWidth,
      client: el.clientWidth,
    }))
    expect(sizes.scroll, "the table really overflows its region").toBeGreaterThan(sizes.client)
    const { scrollWidth, clientWidth } = await documentOverflow(app)
    expect(scrollWidth, "the document never scrolls sideways").toBeLessThanOrEqual(clientWidth)

    for (const end of ["start", "end"] as const) {
      const edges = await region.evaluate((el, at) => {
        el.scrollLeft = at === "end" ? el.scrollWidth : 0
        const box = el.getBoundingClientRect()
        const action = el.querySelector("tbody tr > :last-child")!.getBoundingClientRect()
        return {
          scrolled: el.scrollLeft,
          // The padding box's right edge: where `right: 0` pins the column.
          regionRight: box.left + el.clientLeft + el.clientWidth,
          actionLeft: action.left,
          actionRight: action.right,
          regionLeft: box.left,
        }
      }, end)
      if (end === "end") expect(edges.scrolled).toBeGreaterThan(0)
      expect(Math.abs(edges.actionRight - edges.regionRight), `pinned at the ${end}`).toBeLessThan(
        1.5,
      )
      expect(edges.actionLeft).toBeGreaterThan(edges.regionLeft)
    }
  })

  test("keyboard focus on a table region shows inside its box (WCAG 2.4.7)", async ({ page }) => {
    // The overview's definitions region spans its card; the jobs region pins a
    // column over its right edge.
    const views = [
      { scenario: { width: INLINE_WIDTH }, name: DEFINITIONS_TABLE },
      { scenario: { args: JOBS_ARGS, width: NARROW_WIDTH }, name: "Jobs" },
    ]
    for (const { scenario, name } of views) {
      const app = await openView(page, scenario)
      const region = app.getByRole("region", { name, exact: true })
      await expect(region).toBeVisible({ timeout: 15_000 })
      await region.scrollIntoViewIfNeeded()
      const before = await edgeStrips(page, region)
      await region.focus()
      expect(await region.evaluate((el) => el.matches(":focus-visible"))).toBe(true)
      const after = await edgeStrips(page, region)
      const sides = [
        ["top", "x"],
        ["bottom", "x"],
        ["left", "y"],
        ["right", "y"],
      ] as const
      for (const [i, [side, along]] of sides.entries()) {
        expect(
          await changedShare(page, before[i], after[i], along),
          `${name}: the ring shows along the whole ${side} edge`,
        ).toBeGreaterThanOrEqual(0.9)
      }
    }
  })

  test("axe: the inline views pass WCAG 2.2 A/AA (light and dark)", async ({ page }) => {
    for (const [view, args, theme] of [
      ["overview", { engine: HEALTHY_ENGINE }, "light"],
      ["jobs", JOBS_ARGS, "light"],
      ["overview", { engine: HEALTHY_ENGINE }, "dark"],
      ["jobs", JOBS_ARGS, "dark"],
    ] as const) {
      const app = await openView(page, { args, theme, width: INLINE_WIDTH })
      await expect(app.getByRole("table").first()).toBeVisible({ timeout: 15_000 })
      const results = await new AxeBuilder({ page })
        .include("#app")
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
        .analyze()
      const violations = results.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target.join(" ")).slice(0, 5),
      }))
      expect(violations, `${view} (${theme})`).toEqual([])
    }
  })
})

/**
 * The cockpit opens where `engine_open_cockpit` resolved (#341 K43): this
 * deployment has two engines, so without an `engine` the user picks one; with
 * one, the cockpit is already on it (the engine its facts told the model), on
 * the start view the call names.
 */
test.describe("cockpit (engine_open_cockpit)", () => {
  test("opens on the `engine` argument, not on the picker", async ({ page }) => {
    const app = await openView(page, {
      tool: "engine_open_cockpit",
      args: { engine: HEALTHY_ENGINE },
    })
    await expect(app.getByLabel("Selected engine")).toHaveValue(HEALTHY_ENGINE, { timeout: 15_000 })
    await expect(app.getByRole("navigation", { name: "Cockpit sections" })).toBeVisible()
    await expect(app.getByRole("heading", { level: 1, name: "Operations Cockpit" })).toHaveCount(0)
  })

  test("opens on its start view: the head section current, no picker", async ({ page }) => {
    const app = await openView(page, { args: JOBS_ARGS })
    await expectJobs(app, 10)
    const sections = app.getByRole("navigation", { name: "Cockpit sections" })
    await expect(sections.getByRole("button", { name: "Jobs" })).toHaveAttribute(
      "aria-current",
      "page",
    )
    await expect(app.getByRole("heading", { level: 1, name: "Operations Cockpit" })).toHaveCount(0)
  })

  // #322 U15: the picker is the engine list, each engine's state in words in
  // its accessible name: an unreachable engine says so, never a grey dot.
  test("without one, shows the engine picker", async ({ page }) => {
    const app = await openView(page, { tool: "engine_open_cockpit", args: {} })
    await expect(app.getByRole("heading", { level: 1, name: "Operations Cockpit" })).toBeVisible({
      timeout: 15_000,
    })
    await expect(
      app.getByRole("button", { name: new RegExp(`^${HEALTHY_ENGINE}\\b`) }),
    ).toBeVisible()
    await expect(
      app.getByRole("button", { name: new RegExp(`^${BROKEN_ENGINE}\\b.*\\bunreachable$`) }),
    ).toBeVisible({ timeout: 15_000 })
    await expect(app.getByLabel("Selected engine")).toHaveCount(0)
  })
})

/**
 * What the VS Code extension showed and the cockpit lacked: an instance names the element of
 * each incident and leads to its process, and the instance list's chips count what each lists.
 */
test.describe("an instance and the instance list (engine_open_cockpit)", () => {
  test("an instance names each incident's element and leads to its process", async ({ page }) => {
    const errors = collectErrors(page)
    // The stub's one instance with open incidents (stub-engine.ts), no open task: the view
    // opens on its Incidents tab.
    const app = await openView(page, {
      args: { engine: HEALTHY_ENGINE, view: "instance-detail", processInstanceId: "pi-invoice-42" },
    })
    const table = app.getByRole("region", { name: "Incidents of this instance" })
    await expect(table).toBeVisible({ timeout: 15_000 })
    await expect(table.getByRole("columnheader").first()).toHaveText("Activity")
    const elements = table.locator("tbody > tr > td:first-child")
    // The diagram's name leads with the id after it on one line; an element the diagram lacks
    // shows its id.
    await expect(elements).toHaveText(["Approve Invoice approveInvoice", "chargeCard"])

    await app.getByRole("button", { name: "View process" }).click()
    await expect(app.getByRole("heading", { name: "Invoice Receipt" })).toBeVisible({
      timeout: 15_000,
    })
    await expect(app.getByRole("navigation", { name: "Breadcrumb" })).toContainText(
      "Invoice Receipt",
    )
    expect(errors).toEqual([])
  })

  test("the chips count what each lists, whichever chip is on", async ({ page }) => {
    // The realistic engine: 160 running instances, 54 with an incident, 10 suspended.
    const app = await openView(page, {
      hostEnv: REALISTIC_HOST_ENV,
      args: { engine: REALISTIC_ENGINE, view: "process-instances" },
    })
    const chips = app.getByRole("group", { name: "Instance filters" })
    // Exact names and texts: a substring would let 540 pass for 54 and 154 running for 54.
    const all = chips.getByRole("button", { name: "All 160", exact: true })
    const withIncidents = chips.getByRole("button", { name: "With incident 54", exact: true })
    const suspended = chips.getByRole("button", { name: "Suspended 10", exact: true })
    await expect(all).toBeVisible({ timeout: 15_000 })
    await expect(withIncidents).toBeVisible()
    await expect(suspended).toBeVisible()
    await expect(app.getByText("160 running", { exact: true })).toBeVisible()

    await chips.getByRole("button", { name: /^With incident/ }).click()
    await expect(app.getByText("54 running", { exact: true })).toBeVisible({ timeout: 15_000 })
    // Still the whole list and its suspended ones, not those that also have an incident.
    await expect(all).toBeVisible()
    await expect(suspended).toBeVisible()
    await expect(withIncidents).toHaveAttribute("aria-pressed", "true")
    await expect(all).toHaveAttribute("aria-pressed", "false")
  })
})
