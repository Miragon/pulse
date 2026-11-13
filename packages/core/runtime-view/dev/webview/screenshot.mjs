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
const page = pathToFileURL(`${devDir}index.html`).href

await mkdir(outDir, { recursive: true })
const browser = await chromium.launch()

async function openTab(forcedColors) {
  const context = await browser.newContext({
    viewport: { width, height: 800 },
    deviceScaleFactor: 2,
    forcedColors,
    reducedMotion,
  })
  return context.newPage()
}

async function shoot(tab0, fixture, theme, mode) {
  await tab0.goto(`${page}?fixture=${fixture}&theme=${theme}`)
  await tab0.waitForTimeout(fixture.startsWith("loading") ? 700 : 900)
  if (tab !== undefined) {
    await tab0.getByRole("tab", { name: new RegExp(`^${tab}`) }).click()
    await tab0.waitForTimeout(200)
  }
  if (expand !== undefined) {
    await tab0.getByRole("button", { name: `Expand the value of ${expand}` }).click()
    await tab0.waitForTimeout(150)
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
