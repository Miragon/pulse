import { mkdir } from "node:fs/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import { chromium } from "playwright"

const devDir = fileURLToPath(new URL(".", import.meta.url))
const outDir = process.argv[2] ?? `${devDir}screenshots`
const fixtures = (
  process.env.FIXTURES ??
  "definition,definition-filtered,definition-ended,definition-prod,refreshing,instance,instance-waiting,loading,failed,failed-empty"
).split(",")
const themes = (process.env.THEMES ?? "light,dark,hc,hc-light").split(",")
const forcedThemes = (process.env.FORCED_COLORS ?? "light,dark").split(",").filter(Boolean)
const reducedMotion = process.env.REDUCED_MOTION ?? "reduce"
const tab = process.env.TAB
const expand = process.env.EXPAND
const width = Number(process.env.WIDTH ?? 1280)
const suffix = process.env.SUFFIX ?? ""
const clock = new Date(process.env.CLOCK ?? "2026-11-12T09:30:00.000Z")
const page = pathToFileURL(`${devDir}index.html`).href

await mkdir(outDir, { recursive: true })
const browser = await chromium.launch()

async function openTab(forcedColors) {
  const context = await browser.newContext({
    viewport: { width, height: 800 },
    deviceScaleFactor: 2,
    forcedColors,
    reducedMotion,
    locale: "en-US",
    timezoneId: "UTC",
  })
  await context.clock.setFixedTime(clock)
  return context.newPage()
}

const SKELETONS =
  "[data-part='skeleton'], [data-slot='skeleton'], [data-slot='data-table-skeleton']"
const STILL_FRAMES = 12
const FRAME_LIMIT = 600
const SHOWN_TIMEOUT = 30_000

function shown({ loading, skeletons }) {
  const { document } = globalThis
  if (loading) {
    return document.querySelector(skeletons) !== null
  }
  const diagrams = [...document.querySelectorAll("[data-part='diagram']")]
  const drawn = diagrams.every(
    (diagram) =>
      diagram.querySelector("g.djs-element") !== null ||
      diagram.querySelector("[data-part='diagram-failure']") !== null,
  )
  return document.querySelector("h1") !== null && drawn
}

async function heldStill({ frames, limit }) {
  const { document, requestAnimationFrame } = globalThis
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()))
  const layout = () =>
    [
      document.documentElement.scrollHeight,
      ...[...document.querySelectorAll(".djs-container svg .viewport")].map((viewport) =>
        viewport.getAttribute("transform"),
      ),
    ].join("|")
  let last = layout()
  let still = 0
  for (let seen = 0; seen < limit && still < frames; seen += 1) {
    await frame()
    const now = layout()
    still = now === last ? still + 1 : 0
    last = now
  }
  return { settled: still >= frames, layout: last }
}

async function waitUntilStill(tab0, loading) {
  await tab0.evaluate(() => globalThis.document.fonts.ready)
  await tab0.waitForFunction(shown, { loading, skeletons: SKELETONS }, { timeout: SHOWN_TIMEOUT })
  const { settled, layout } = await tab0.evaluate(heldStill, {
    frames: STILL_FRAMES,
    limit: FRAME_LIMIT,
  })
  if (!settled) {
    throw new Error(
      `The layout did not hold still for ${STILL_FRAMES} frames within ${FRAME_LIMIT} (last: ${layout}).`,
    )
  }
}

async function settle(tab0, shot, loading) {
  try {
    await waitUntilStill(tab0, loading)
  } catch (error) {
    throw new Error(`${shot}: ${error.message}`, { cause: error })
  }
}

async function shoot(tab0, fixture, theme, mode) {
  const shot = `${fixture} (${theme}${mode})`
  await tab0.goto(`${page}?fixture=${fixture}&theme=${theme}`)
  await settle(tab0, shot, fixture.startsWith("loading"))
  if (tab !== undefined) {
    await tab0.getByRole("tab", { name: new RegExp(`^${tab}`) }).click()
    await settle(tab0, `${shot}, tab ${tab}`, false)
  }
  if (expand !== undefined) {
    await tab0.getByRole("button", { name: `Expand the value of ${expand}` }).click()
    await settle(tab0, `${shot}, value ${expand}`, false)
  }
  const name = `${fixture}${tab === undefined ? "" : `-tab-${tab.toLowerCase()}`}${suffix}-${theme}${mode}.png`
  await tab0.screenshot({ path: `${outDir}/${name}` })
  console.log(`${outDir}/${name}`)
}

const plain = await openTab("none")
const forced = forcedThemes.length === 0 ? undefined : await openTab("active")

for (const fixture of fixtures) {
  for (const theme of themes) {
    await shoot(plain, fixture, theme, "")
  }
  for (const theme of forcedThemes) {
    await shoot(forced, fixture, theme, "-forced")
  }
}

await browser.close()
