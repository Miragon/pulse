/// <reference types="node" />
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { type Browser, chromium, type Page } from "playwright"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { BrowserBundle } from "../scripts/browser-bundle.mjs"
import { suiteBundle } from "./browser-bundle.test-support.js"
import {
  contrastFindings,
  LIGHT_STATUS_EXEMPTION,
  ROLE_CONTRAST_PAIRS,
  type ThemeVariables,
  toneContrastPairs,
} from "./testing/index.js"
import { THEME_INLINE } from "./theme/theme-css.test-support.js"

/**
 * A plain index.html over the browser bundle, as a page with files of its own writes it:
 * pulse-ui.css linked, one module script importing pulse-ui.js (and lucide.js, and the probe of a
 * later entry), no other script, rendered in Chromium (the Playwright pin CI installs). Light and
 * dark by the root's data-theme, and the OS's mode where the root names none. The contrast pairs
 * are measured on the roles as the browser resolves them from the shipped stylesheet. A page with
 * no file of its own, the README's example, is browser-chat.test.ts's. Set PULSE_UI_BROWSER_SHOTS
 * to a folder to keep a screenshot of every case there.
 */

const ORIGIN = "http://pulse-ui.test"
/** A CDN's stand-in on another origin, which answers as jsDelivr does: CORS open to every page. */
const CDN = "http://cdn.pulse-ui.test/npm/@miragon/pulse-ui@0.0.0/dist/browser/"
const TIMEOUT = { timeout: 60_000 }
const SHOTS = process.env.PULSE_UI_BROWSER_SHOTS

/** The page's module: what the README's example does, with every component the issue names. */
const PAGE_JS = `
import {
  createElement as h, createRoot, CountFigure, DrillButton, formatCount, ICON_STROKE, KpiGrid,
  LocaleProvider, Section, StatusStrip, Table, TableBody, TableCell, TableHead, TableHeader,
  TableRow, WidgetHeader,
} from "./pulse-ui.js"
import { Activity, LucideProvider } from "./lucide.js"
import { BrowserProbe } from "./probe.js"

const incidents = [["Check application", 3], ["Approve contract", 0], ["Archive contract", 1]]
const figure = (n) =>
  n > 0 ? h(CountFigure, { situation: "openIncident", label: formatCount(n) + " open incidents" }, formatCount(n)) : formatCount(n)

function Page() {
  return h("main", { className: "mx-auto flex max-w-7xl flex-col gap-section p-gutter" },
    h(WidgetHeader, { title: "Miravelo leasing", sub: "miraveloLeasing, all versions" }),
    h(StatusStrip, { tone: "warning", title: "One engine answers slowly", detail: "The numbers may be a minute old." }),
    h(KpiGrid, { cells: [
      { label: "Running", value: formatCount(1284) },
      { label: "Open incidents", value: figure(4) },
      { label: "Open tasks", value: formatCount(17) },
      { label: "Ended today", value: formatCount(96) },
    ] }),
    h("div", { "data-slot": "page-grid", className: "grid gap-gutter sm:grid-cols-2" },
      h("p", { className: "text-muted-foreground" }, "Started and ended per day"),
      h("p", { className: "text-muted-foreground tabular-nums" }, formatCount(1234567)),
    ),
    h(Section, { title: "Incidents by activity", count: 4, defaultOpen: true },
      h(Table, null,
        h(TableHeader, null, h(TableRow, null, h(TableHead, null, "Activity"), h(TableHead, { className: "text-right" }, "Open incidents"))),
        h(TableBody, null, incidents.map(([name, n]) =>
          h(TableRow, { key: name }, h(TableCell, null, name), h(TableCell, { className: "text-right tabular-nums" }, figure(n))))),
      ),
    ),
    h("div", { className: "flex items-center gap-2" },
      h(LucideProvider, { size: 16, strokeWidth: ICON_STROKE },
        h(Activity, { "aria-hidden": true, "data-slot": "page-icon" }),
        h("span", { "data-slot": "kit-drill" }, h(DrillButton, { onDrill: () => {} }, "Open"))),
      h(LocaleProvider, { locale: "de" }, h(BrowserProbe)),
    ),
  )
}

createRoot(document.getElementById("root")).render(h(Page))
`

const indexHtml = (theme: string | undefined) => `<!doctype html>
<html lang="en"${theme === undefined ? "" : ` data-theme="${theme}"`}>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Miravelo leasing</title>
    <link rel="stylesheet" href="pulse-ui.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="page.js"></script>
  </body>
</html>
`

const TYPES: Readonly<Record<string, string>> = {
  html: "text/html",
  js: "text/javascript",
  css: "text/css",
}

let bundle: BrowserBundle
let browser: Browser

beforeAll(async () => {
  ;[bundle, browser] = await Promise.all([suiteBundle(), chromium.launch()])
}, 60_000)

afterAll(async () => {
  await browser.close()
})

interface Case {
  /** The root's data-theme, or none. */
  theme?: "light" | "dark"
  os: "light" | "dark"
  width?: number
  /** The page's document; default the test page, whose probe it waits for. */
  html?: string
  /** The page's module (page.js); default the test page's. */
  script?: string
}

/** The page in a fresh context, with what went wrong on it: an error, a request to another host. */
async function open({ theme, os, width = 1240, html, script }: Case) {
  const context = await browser.newContext({ colorScheme: os, viewport: { width, height: 900 } })
  const page = await context.newPage()
  const problems: string[] = []
  page.on("pageerror", (error) => problems.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") problems.push(message.text())
  })
  const files: Record<string, string> = {
    ...bundle.files,
    "index.html": html ?? indexHtml(theme),
    "page.js": script ?? PAGE_JS,
  }
  await page.route("**/*", async (route) => {
    const url = route.request().url()
    const fromCdn = url.startsWith(CDN)
    const file = fromCdn ? url.slice(CDN.length) : new URL(url).pathname.slice(1) || "index.html"
    const body = fromCdn || url.startsWith(`${ORIGIN}/`) ? files[file] : undefined
    if (body === undefined) {
      problems.push(`requested ${url}`)
      return route.abort()
    }
    const contentType = TYPES[file.split(".").pop() ?? ""] ?? "text/plain"
    const headers = fromCdn ? { "access-control-allow-origin": "*" } : undefined
    return route.fulfill({ body, contentType, headers })
  })
  await page.goto(`${ORIGIN}/`)
  await page
    .locator(html === undefined && script === undefined ? '[data-slot="browser-probe"]' : "h1")
    .waitFor()
  return { page, problems, close: () => context.close() }
}

/**
 * The colour roles every contrast pair names, as the browser resolves them on the root. A
 * utility's colour (`--color-danger-soft`) is no variable of the page: Tailwind inlines it as the
 * theme's `@theme inline` maps it (`var(--danger-soft)`), so it is read through that mapping.
 */
async function roles(page: Page): Promise<Map<string, string>> {
  const pairs = [...ROLE_CONTRAST_PAIRS, ...toneContrastPairs()]
  const named = [...new Set(pairs.flatMap(({ fg, bg, over }) => [fg, bg, over ?? "--card"]))]
  const inlined = named.filter((name) => name in THEME_INLINE)
  const roleOf = (value: string) => /^var\((--[\w-]+)\)$/.exec(value)?.[1]
  const names = [...named, ...inlined.flatMap((name) => roleOf(THEME_INLINE[name] ?? "") ?? [])]
  const values = await page.evaluate((list) => {
    const style = getComputedStyle(document.documentElement)
    return list.map((name) => [name, style.getPropertyValue(name).trim()] as const)
  }, names)
  const map = new Map(values.filter(([, value]) => value !== ""))
  for (const name of inlined) map.set(name, THEME_INLINE[name] ?? "")
  return map
}

/** The ground and the text of the body, `rgb(…)` as the browser computes them. */
const ground = (page: Page) =>
  page.evaluate(() => {
    const style = getComputedStyle(document.body)
    return {
      background: style.backgroundColor,
      color: style.color,
      scheme: style.colorScheme,
      font: style.fontFamily,
      size: style.fontSize,
    }
  })

const LIGHT_GROUND = { background: "rgb(249, 247, 247)", color: "rgb(29, 29, 29)", scheme: "light" }
const DARK_GROUND = { background: "rgb(29, 29, 29)", color: "rgb(255, 255, 255)", scheme: "dark" }

/**
 * The README's composition of the charts: a Sparkline as a KPI tile's trend, the tiles in a
 * KpiGrid (a strip that clips its content) inside a Panel on a PanelGrid.
 */
const SPARKLINES_JS = `
import { createElement as h, createRoot, formatCount, KpiGrid, Panel, PanelGrid, Sparkline } from "./pulse-ui.js"

const points = Array.from({ length: 14 }, (_, i) => ({ key: "d" + i, label: "Nov " + (10 + i), value: (i * 7) % 11 }))
const trend = h(Sparkline, { label: "Started per day, last 14 days, all versions", categoryLabel: "Day", points })
const cells = ["Running", "Open incidents", "Started", "Ended"].map((label) => ({ label, value: formatCount(12), trend }))

createRoot(document.getElementById("root")).render(
  h("main", { className: "flex flex-col gap-section p-gutter" },
    h("h1", null, "Charts"),
    h(PanelGrid, null,
      h(Panel, { title: "Now" }, h(KpiGrid, { cells })),
      h(Panel, { title: "Beside it" }, h("p", null, "Another panel")),
    ),
  ),
)
`

/** A process with a collapsed subprocess that has a plane of its own, drawn by ./bpmn's BpmnDiagram. */
const SUBPROCESS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="d" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="P" isExecutable="true">
    <bpmn:task id="Outer" name="Outer" />
    <bpmn:subProcess id="Sub" name="Sub"><bpmn:task id="Inner" name="Inner" /></bpmn:subProcess>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="D">
    <bpmndi:BPMNPlane id="PP" bpmnElement="P">
      <bpmndi:BPMNShape id="Outer_di" bpmnElement="Outer"><dc:Bounds x="100" y="80" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Sub_di" bpmnElement="Sub" isExpanded="false"><dc:Bounds x="260" y="80" width="100" height="80" /></bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
  <bpmndi:BPMNDiagram id="D2">
    <bpmndi:BPMNPlane id="SubPlane" bpmnElement="Sub">
      <bpmndi:BPMNShape id="Inner_di" bpmnElement="Inner"><dc:Bounds x="100" y="80" width="100" height="80" /></bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`

const SUBPROCESS_JS = `
import { createElement as h, createRoot } from "./pulse-ui.js"
import { BpmnDiagram } from "./pulse-ui-bpmn.js"

const xml = ${JSON.stringify(SUBPROCESS_XML)}
const decorations = [{ elementId: "Outer", counts: [{ kind: "running", count: 5 }], incident: false }]
createRoot(document.getElementById("root")).render(
  h("main", { className: "p-gutter" }, h("h1", null, "Diagram"), h(BpmnDiagram, { xml, decorations, ariaLabel: "P" })),
)
`

describe("a plain index.html over the browser bundle", () => {
  it.each([
    ["light, by default", { os: "light" }, LIGHT_GROUND],
    ['dark, by data-theme="dark"', { theme: "dark", os: "light" }, DARK_GROUND],
    ["dark on a dark OS, with no data-theme and no script", { os: "dark" }, DARK_GROUND],
    ['light by data-theme="light", on a dark OS', { theme: "light", os: "dark" }, LIGHT_GROUND],
  ] as const)("renders the kit %s", TIMEOUT, async (name, mode: Case, expected) => {
    const { page, problems, close } = await open(mode)
    try {
      expect(await ground(page)).toMatchObject(expected)
      // The header, the strip, the tiles, the section with its table, the figures.
      await expect(page.locator("h1").textContent()).resolves.toBe("Miravelo leasing")
      expect(await page.locator('[data-slot="status-strip"]').count()).toBe(1)
      for (const label of ["Running", "Open incidents", "Open tasks", "Ended today"]) {
        expect(await page.getByText(label, { exact: true }).count(), label).toBeGreaterThan(0)
      }
      expect(await page.locator("details[open] > summary").textContent()).toContain(
        "Incidents by activity",
      )
      expect(await page.locator('[data-slot="table"] tbody tr').count()).toBe(3)
      // Three alarming figures, each with its icon; the zero stays a plain number.
      expect(
        await page.locator('[data-slot="count-figure"] svg.lucide').count(),
      ).toBeGreaterThanOrEqual(3)
      // The kit's font on the dense step, the page's own grid from the layout utilities.
      const body = await ground(page)
      expect(body.font).toMatch(/^Geist, /)
      expect(body.size).toBe("13px")
      const grid = await page
        .locator('[data-slot="page-grid"]')
        .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length)
      expect(grid).toBe(2)
      // lucide.js and the probe run on pulse-ui.js's React and the kit's own locale context, and
      // lucide.js's provider on pulse-ui.js's icon context: its stroke reaches the kit's arrow,
      // which sets none of its own, as it reaches the page's icon.
      expect(await page.locator('[data-slot="page-icon"]').getAttribute("width")).toBe("16")
      for (const icon of ['[data-slot="page-icon"]', '[data-slot="kit-drill"] svg.lucide']) {
        expect(await page.locator(icon).getAttribute("stroke-width"), icon).toBe("2.5")
      }
      const probe = page.locator('[data-slot="browser-probe"]')
      expect(await probe.textContent()).toBe("de 0")
      await probe.click()
      expect(await probe.textContent()).toBe("de 1")
      if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true })
        const file = name.replace(/[^a-z]+/gi, "-").replace(/^-|-$/g, "")
        await page.screenshot({ path: join(SHOTS, `${file}.png`), fullPage: true })
      }
      expect(problems).toEqual([])
    } finally {
      await close()
    }
  })

  it(
    "keeps a 390 px page on its width: nothing scrolls the document sideways",
    TIMEOUT,
    async () => {
      const { page, problems, close } = await open({ os: "dark", width: 390 })
      try {
        const { scroll, client } = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
        }))
        expect(scroll).toBeLessThanOrEqual(client)
        if (SHOTS)
          await page.screenshot({ path: join(SHOTS, "dark-on-a-dark-OS-390.png"), fullPage: true })
        expect(problems).toEqual([])
      } finally {
        await close()
      }
    },
  )

  it.each([1240, 720, 360])(
    "shows a KPI tile's Sparkline tooltip whole, in the window, out of the strip that clips (%i px)",
    TIMEOUT,
    async (width) => {
      const { page, problems, close } = await open({
        os: "light",
        width,
        html: indexHtml(undefined),
        script: SPARKLINES_JS,
      })
      try {
        for (const at of ["first", "last"] as const) {
          const line = page.locator('[data-slot="sparkline"] > span:first-child')[at]()
          const box = await line.boundingBox()
          if (!box) throw new Error("the sparkline has no box")
          await line.hover({
            position: { x: at === "first" ? 2 : box.width - 2, y: box.height / 2 },
          })
          const tip = page.locator('[data-slot="chart-tooltip"]')
          await tip.waitFor()
          const placed = await tip.evaluate((el) => {
            const rect = el.getBoundingClientRect()
            return {
              inStrip: el.closest('[data-slot="kpi-strip"]') !== null,
              left: rect.left,
              right: rect.right,
              top: rect.top,
              bottom: rect.bottom,
              width: window.innerWidth,
              height: window.innerHeight,
            }
          })
          expect(placed.inStrip, at).toBe(false)
          expect(placed.left, at).toBeGreaterThanOrEqual(0)
          expect(placed.right, at).toBeLessThanOrEqual(placed.width)
          expect(placed.top, at).toBeGreaterThanOrEqual(0)
          expect(placed.bottom, at).toBeLessThanOrEqual(placed.height)
          await page.mouse.move(0, 0)
          await tip.waitFor({ state: "detached" })
        }
        if (SHOTS) await page.screenshot({ path: join(SHOTS, `sparkline-${String(width)}.png`) })
        expect(problems).toEqual([])
      } finally {
        await close()
      }
    },
  )

  it(
    "draws a collapsed subprocess without bpmn-js's drilldown button, so no press strands the reader",
    TIMEOUT,
    async () => {
      const { page, problems, close } = await open({
        os: "light",
        html: indexHtml(undefined),
        script: SUBPROCESS_JS,
      })
      try {
        await page.locator('svg[role="img"] [data-element-id="Sub"]').waitFor()
        expect(await page.locator(".bjs-drilldown").count()).toBe(0)
        expect(await page.locator('[data-element-id="Outer"]').count()).toBe(1)
        expect(problems).toEqual([])
      } finally {
        await close()
      }
    },
  )

  it.each([
    ['data-theme="dark"', { theme: "dark", os: "light" }],
    ["a dark OS, with no data-theme", { os: "dark" }],
  ] as const)(
    "holds every role pair to WCAG AA as the browser resolves the stylesheet, light and dark by %s",
    TIMEOUT,
    async (_, dark: Case) => {
      const light = await open({ os: "light" })
      const night = await open(dark)
      try {
        const theme: ThemeVariables = {
          light: await roles(light.page),
          dark: await roles(night.page),
        }
        expect(contrastFindings(theme, ROLE_CONTRAST_PAIRS)).toEqual([])
        expect(contrastFindings(theme, toneContrastPairs()).sort()).toEqual(LIGHT_STATUS_EXEMPTION)
      } finally {
        await light.close()
        await night.close()
      }
    },
  )
})
